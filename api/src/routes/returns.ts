import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx, round2, Db } from '../db.ts';
import { requirePerm, can, audit } from '../auth.ts';
import { applyStock, sendAlerts, nextCounter } from '../inventory.ts';
import { bad, notFound, conflict, forbidden } from '../errors.ts';

export const returnsRouter = Router();

async function payRefund(c: Db, biz: string, userId: string, ret: any, method: string) {
  const sale = await one<any>('SELECT id, total, refunded_total FROM sales WHERE id=$1 AND business_id=$2 FOR UPDATE', [ret.sale_id, biz], c);
  const newTotal = round2(sale.refunded_total + ret.refund_amount);
  if (newTotal > sale.total + 0.001) throw conflict('Refund would be more than the sale total');
  await query(`INSERT INTO payments (business_id, sale_id, kind, method, amount, created_by) VALUES ($1,$2,'refund',$3,$4,$5)`, [biz, sale.id, method, ret.refund_amount, userId], c);
  await query(`UPDATE sales SET refunded_total=$2, status=CASE WHEN $2 >= total THEN 'refunded' ELSE 'partially_refunded' END WHERE id=$1`, [sale.id, newTotal], c);
  await query(`UPDATE returns SET refund_status='paid', refund_method=$2 WHERE id=$1`, [ret.id, method], c);
}

returnsRouter.post('/returns', requirePerm('returns.process'), async (req, res) => {
  const b = z.object({
    sale_id: z.string().uuid(), type: z.enum(['return', 'exchange']), reason: z.string().trim().min(3).max(300),
    items: z.array(z.object({ sale_item_id: z.string().uuid(), quantity: z.coerce.number().int().min(1) })).min(1),
    request_refund: z.boolean().default(false), refund_method: z.enum(['cash', 'momo', 'bank_transfer', 'card']).optional(),
  }).parse(req.body);
  if (b.type === 'exchange' && b.request_refund) throw bad('An exchange does not create a refund. Choose "return" to refund.');
  const biz = req.user!.business_id;
  const id = await tx(async (c) => {
    const sale = await one<any>('SELECT * FROM sales WHERE id=$1 AND business_id=$2 FOR UPDATE', [b.sale_id, biz], c);
    if (!sale) throw notFound('Original sale not found');
    let refund = 0;
    const picked: any[] = [];
    const seen = new Set<string>();
    for (const it of b.items) {
      if (seen.has(it.sale_item_id)) throw bad('Each product can only be listed once per return');
      seen.add(it.sale_item_id);
      const si = await one<any>('SELECT * FROM sale_items WHERE id=$1 AND sale_id=$2 FOR UPDATE', [it.sale_item_id, sale.id], c);
      if (!si) throw notFound('That item was not part of this sale');
      if (it.quantity > si.quantity - si.returned_qty) throw conflict(`Only ${si.quantity - si.returned_qty} of "${si.product_name}" can still be returned`);
      await query('UPDATE sale_items SET returned_qty = returned_qty + $2 WHERE id=$1', [si.id, it.quantity], c);
      // refund the price actually paid: line price minus its proportional share of the sale discount
      const share = sale.subtotal > 0 ? 1 - sale.discount / sale.subtotal : 1;
      refund += si.unit_price * it.quantity * share;
      picked.push({ si, qty: it.quantity });
    }
    refund = round2(refund);
    const no = await nextCounter(c, biz, 'return');
    const ret = await one<any>(
      `INSERT INTO returns (business_id, sale_id, return_no, type, reason, refund_amount, refund_status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [biz, sale.id, `RET-${String(no).padStart(5, '0')}`, b.type, b.reason, b.request_refund ? refund : 0, b.request_refund ? 'requested' : 'none', req.user!.id], c);
    for (const p of picked) await query('INSERT INTO return_items (return_id, sale_item_id, variation_id, quantity) VALUES ($1,$2,$3,$4)', [ret.id, p.si.id, p.si.variation_id, p.qty], c);
    // Staff with refund authority can pay immediately
    if (b.request_refund && can(req.user, 'returns.refund')) await payRefund(c, biz, req.user!.id, ret, b.refund_method || sale.payment_method);
    await audit(req, req.user, 'return.create', 'return', ret.id, { return_no: ret.return_no, type: b.type, refund }, c);
    return ret.id as string;
  });
  res.status(201).json({ return: await getReturn(biz, id) });
});

async function getReturn(biz: string, id: string) {
  const r = await one<any>(
    `SELECT r.*, s.receipt_no, u.name AS created_by_name FROM returns r JOIN sales s ON s.id=r.sale_id LEFT JOIN users u ON u.id=r.created_by WHERE r.id=$1 AND r.business_id=$2`, [id, biz]);
  if (!r) throw notFound('Return not found');
  r.items = await query(
    `SELECT ri.id, ri.quantity, ri.condition, ri.resellable, ri.restocked, si.product_name AS name, si.unit_price FROM return_items ri JOIN sale_items si ON si.id=ri.sale_item_id WHERE ri.return_id=$1`, [id]);
  return r;
}

returnsRouter.get('/returns', requirePerm('returns.process'), async (req, res) => {
  const rows = await query(
    `SELECT r.id, r.return_no, r.type, r.reason, r.status, r.refund_amount, r.refund_status, r.created_at, s.receipt_no, u.name AS created_by_name
       FROM returns r JOIN sales s ON s.id=r.sale_id LEFT JOIN users u ON u.id=r.created_by WHERE r.business_id=$1 ORDER BY r.created_at DESC LIMIT 200`, [req.user!.business_id]);
  res.json({ returns: rows });
});
returnsRouter.get('/returns/:id', requirePerm('returns.process'), async (req, res) => {
  res.json({ return: await getReturn(req.user!.business_id, String(req.params.id)) });
});

// Inspection decides whether returned goods go back on the shelf. Requires stock authority.
returnsRouter.post('/returns/:id/inspect', requirePerm('returns.process', 'stock.adjust'), async (req, res) => {
  const b = z.object({ items: z.array(z.object({ id: z.string().uuid(), condition: z.string().trim().min(2).max(120), resellable: z.boolean() })).min(1) }).parse(req.body);
  const biz = req.user!.business_id;
  const alerts: any[] = [];
  await tx(async (c) => {
    const ret = await one<any>('SELECT * FROM returns WHERE id=$1 AND business_id=$2 FOR UPDATE', [req.params.id, biz], c);
    if (!ret) throw notFound('Return not found');
    if (ret.status !== 'pending_inspection') throw conflict('This return was already inspected');
    const items = await query<any>('SELECT * FROM return_items WHERE return_id=$1', [ret.id], c);
    if (items.length !== b.items.length || !items.every((i) => b.items.some((x) => x.id === i.id))) throw bad('Please inspect every returned item');
    for (const it of b.items) {
      const ri = items.find((i) => i.id === it.id);
      let restocked = false;
      if (it.resellable) {
        const r = await applyStock(c, { businessId: biz, variationId: ri.variation_id, delta: ri.quantity, type: 'return', userId: req.user!.id, reason: `Return ${ret.return_no}: ${it.condition}`, refType: 'return', refId: ret.id });
        alerts.push(r.alert);
        restocked = true;
      }
      await query('UPDATE return_items SET condition=$2, resellable=$3, restocked=$4, inspected_by=$5, inspected_at=now() WHERE id=$1', [ri.id, it.condition, it.resellable, restocked, req.user!.id], c);
    }
    await query(`UPDATE returns SET status='inspected' WHERE id=$1`, [ret.id], c);
    await audit(req, req.user, 'return.inspect', 'return', ret.id, { items: b.items }, c);
  });
  sendAlerts(biz, alerts);
  res.json({ return: await getReturn(biz, String(req.params.id)) });
});

// Approve/deny a requested refund
returnsRouter.post('/returns/:id/refund', requirePerm('returns.refund'), async (req, res) => {
  const b = z.object({ approve: z.boolean(), method: z.enum(['cash', 'momo', 'bank_transfer', 'card']).optional() }).parse(req.body);
  const biz = req.user!.business_id;
  await tx(async (c) => {
    const ret = await one<any>('SELECT * FROM returns WHERE id=$1 AND business_id=$2 FOR UPDATE', [req.params.id, biz], c);
    if (!ret) throw notFound('Return not found');
    if (ret.refund_status !== 'requested') throw conflict('There is no pending refund on this return');
    if (b.approve) await payRefund(c, biz, req.user!.id, ret, b.method || 'cash');
    else await query(`UPDATE returns SET refund_status='denied' WHERE id=$1`, [ret.id], c);
    await audit(req, req.user, b.approve ? 'return.refund_paid' : 'return.refund_denied', 'return', ret.id, { amount: ret.refund_amount }, c);
  });
  res.json({ return: await getReturn(biz, String(req.params.id)) });
});

returnsRouter.post('/returns/:id/link-exchange', requirePerm('returns.process'), async (req, res) => {
  const b = z.object({ sale_id: z.string().uuid() }).parse(req.body);
  const biz = req.user!.business_id;
  const ok = await one('SELECT 1 FROM sales WHERE id=$1 AND business_id=$2', [b.sale_id, biz]);
  if (!ok) throw notFound('Replacement sale not found');
  const r = await one(`UPDATE returns SET exchange_sale_id=$3 WHERE id=$1 AND business_id=$2 AND type='exchange' RETURNING id`, [req.params.id, biz, b.sale_id]);
  if (!r) throw notFound('Exchange not found');
  await audit(req, req.user, 'return.link_exchange', 'return', String(req.params.id), { sale_id: b.sale_id });
  res.json({ return: await getReturn(biz, String(req.params.id)) });
});
