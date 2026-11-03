import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx, round2 } from '../db.ts';
import { requirePerm, requireAny, audit } from '../auth.ts';
import { applyStock, sendAlerts, nextCounter } from '../inventory.ts';
import { bad, notFound, conflict } from '../errors.ts';

export const suppliersRouter = Router();
const sup = requirePerm('suppliers.manage');

const supplierSchema = z.object({
  name: z.string().trim().min(2).max(160), phone: z.string().trim().max(40).optional().nullable(), email: z.string().trim().email().max(160).optional().nullable().or(z.literal('')),
  address: z.string().trim().max(300).optional().nullable(), products_supplied: z.string().trim().max(500).optional().nullable(),
});

suppliersRouter.get('/suppliers', sup, async (req, res) => {
  const rows = await query(
    `SELECT s.*, coalesce(sum(po.total_cost - po.amount_paid) FILTER (WHERE po.status <> 'cancelled'),0) AS outstanding, count(po.id) AS orders
       FROM suppliers s LEFT JOIN purchase_orders po ON po.supplier_id=s.id WHERE s.business_id=$1 GROUP BY s.id ORDER BY lower(s.name)`, [req.user!.business_id]);
  res.json({ suppliers: rows });
});
suppliersRouter.post('/suppliers', sup, async (req, res) => {
  const b = supplierSchema.parse(req.body);
  const row = await one('INSERT INTO suppliers (business_id,name,phone,email,address,products_supplied) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.user!.business_id, b.name, b.phone || null, b.email || null, b.address || null, b.products_supplied || null]);
  await audit(req, req.user, 'supplier.create', 'supplier', row.id, { name: b.name });
  res.status(201).json({ supplier: row });
});
suppliersRouter.put('/suppliers/:id', sup, async (req, res) => {
  const b = supplierSchema.partial().extend({ is_active: z.boolean().optional() }).parse(req.body);
  const cur = await one<any>('SELECT * FROM suppliers WHERE id=$1 AND business_id=$2', [req.params.id, req.user!.business_id]);
  if (!cur) throw notFound('Supplier not found');
  const row = await one('UPDATE suppliers SET name=$3, phone=$4, email=$5, address=$6, products_supplied=$7, is_active=$8 WHERE id=$1 AND business_id=$2 RETURNING *',
    [cur.id, cur.business_id, b.name ?? cur.name, b.phone !== undefined ? b.phone : cur.phone, b.email !== undefined ? (b.email || null) : cur.email,
     b.address !== undefined ? b.address : cur.address, b.products_supplied !== undefined ? b.products_supplied : cur.products_supplied, b.is_active ?? cur.is_active]);
  await audit(req, req.user, 'supplier.update', 'supplier', cur.id, b);
  res.json({ supplier: row });
});

// ---- purchase orders ----
suppliersRouter.get('/purchase-orders', sup, async (req, res) => {
  const rows = await query(
    `SELECT po.id, po.po_number, po.status, po.total_cost, po.amount_paid, po.total_cost - po.amount_paid AS outstanding, po.created_at, s.name AS supplier_name
       FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE po.business_id=$1 ORDER BY po.created_at DESC LIMIT 200`, [req.user!.business_id]);
  res.json({ purchase_orders: rows });
});
async function getPO(biz: string, id: string) {
  const po = await one<any>(`SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE po.id=$1 AND po.business_id=$2`, [id, biz]);
  if (!po) throw notFound('Purchase order not found');
  po.items = await query(
    `SELECT oi.id, oi.variation_id, oi.qty_ordered, oi.qty_received, oi.unit_cost, p.name || coalesce(' (' || v.label || ')','') AS name, v.sku
       FROM purchase_order_items oi JOIN product_variations v ON v.id=oi.variation_id JOIN products p ON p.id=v.product_id WHERE oi.purchase_order_id=$1`, [id]);
  po.payments = await query('SELECT amount, method, created_at FROM supplier_payments WHERE purchase_order_id=$1 ORDER BY created_at', [id]);
  return po;
}
suppliersRouter.get('/purchase-orders/:id', sup, async (req, res) => res.json({ purchase_order: await getPO(req.user!.business_id, String(req.params.id)) }));

suppliersRouter.post('/purchase-orders', sup, async (req, res) => {
  const b = z.object({
    supplier_id: z.string().uuid(), notes: z.string().trim().max(500).optional(),
    items: z.array(z.object({ variation_id: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(1_000_000), unit_cost: z.coerce.number().min(0) })).min(1).max(200),
  }).parse(req.body);
  const biz = req.user!.business_id;
  const id = await tx(async (c) => {
    if (!(await one('SELECT 1 FROM suppliers WHERE id=$1 AND business_id=$2', [b.supplier_id, biz], c))) throw notFound('Supplier not found');
    const ids = b.items.map((i) => i.variation_id);
    const n = (await one<any>('SELECT count(*) AS n FROM product_variations WHERE id = ANY($1::uuid[]) AND business_id=$2', [ids, biz], c)).n;
    if (n !== new Set(ids).size) throw notFound('One of the products was not found');
    const total = round2(b.items.reduce((s, i) => s + i.quantity * i.unit_cost, 0));
    const no = await nextCounter(c, biz, 'po');
    const po = await one<any>(`INSERT INTO purchase_orders (business_id, supplier_id, po_number, total_cost, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [biz, b.supplier_id, `PO-${String(no).padStart(5, '0')}`, total, b.notes || null, req.user!.id], c);
    for (const i of b.items) await query('INSERT INTO purchase_order_items (purchase_order_id, variation_id, qty_ordered, unit_cost) VALUES ($1,$2,$3,$4)', [po.id, i.variation_id, i.quantity, i.unit_cost], c);
    await audit(req, req.user, 'po.create', 'purchase_order', po.id, { total }, c);
    return po.id as string;
  });
  res.status(201).json({ purchase_order: await getPO(biz, id) });
});

// Stock-receiving: records stock in, updates the inventory history and (optionally) cost price.
suppliersRouter.post('/purchase-orders/:id/receive', requirePerm('suppliers.manage', 'stock.adjust'), async (req, res) => {
  const b = z.object({ items: z.array(z.object({ item_id: z.string().uuid(), quantity: z.coerce.number().int().min(1) })).min(1), update_cost: z.boolean().default(false) }).parse(req.body);
  const biz = req.user!.business_id;
  const alerts: any[] = [];
  await tx(async (c) => {
    const po = await one<any>('SELECT * FROM purchase_orders WHERE id=$1 AND business_id=$2 FOR UPDATE', [req.params.id, biz], c);
    if (!po) throw notFound('Purchase order not found');
    if (po.status === 'cancelled' || po.status === 'received') throw conflict(`This order is already ${po.status}`);
    for (const it of b.items) {
      const row = await one<any>('SELECT * FROM purchase_order_items WHERE id=$1 AND purchase_order_id=$2 FOR UPDATE', [it.item_id, po.id], c);
      if (!row) throw notFound('Order line not found');
      if (it.quantity > row.qty_ordered - row.qty_received) throw conflict(`Only ${row.qty_ordered - row.qty_received} more units are expected for that line`);
      await query('UPDATE purchase_order_items SET qty_received = qty_received + $2 WHERE id=$1', [row.id, it.quantity], c);
      const r = await applyStock(c, { businessId: biz, variationId: row.variation_id, delta: it.quantity, type: 'restock', userId: req.user!.id, reason: `Received on ${po.po_number}`, refType: 'purchase_order', refId: po.id });
      alerts.push(r.alert);
      if (b.update_cost && req.user!.permissions.includes('products.edit_price')) await query('UPDATE product_variations SET purchase_price=$2, updated_at=now() WHERE id=$1', [row.variation_id, row.unit_cost], c);
    }
    const left = await one<any>('SELECT count(*) AS n FROM purchase_order_items WHERE purchase_order_id=$1 AND qty_received < qty_ordered', [po.id], c);
    await query('UPDATE purchase_orders SET status=$2 WHERE id=$1', [po.id, left.n === 0 ? 'received' : 'partially_received'], c);
    await audit(req, req.user, 'po.receive', 'purchase_order', po.id, { items: b.items }, c);
  });
  sendAlerts(biz, alerts);
  res.json({ purchase_order: await getPO(biz, String(req.params.id)) });
});

suppliersRouter.post('/purchase-orders/:id/payments', sup, async (req, res) => {
  const b = z.object({ amount: z.coerce.number().positive(), method: z.string().trim().max(30).optional() }).parse(req.body);
  const biz = req.user!.business_id;
  await tx(async (c) => {
    const po = await one<any>('SELECT * FROM purchase_orders WHERE id=$1 AND business_id=$2 FOR UPDATE', [req.params.id, biz], c);
    if (!po) throw notFound('Purchase order not found');
    if (round2(po.amount_paid + b.amount) > po.total_cost + 0.001) throw bad(`That is more than the outstanding balance of ${round2(po.total_cost - po.amount_paid)}`);
    await query('INSERT INTO supplier_payments (business_id, purchase_order_id, amount, method, created_by) VALUES ($1,$2,$3,$4,$5)', [biz, po.id, b.amount, b.method || null, req.user!.id], c);
    await query('UPDATE purchase_orders SET amount_paid = amount_paid + $2 WHERE id=$1', [po.id, b.amount], c);
    await audit(req, req.user, 'po.payment', 'purchase_order', po.id, { amount: b.amount }, c);
  });
  res.json({ purchase_order: await getPO(biz, String(req.params.id)) });
});

suppliersRouter.post('/purchase-orders/:id/cancel', sup, async (req, res) => {
  const row = await one(`UPDATE purchase_orders SET status='cancelled' WHERE id=$1 AND business_id=$2 AND status='ordered' RETURNING id`, [req.params.id, req.user!.business_id]);
  if (!row) throw conflict('Only orders with nothing received can be cancelled');
  await audit(req, req.user, 'po.cancel', 'purchase_order', String(req.params.id));
  res.json({ ok: true });
});

// ---- expenses ----
suppliersRouter.get('/expenses', requireAny('expenses.manage', 'reports.view'), async (req, res) => {
  const q = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
  const rows = await query(
    `SELECT e.id, e.category, e.description, e.amount, e.expense_date, e.payment_method, u.name AS created_by_name FROM expenses e LEFT JOIN users u ON u.id=e.created_by
      WHERE e.business_id=$1 AND ($2::date IS NULL OR e.expense_date >= $2::date) AND ($3::date IS NULL OR e.expense_date <= $3::date) ORDER BY e.expense_date DESC, e.created_at DESC LIMIT 500`,
    [req.user!.business_id, q.from || null, q.to || null]);
  res.json({ expenses: rows });
});
suppliersRouter.post('/expenses', requirePerm('expenses.manage'), async (req, res) => {
  const b = z.object({ category: z.string().trim().min(2).max(80), description: z.string().trim().max(300).optional(), amount: z.coerce.number().positive().max(100_000_000), payment_method: z.enum(['cash', 'momo', 'bank_transfer', 'card']).default('cash'), expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body);
  const row = await one('INSERT INTO expenses (business_id, category, description, amount, expense_date, created_by, payment_method) VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7) RETURNING *',
    [req.user!.business_id, b.category, b.description || null, round2(b.amount), b.expense_date || null, req.user!.id, b.payment_method]);
  await audit(req, req.user, 'expense.create', 'expense', row.id, { amount: b.amount, category: b.category });
  res.status(201).json({ expense: row });
});
suppliersRouter.delete('/expenses/:id', requirePerm('expenses.manage'), async (req, res) => {
  const row = await one('DELETE FROM expenses WHERE id=$1 AND business_id=$2 RETURNING id, amount, category', [req.params.id, req.user!.business_id]);
  if (!row) throw notFound('Expense not found');
  await audit(req, req.user, 'expense.delete', 'expense', row.id, { amount: row.amount, category: row.category });
  res.json({ ok: true });
});
