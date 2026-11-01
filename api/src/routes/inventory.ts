import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx } from '../db.ts';
import { requirePerm, requireAny, audit } from '../auth.ts';
import { applyStock, sendAlerts, MovementType } from '../inventory.ts';
import { notFound, bad } from '../errors.ts';

export const inventoryRouter = Router();

const adjSchema = z.object({
  action: z.enum(['restock', 'damaged', 'missing', 'removed', 'manual_add', 'manual_remove']),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  reason: z.string().trim().max(300).optional(),
  unit_cost: z.coerce.number().min(0).optional(),
});

inventoryRouter.post('/inventory/:variationId/adjust', requirePerm('stock.adjust'), async (req, res) => {
  const b = adjSchema.parse(req.body);
  if (['damaged', 'missing', 'removed', 'manual_add', 'manual_remove'].includes(b.action) && !b.reason) throw bad('Please give a reason for this stock change');
  const biz = req.user!.business_id;
  const sign = ['restock', 'manual_add'].includes(b.action) ? 1 : -1;
  const out = await tx(async (c) => {
    const r = await applyStock(c, { businessId: biz, variationId: String(req.params.variationId), delta: sign * b.quantity, type: b.action as MovementType, userId: req.user!.id, reason: b.reason ?? (b.action === 'restock' ? 'Restocked' : null) });
    if (b.action === 'restock' && b.unit_cost !== undefined && req.user!.permissions.includes('products.edit_price')) {
      await query('UPDATE product_variations SET purchase_price=$3, updated_at=now() WHERE id=$1 AND business_id=$2', [req.params.variationId, biz, b.unit_cost], c);
    }
    await audit(req, req.user, 'stock.' + b.action, 'variation', String(req.params.variationId), { quantity: sign * b.quantity, before: r.before, after: r.after, reason: b.reason }, c);
    return r;
  });
  sendAlerts(biz, [out.alert]);
  res.json({ quantity_before: out.before, quantity_after: out.after, name: out.name });
});

inventoryRouter.get('/inventory/movements', requireAny('stock.adjust', 'reports.view'), async (req, res) => {
  const q = z.object({
    variation_id: z.string().uuid().optional(), type: z.string().max(30).optional(), user_id: z.string().uuid().optional(),
    from: z.string().optional(), to: z.string().optional(), q: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0),
  }).parse(req.query);
  const params: any[] = [req.user!.business_id];
  const w = ['m.business_id=$1'];
  const add = (sql: string, v: any) => { params.push(v); w.push(sql.replaceAll('?', '$' + params.length)); };
  if (q.variation_id) add('m.variation_id=?', q.variation_id);
  if (q.type) add('m.type=?', q.type);
  if (q.user_id) add('m.user_id=?', q.user_id);
  if (q.from) add('m.created_at >= ?::date', q.from);
  if (q.to) add(`m.created_at < (?::date + 1)`, q.to);
  if (q.q) add('lower(m.product_name) LIKE ?', `%${q.q.toLowerCase()}%`);
  const rows = await query(
    `SELECT m.id, m.product_name, m.variation_id, m.type, m.qty_before, m.qty_change, m.qty_after, m.reason, m.created_at, u.name AS user_name
       FROM stock_movements m LEFT JOIN users u ON u.id=m.user_id WHERE ${w.join(' AND ')} ORDER BY m.created_at DESC, m.id LIMIT ${q.limit} OFFSET ${q.offset}`, params);
  res.json({ movements: rows });
});
