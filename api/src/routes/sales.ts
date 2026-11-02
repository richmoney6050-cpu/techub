import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx, Db, round2, pool } from '../db.ts';
import { requirePerm, requireAny, can, audit } from '../auth.ts';
import { applyStock, sendAlerts, nextCounter } from '../inventory.ts';
import { receiptPdf } from '../receipt.ts';
import { bad, forbidden, notFound, conflict } from '../errors.ts';
import { config } from '../config.ts';

export const salesRouter = Router();

const saleSchema = z.object({
  idempotency_key: z.string().trim().min(8).max(100),
  items: z.array(z.object({ variation_id: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(100000) })).min(1).max(100),
  discount: z.object({ type: z.enum(['amount', 'percent']), value: z.coerce.number().min(0) }).optional(),
  payment_method: z.enum(['cash', 'momo', 'bank_transfer', 'card']),
  amount_paid: z.coerce.number().min(0).optional(),
  payment_reference: z.string().trim().max(100).optional(),
  customer_name: z.string().trim().max(120).optional(),
  customer_id: z.string().uuid().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(300).optional(),
});

async function loadSale(db: Db, businessId: string, saleId: string) {
  const sale = await one<any>(
    `SELECT s.*, u.name AS employee_name FROM sales s JOIN users u ON u.id=s.employee_id WHERE s.id=$1 AND s.business_id=$2`, [saleId, businessId], db);
  if (!sale) return null;
  sale.items = await query(
    `SELECT id, variation_id, product_name AS name, sku, quantity, unit_price, line_total, returned_qty FROM sale_items WHERE sale_id=$1 ORDER BY product_name`, [saleId], db);
  sale.payments = await query(`SELECT kind, method, amount, reference, created_at FROM payments WHERE sale_id=$1 ORDER BY created_at`, [saleId], db);
  return sale;
}

salesRouter.post('/sales', requirePerm('sales.create'), async (req, res) => {
  const b = saleSchema.parse(req.body);
  const biz = req.user!.business_id;

  const result = await tx(async (c) => {
    // Serialise submissions that share an idempotency key (double taps, network retries)
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${biz}:${b.idempotency_key}`], c);
    const existing = await one<any>('SELECT id FROM sales WHERE business_id=$1 AND idempotency_key=$2', [biz, b.idempotency_key], c);
    if (existing) return { saleId: existing.id as string, duplicate: true, alerts: [] as any[] };

    // merge repeated lines, then lock/deduct in a stable order to avoid deadlocks
    const merged = new Map<string, number>();
    for (const it of b.items) merged.set(it.variation_id, (merged.get(it.variation_id) || 0) + it.quantity);
    const ids = [...merged.keys()].sort();
    const vars = await query<any>(
      `SELECT v.id, v.sku, v.selling_price, v.purchase_price, p.name, v.label FROM product_variations v JOIN products p ON p.id=v.product_id
        WHERE v.id = ANY($1::uuid[]) AND v.business_id=$2 AND v.is_active AND p.is_active`, [ids, biz], c);
    if (vars.length !== ids.length) throw notFound('One of the products is no longer available');
    const byId = new Map(vars.map((v) => [v.id, v]));

    const lines = ids.map((id) => {
      const v = byId.get(id);
      const qty = merged.get(id)!;
      return { v, qty, name: v.label ? `${v.name} (${v.label})` : v.name, line_total: round2(v.selling_price * qty) };
    });
    const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));

    let discount = 0;
    if (b.discount && b.discount.value > 0) {
      if (!can(req.user, 'discounts.apply')) throw forbidden('You are not allowed to apply discounts');
      discount = b.discount.type === 'percent' ? round2(subtotal * b.discount.value / 100) : round2(b.discount.value);
      if (discount > subtotal) throw bad('Discount cannot be more than the subtotal');
      if (req.user!.role !== 'owner') {
        const s = await one<any>('SELECT max_discount_percent FROM businesses WHERE id=$1', [biz], c);
        if (subtotal > 0 && (discount / subtotal) * 100 > s.max_discount_percent + 1e-9) throw forbidden(`Discounts above ${s.max_discount_percent}% need the owner`);
      }
    }
    const total = round2(subtotal - discount);
    const paid = round2(b.amount_paid ?? total);
    const change = round2(Math.max(paid - total, 0));
    const balance = round2(Math.max(total - paid, 0));
    if (b.payment_method !== 'cash' && paid > total) throw bad('Amount paid cannot exceed the total for non-cash payments');

    // Credit / part-payment: needs a registered customer and the credit permission
    let customer: any = null;
    if (b.customer_id) {
      customer = await one<any>('SELECT id, name FROM customers WHERE id=$1 AND business_id=$2 AND is_active', [b.customer_id, biz], c);
      if (!customer) throw notFound('Customer not found');
    }
    if (balance > 0) {
      if (!can(req.user, 'customers.credit')) throw forbidden('You are not allowed to sell on credit');
      if (!customer) throw bad('Choose a registered customer to sell on credit');
    }
    const customerName = customer?.name || b.customer_name || null;

    const no = await nextCounter(c, biz, 'receipt');
    const receiptNo = `RCP-${String(no).padStart(6, '0')}`;
    const sale = await one<any>(
      `INSERT INTO sales (business_id, receipt_no, idempotency_key, employee_id, customer_name, customer_id, due_date, subtotal, discount, total, amount_paid, change_due, balance_due, payment_method, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [biz, receiptNo, b.idempotency_key, req.user!.id, customerName, customer?.id || null, balance > 0 ? (b.due_date || null) : null, subtotal, discount, total, paid, change, balance, b.payment_method, b.note || null], c);

    const alerts: any[] = [];
    for (const l of lines) {
      await query(
        `INSERT INTO sale_items (sale_id, business_id, variation_id, product_name, sku, quantity, unit_price, unit_cost, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [sale.id, biz, l.v.id, l.name, l.v.sku, l.qty, l.v.selling_price, l.v.purchase_price, l.line_total], c);
      const r = await applyStock(c, { businessId: biz, variationId: l.v.id, delta: -l.qty, type: 'sale', userId: req.user!.id, reason: `Sale ${receiptNo}`, refType: 'sale', refId: sale.id });
      alerts.push(r.alert);
    }
    const paidAmount = round2(Math.min(paid, total));
    if (paidAmount > 0) await query(`INSERT INTO payments (business_id, sale_id, kind, method, amount, reference, created_by) VALUES ($1,$2,'payment',$3,$4,$5,$6)`,
      [biz, sale.id, b.payment_method, paidAmount, b.payment_reference || null, req.user!.id], c);

    const biz_ = await one<any>('SELECT name, logo_url, address, phone, email, currency_symbol, receipt_footer, receipt_show_logo FROM businesses WHERE id=$1', [biz], c);
    const snapshot = {
      receipt_no: receiptNo, created_at: new Date().toISOString(), timezone: config.timezone, employee_name: req.user!.name, customer_name: customerName,
      items: lines.map((l) => ({ name: l.name, sku: l.v.sku, quantity: l.qty, unit_price: l.v.selling_price, line_total: l.line_total })),
      subtotal, discount, total, payment_method: b.payment_method, amount_paid: paid, change_due: change, balance_due: balance,
      business: biz_, footer: biz_.receipt_footer,
    };
    await query('INSERT INTO receipts (business_id, sale_id, receipt_no, snapshot) VALUES ($1,$2,$3,$4)', [biz, sale.id, receiptNo, JSON.stringify(snapshot)], c);
    await audit(req, req.user, 'sale.create', 'sale', sale.id, { receipt_no: receiptNo, total, items: lines.length }, c);
    return { saleId: sale.id as string, duplicate: false, alerts };
  });

  sendAlerts(biz, result.alerts);
  const sale = await loadSale(pool, biz, result.saleId);
  res.status(result.duplicate ? 200 : 201).json({ sale, duplicate: result.duplicate });
});

salesRouter.get('/sales', requireAny('sales.view', 'sales.view_all'), async (req, res) => {
  const q = z.object({
    from: z.string().optional(), to: z.string().optional(), employee_id: z.string().uuid().optional(), q: z.string().max(60).optional(),
    payment_method: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
  }).parse(req.query);
  const params: any[] = [req.user!.business_id];
  const w = ['s.business_id=$1'];
  const add = (sql: string, v: any) => { params.push(v); w.push(sql.replaceAll('?', '$' + params.length)); };
  if (!can(req.user, 'sales.view_all')) add('s.employee_id=?', req.user!.id);
  else if (q.employee_id) add('s.employee_id=?', q.employee_id);
  if (q.from) add(`s.created_at >= (?::date)::timestamptz`, q.from);
  if (q.to) add(`s.created_at < ((?::date) + 1)::timestamptz`, q.to);
  if (q.q) add('(lower(s.receipt_no) LIKE ? OR lower(coalesce(s.customer_name,\'\')) LIKE ?)', `%${q.q.toLowerCase()}%`);
  if (q.payment_method) add('s.payment_method=?', q.payment_method);
  const rows = await query(
    `SELECT s.id, s.receipt_no, s.created_at, s.total, s.discount, s.amount_paid, s.balance_due, s.payment_method, s.status, s.refunded_total, s.customer_name,
            u.name AS employee_name, (SELECT coalesce(sum(quantity),0) FROM sale_items WHERE sale_id=s.id) AS units
       FROM sales s JOIN users u ON u.id=s.employee_id WHERE ${w.join(' AND ')} ORDER BY s.created_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`, params);
  res.json({ sales: rows });
});

async function authorisedSale(req: any) {
  const sale = await loadSale(pool, req.user.business_id, req.params.id);
  if (!sale) throw notFound('Sale not found');
  if (!can(req.user, 'sales.view_all') && sale.employee_id !== req.user.id) throw forbidden('You can only view your own sales');
  return sale;
}
salesRouter.get('/sales/:id', requireAny('sales.view', 'sales.view_all'), async (req, res) => {
  res.json({ sale: await authorisedSale(req) });
});
salesRouter.get('/sales/:id/receipt', requireAny('sales.view', 'sales.view_all', 'sales.create'), async (req, res) => {
  const sale = await loadSale(pool, req.user!.business_id, String(req.params.id));
  if (!sale) throw notFound('Sale not found');
  if (!can(req.user, 'sales.view_all') && sale.employee_id !== req.user!.id) throw forbidden('You can only view your own sales');
  const r = await one<any>('SELECT snapshot FROM receipts WHERE sale_id=$1', [sale.id]);
  res.json({ receipt: r.snapshot, status: sale.status });
});
salesRouter.get('/sales/:id/receipt.pdf', requireAny('sales.view', 'sales.view_all', 'sales.create'), async (req, res) => {
  const sale = await loadSale(pool, req.user!.business_id, String(req.params.id));
  if (!sale) throw notFound('Sale not found');
  if (!can(req.user, 'sales.view_all') && sale.employee_id !== req.user!.id) throw forbidden('You can only view your own sales');
  const r = await one<any>('SELECT snapshot FROM receipts WHERE sale_id=$1', [sale.id]);
  const pdf = await receiptPdf(r.snapshot);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${sale.receipt_no}.pdf"`);
  res.send(pdf);
});
