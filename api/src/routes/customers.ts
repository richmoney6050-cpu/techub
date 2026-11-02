import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx, round2, pool } from '../db.ts';
import { requirePerm, requireAny, can, audit } from '../auth.ts';
import { bad, notFound, conflict } from '../errors.ts';
import { config } from '../config.ts';

const today = `(now() AT TIME ZONE '${config.timezone}')::date`;

export const customersRouter = Router();

const customerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email().max(120).optional().nullable().or(z.literal('')),
  address: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);

// Search (also used by the POS customer picker). Without customers.manage only id/name/phone are returned.
customersRouter.get('/customers', requireAny('customers.manage', 'sales.create'), async (req, res) => {
  const q = z.object({ q: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0), owing: z.enum(['true', 'false']).optional() }).parse(req.query);
  const biz = req.user!.business_id;
  const full = can(req.user, 'customers.manage');
  const params: any[] = [biz]; const w = ['c.business_id=$1', 'c.is_active'];
  if (q.q) { params.push(`%${q.q.toLowerCase()}%`); w.push(`(lower(c.name) LIKE $${params.length} OR lower(coalesce(c.phone,'')) LIKE $${params.length} OR lower(coalesce(c.email,'')) LIKE $${params.length})`); }
  const having = q.owing === 'true' && full ? 'HAVING coalesce(sum(s.balance_due),0) > 0' : '';
  const rows = await query(
    full
      ? `SELECT c.id, c.name, c.phone, c.email, c.address, c.created_at,
                coalesce(sum(s.total - s.refunded_total),0) AS total_spent, coalesce(sum(s.balance_due),0) AS outstanding, count(s.id) AS purchases
           FROM customers c LEFT JOIN sales s ON s.customer_id=c.id WHERE ${w.join(' AND ')} GROUP BY c.id ${having} ORDER BY lower(c.name) LIMIT ${q.limit} OFFSET ${q.offset}`
      : `SELECT c.id, c.name, c.phone FROM customers c WHERE ${w.join(' AND ')} ORDER BY lower(c.name) LIMIT ${q.limit} OFFSET ${q.offset}`, params);
  res.json({ customers: rows });
});

customersRouter.post('/customers', requirePerm('customers.manage'), async (req, res) => {
  const b = customerSchema.parse(req.body);
  try {
    const row = await one(`INSERT INTO customers (business_id, name, phone, email, address, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user!.business_id, b.name, clean(b.phone), clean(b.email), clean(b.address), clean(b.notes), req.user!.id]);
    await audit(req, req.user, 'customer.create', 'customer', row.id, { name: b.name });
    res.status(201).json({ customer: row });
  } catch (e: any) { if (e.code === '23505') throw conflict('A customer with that phone number already exists'); throw e; }
});

customersRouter.put('/customers/:id', requirePerm('customers.manage'), async (req, res) => {
  const b = customerSchema.parse(req.body);
  try {
    const row = await one(`UPDATE customers SET name=$3, phone=$4, email=$5, address=$6, notes=$7 WHERE id=$1 AND business_id=$2 RETURNING *`,
      [req.params.id, req.user!.business_id, b.name, clean(b.phone), clean(b.email), clean(b.address), clean(b.notes)]);
    if (!row) throw notFound('Customer not found');
    await audit(req, req.user, 'customer.update', 'customer', row.id, { name: b.name });
    res.json({ customer: row });
  } catch (e: any) { if (e.code === '23505') throw conflict('A customer with that phone number already exists'); throw e; }
});

// Archive only: purchase history and balances must never disappear.
customersRouter.delete('/customers/:id', requirePerm('customers.manage'), async (req, res) => {
  const owed = await one<any>('SELECT coalesce(sum(balance_due),0) AS n FROM sales WHERE customer_id=$1 AND business_id=$2', [req.params.id, req.user!.business_id]);
  if (owed && owed.n > 0) throw conflict('This customer still owes money. Record their payments first.');
  const row = await one('UPDATE customers SET is_active=false WHERE id=$1 AND business_id=$2 RETURNING id', [req.params.id, req.user!.business_id]);
  if (!row) throw notFound('Customer not found');
  await audit(req, req.user, 'customer.archive', 'customer', row.id, {});
  res.json({ ok: true });
});

customersRouter.get('/customers/:id', requirePerm('customers.manage'), async (req, res) => {
  const biz = req.user!.business_id;
  const customer = await one<any>('SELECT * FROM customers WHERE id=$1 AND business_id=$2', [req.params.id, biz]);
  if (!customer) throw notFound('Customer not found');
  const [totals, sales, payments, items, warranties] = await Promise.all([
    one<any>(`SELECT coalesce(sum(total - refunded_total),0) AS total_spent, coalesce(sum(balance_due),0) AS outstanding, coalesce(sum(refunded_total),0) AS refunded, count(*) AS purchases
                FROM sales WHERE customer_id=$1 AND business_id=$2`, [customer.id, biz]),
    query(`SELECT id, receipt_no, created_at, total, amount_paid, balance_due, due_date, status, payment_method, refunded_total FROM sales WHERE customer_id=$1 AND business_id=$2 ORDER BY created_at DESC LIMIT 100`, [customer.id, biz]),
    query(`SELECT p.id, p.kind, p.method, p.amount, p.reference, p.created_at, s.receipt_no FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.customer_id=$1 AND p.business_id=$2 ORDER BY p.created_at DESC LIMIT 200`, [customer.id, biz]),
    query(`SELECT si.product_name AS name, si.quantity, si.unit_price, si.returned_qty, s.receipt_no, s.created_at FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.customer_id=$1 AND s.business_id=$2 ORDER BY s.created_at DESC LIMIT 200`, [customer.id, biz]),
    can(req.user, 'warranty.manage')
      ? query(`SELECT id, product_name, serial_number, imei, end_date, CASE WHEN status='active' AND end_date < ${today} THEN 'expired' ELSE status END AS status FROM warranties WHERE customer_id=$1 AND business_id=$2 ORDER BY end_date DESC`, [customer.id, biz])
      : Promise.resolve([]),
  ]);
  res.json({ customer, totals, sales, payments, items, warranties });
});

// Record a customer payment against one of their credit sales.
customersRouter.post('/customers/:id/payments', requirePerm('customers.credit'), async (req, res) => {
  const b = z.object({
    idempotency_key: z.string().trim().min(8).max(100), sale_id: z.string().uuid(), amount: z.coerce.number().positive().max(1e9),
    method: z.enum(['cash', 'momo', 'bank_transfer', 'card']), reference: z.string().trim().max(100).optional(),
  }).parse(req.body);
  const biz = req.user!.business_id;
  const out = await tx(async (c) => {
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${biz}:pay:${b.idempotency_key}`], c);
    const dup = await one<any>('SELECT sale_id FROM payments WHERE business_id=$1 AND idempotency_key=$2', [biz, b.idempotency_key], c);
    if (dup) return { saleId: dup.sale_id as string, duplicate: true };
    const sale = await one<any>('SELECT id, customer_id, balance_due, receipt_no FROM sales WHERE id=$1 AND business_id=$2 FOR UPDATE', [b.sale_id, biz], c);
    if (!sale || sale.customer_id !== req.params.id) throw notFound('Sale not found for this customer');
    const amount = round2(b.amount);
    if (sale.balance_due <= 0) throw bad('This sale is already fully paid');
    if (amount > sale.balance_due + 1e-9) throw bad(`Payment is more than the balance (${sale.balance_due.toFixed(2)})`);
    await query('UPDATE sales SET amount_paid = amount_paid + $2, balance_due = balance_due - $2 WHERE id=$1', [sale.id, amount], c);
    await query(`INSERT INTO payments (business_id, sale_id, kind, method, amount, reference, created_by, idempotency_key) VALUES ($1,$2,'payment',$3,$4,$5,$6,$7)`,
      [biz, sale.id, b.method, amount, b.reference || null, req.user!.id, b.idempotency_key], c);
    if (round2(sale.balance_due - amount) <= 0) await query(`UPDATE notifications SET resolved=true WHERE ref_id=$1 AND type='customer_overdue'`, [sale.id], c);
    await audit(req, req.user, 'customer.payment', 'sale', sale.id, { receipt_no: sale.receipt_no, amount, method: b.method }, c);
    return { saleId: sale.id as string, duplicate: false };
  });
  const sale = await one('SELECT id, receipt_no, total, amount_paid, balance_due FROM sales WHERE id=$1', [out.saleId], pool);
  res.status(out.duplicate ? 200 : 201).json({ sale, duplicate: out.duplicate });
});

// All unpaid credit sales (receivables), oldest due first.
customersRouter.get('/receivables', requirePerm('customers.manage'), async (req, res) => {
  const rows = await query(
    `SELECT s.id AS sale_id, s.receipt_no, s.created_at, s.total, s.amount_paid, s.balance_due, s.due_date, c.id AS customer_id, c.name AS customer_name, c.phone,
            (s.due_date IS NOT NULL AND s.due_date < ${today}) AS overdue
       FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.business_id=$1 AND s.balance_due > 0 ORDER BY s.due_date NULLS LAST, s.created_at`, [req.user!.business_id]);
  res.json({ receivables: rows, total_outstanding: round2(rows.reduce((t: number, r: any) => t + r.balance_due, 0)) });
});
