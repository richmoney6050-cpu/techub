import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx } from '../db.ts';
import { requirePerm, audit } from '../auth.ts';
import { bad, notFound, conflict } from '../errors.ts';
import { config } from '../config.ts';

export const warrantiesRouter = Router();
const today = `(now() AT TIME ZONE '${config.timezone}')::date`;
// 'active' warranties past their end date are reported as 'expired' without needing a background update
const effStatus = `CASE WHEN w.status='active' AND w.end_date < ${today} THEN 'expired' ELSE w.status END`;
const SELECT = `SELECT w.id, w.product_name, w.serial_number, w.imei, w.purchase_date, w.start_date, w.end_date, w.duration_months, w.conditions, w.created_at,
  ${effStatus} AS status, (w.end_date - ${today}) AS days_left, w.sale_id, s.receipt_no, w.customer_id, c.name AS customer_name, c.phone AS customer_phone
  FROM warranties w LEFT JOIN customers c ON c.id=w.customer_id LEFT JOIN sales s ON s.id=w.sale_id`;

// Search by serial / IMEI / product / customer / receipt
warrantiesRouter.get('/warranties', requirePerm('warranty.manage'), async (req, res) => {
  const q = z.object({ q: z.string().max(80).optional(), status: z.enum(['active', 'expired', 'under_review', 'claimed', 'completed']).optional(),
    expiring_days: z.coerce.number().int().min(1).max(365).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
  const params: any[] = [req.user!.business_id]; const w = ['w.business_id=$1'];
  if (q.q) { params.push(`%${q.q.toLowerCase()}%`); const n = params.length;
    w.push(`(lower(coalesce(w.serial_number,'')) LIKE $${n} OR coalesce(w.imei,'') LIKE $${n} OR lower(w.product_name) LIKE $${n} OR lower(coalesce(c.name,'')) LIKE $${n} OR lower(coalesce(s.receipt_no,'')) LIKE $${n})`); }
  if (q.status) { params.push(q.status); w.push(`${effStatus} = $${params.length}`); }
  if (q.expiring_days) { params.push(q.expiring_days); w.push(`w.status='active' AND w.end_date >= ${today} AND w.end_date <= ${today} + $${params.length}::int`); }
  const rows = await query(`${SELECT} WHERE ${w.join(' AND ')} ORDER BY w.end_date ASC LIMIT ${q.limit} OFFSET ${q.offset}`, params);
  res.json({ warranties: rows });
});

const createSchema = z.object({
  sale_id: z.string().uuid().optional(), sale_item_id: z.string().uuid().optional(), customer_id: z.string().uuid().optional(),
  product_name: z.string().trim().min(2).max(200).optional(),
  serial_number: z.string().trim().max(80).optional(), imei: z.string().trim().regex(/^\d{14,17}$/, 'IMEI must be 14–17 digits').optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), duration_months: z.coerce.number().int().min(1).max(120),
  conditions: z.string().trim().max(1000).optional(),
}).refine((b) => b.serial_number || b.imei, { message: 'Enter a serial number or an IMEI' });

warrantiesRouter.post('/warranties', requirePerm('warranty.manage'), async (req, res) => {
  const b = createSchema.parse(req.body); const biz = req.user!.business_id;
  const row = await tx(async (c) => {
    let name = b.product_name, variationId: string | null = null, saleId = b.sale_id || null, customerId = b.customer_id || null, purchaseDate: string | null = null;
    if (b.sale_item_id) {
      const it = await one<any>(`SELECT si.id, si.sale_id, si.variation_id, si.product_name, s.customer_id, (s.created_at AT TIME ZONE '${config.timezone}')::date AS d
                                   FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.id=$1 AND si.business_id=$2`, [b.sale_item_id, biz], c);
      if (!it) throw notFound('Sale item not found');
      name = name || it.product_name; variationId = it.variation_id; saleId = it.sale_id; customerId = customerId || it.customer_id; purchaseDate = it.d;
    } else if (saleId) {
      const s = await one<any>(`SELECT id, customer_id, (created_at AT TIME ZONE '${config.timezone}')::date AS d FROM sales WHERE id=$1 AND business_id=$2`, [saleId, biz], c);
      if (!s) throw notFound('Sale not found');
      customerId = customerId || s.customer_id; purchaseDate = s.d;
    }
    if (customerId && !(await one('SELECT 1 FROM customers WHERE id=$1 AND business_id=$2', [customerId, biz], c))) throw notFound('Customer not found');
    if (!name) throw bad('Enter the product name');
    const start = b.start_date || purchaseDate || null;
    try {
      return await one<any>(
        `INSERT INTO warranties (business_id, sale_id, sale_item_id, customer_id, variation_id, product_name, serial_number, imei, purchase_date, start_date, duration_months, end_date, conditions, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, coalesce($9::date, ${today}), coalesce($10::date, ${today}), $11, (coalesce($10::date, ${today}) + make_interval(months => $11))::date, $12, $13) RETURNING id, end_date`,
        [biz, saleId, b.sale_item_id || null, customerId, variationId, name, b.serial_number || null, b.imei || null, purchaseDate, start, b.duration_months, b.conditions || null, req.user!.id], c);
    } catch (e: any) { if (e.code === '23505') throw conflict('A warranty already exists for that serial number or IMEI'); throw e; }
  });
  await audit(req, req.user, 'warranty.create', 'warranty', row.id, { serial: b.serial_number, imei: b.imei, months: b.duration_months });
  res.status(201).json({ warranty: await one(`${SELECT} WHERE w.id=$1`, [row.id]) });
});

warrantiesRouter.get('/warranties/:id', requirePerm('warranty.manage'), async (req, res) => {
  const w = await one(`${SELECT} WHERE w.id=$1 AND w.business_id=$2`, [req.params.id, req.user!.business_id]);
  if (!w) throw notFound('Warranty not found');
  const claims = await query(`SELECT wc.id, wc.issue, wc.status, wc.resolution, wc.created_at, wc.resolved_at, u.name AS created_by_name FROM warranty_claims wc LEFT JOIN users u ON u.id=wc.created_by WHERE wc.warranty_id=$1 ORDER BY wc.created_at DESC`, [req.params.id]);
  res.json({ warranty: w, claims });
});

warrantiesRouter.post('/warranties/:id/claims', requirePerm('warranty.manage'), async (req, res) => {
  const b = z.object({ issue: z.string().trim().min(3).max(1000) }).parse(req.body); const biz = req.user!.business_id;
  const claim = await tx(async (c) => {
    const w = await one<any>(`SELECT w.id, ${effStatus} AS status FROM warranties w WHERE w.id=$1 AND w.business_id=$2 FOR UPDATE`, [req.params.id, biz], c);
    if (!w) throw notFound('Warranty not found');
    if (w.status !== 'active') throw bad(`Claims can only be opened on an active warranty (this one is ${w.status.replace('_', ' ')})`);
    const cl = await one<any>('INSERT INTO warranty_claims (business_id, warranty_id, issue, created_by) VALUES ($1,$2,$3,$4) RETURNING id', [biz, w.id, b.issue, req.user!.id], c);
    await query("UPDATE warranties SET status='under_review' WHERE id=$1", [w.id], c);
    return cl;
  });
  await audit(req, req.user, 'warranty.claim', 'warranty', String(req.params.id), { claim_id: claim.id });
  res.status(201).json({ claim });
});

// open -> in_service (device claimed / sent for repair) -> resolved | rejected
warrantiesRouter.put('/warranties/:id/claims/:claimId', requirePerm('warranty.manage'), async (req, res) => {
  const b = z.object({ status: z.enum(['in_service', 'resolved', 'rejected']), resolution: z.string().trim().max(1000).optional() }).parse(req.body); const biz = req.user!.business_id;
  await tx(async (c) => {
    const cl = await one<any>('SELECT id, status FROM warranty_claims WHERE id=$1 AND warranty_id=$2 AND business_id=$3 FOR UPDATE', [req.params.claimId, req.params.id, biz], c);
    if (!cl) throw notFound('Claim not found');
    if (cl.status === 'resolved' || cl.status === 'rejected') throw bad('This claim is already closed');
    if (b.status !== 'in_service' && !b.resolution) throw bad('Enter the outcome of the claim');
    await query(`UPDATE warranty_claims SET status=$2, resolution=coalesce($3, resolution), resolved_at = CASE WHEN $2 IN ('resolved','rejected') THEN now() ELSE NULL END WHERE id=$1`, [cl.id, b.status, b.resolution || null], c);
    const next = b.status === 'in_service' ? 'claimed' : b.status === 'resolved' ? 'completed' : 'active';
    await query('UPDATE warranties SET status=$2 WHERE id=$1', [req.params.id, next], c);
  });
  await audit(req, req.user, 'warranty.claim_update', 'warranty', String(req.params.id), { claim_id: req.params.claimId, status: b.status });
  res.json({ ok: true });
});
