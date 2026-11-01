import { query, one, Db } from './db.ts';
import { conflict, notFound, bad } from './errors.ts';
import { evaluateStockAlerts, deliverExternal } from './notify.ts';

export type MovementType = 'initial' | 'sale' | 'restock' | 'removed' | 'damaged' | 'missing' | 'return' | 'manual_add' | 'manual_remove' | 'sale_void';

export interface StockChange {
  businessId: string;
  variationId: string;
  delta: number;            // positive adds, negative deducts
  type: MovementType;
  userId: string | null;
  reason?: string | null;
  refType?: string | null;
  refId?: string | null;
}

/**
 * The ONLY place stock quantity changes. Must run inside a transaction.
 * A single conditional UPDATE both locks the row and refuses to go below zero,
 * so concurrent sales can never oversell. A movement row is written in the same transaction.
 */
export async function applyStock(db: Db, ch: StockChange) {
  if (!Number.isInteger(ch.delta) || ch.delta === 0) throw bad('Quantity must be a non-zero whole number');
  const rows = await query<any>(
    `UPDATE inventory i
        SET quantity = i.quantity + $3, updated_at = now()
       FROM product_variations v JOIN products p ON p.id = v.product_id
      WHERE i.variation_id = $1 AND i.business_id = $2 AND v.id = i.variation_id
        AND i.quantity + $3 >= 0
    RETURNING i.quantity AS after, i.quantity - $3 AS before, i.min_stock,
              p.name AS product_name, v.label, v.sku`,
    [ch.variationId, ch.businessId, ch.delta], db);
  if (!rows.length) {
    const exists = await one<any>(
      `SELECT i.quantity, p.name FROM inventory i JOIN product_variations v ON v.id=i.variation_id JOIN products p ON p.id=v.product_id
        WHERE i.variation_id=$1 AND i.business_id=$2`, [ch.variationId, ch.businessId], db);
    if (!exists) throw notFound('Product not found');
    throw conflict(`Not enough stock for ${exists.name}. Available: ${exists.quantity}`, 'insufficient_stock', { available: exists.quantity, variation_id: ch.variationId });
  }
  const r = rows[0];
  const name = r.label ? `${r.product_name} (${r.label})` : r.product_name;
  await query(
    `INSERT INTO stock_movements (business_id, variation_id, product_name, type, qty_before, qty_change, qty_after, reason, ref_type, ref_id, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [ch.businessId, ch.variationId, name, ch.type, r.before, ch.delta, r.after, ch.reason ?? null, ch.refType ?? null, ch.refId ?? null, ch.userId], db);
  // A brand-new product going 0 -> N is not a "restock" event worth notifying about
  const evalBefore = ch.type === 'initial' ? r.after : r.before;
  const alert = await evaluateStockAlerts(db, ch.businessId, ch.variationId, name, evalBefore, r.after, r.min_stock);
  return { before: r.before as number, after: r.after as number, name, alert };
}

/** Call AFTER the transaction commits so email/push are only sent for committed changes. */
export function sendAlerts(businessId: string, alerts: Array<{ title: string; message: string } | null | undefined>) {
  for (const a of alerts) if (a) deliverExternal(businessId, a.title, a.message);
}

export async function nextCounter(db: Db, businessId: string, name: string): Promise<number> {
  const r = await one<{ value: number }>(
    `INSERT INTO counters (business_id, name, value) VALUES ($1,$2,1)
     ON CONFLICT (business_id, name) DO UPDATE SET value = counters.value + 1 RETURNING value`, [businessId, name], db);
  return r!.value;
}
