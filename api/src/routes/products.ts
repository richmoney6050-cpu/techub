import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { query, one, tx, Db, round2 } from '../db.ts';
import { requirePerm, requireAny, can, audit } from '../auth.ts';
import { notFound, conflict, bad, forbidden } from '../errors.ts';
import { applyStock, sendAlerts, nextCounter } from '../inventory.ts';
import { upload, saveImage } from '../files.ts';
import { loadDemoData } from '../demo.ts';

export const productsRouter = Router();

const money = z.coerce.number().min(0).max(100_000_000).transform(round2);
const int = z.coerce.number().int();

const variationSchema = z.object({
  sku: z.string().trim().min(1).max(60).optional(),
  barcode: z.string().trim().max(60).optional().nullable(),
  label: z.string().trim().max(120).optional().nullable(),
  attributes: z.record(z.string().max(100)).optional(),
  purchase_price: money.default(0),
  selling_price: money,
  quantity: int.min(0).max(1_000_000).default(0),
  min_stock: int.min(0).max(1_000_000).optional(),
});
const productSchema = z.object({
  name: z.string().trim().min(2).max(200),
  category_id: z.string().uuid().optional().nullable(),
  category_name: z.string().trim().max(80).optional(),
  subcategory_id: z.string().uuid().optional().nullable(),
  subcategory_name: z.string().trim().max(80).optional(),
  brand_id: z.string().uuid().optional().nullable(),
  brand_name: z.string().trim().max(80).optional(),
  model: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  condition: z.enum(['brand_new', 'used', 'refurbished']).default('brand_new'),
  specs: z.record(z.string().max(300)).default({}),
  variations: z.array(variationSchema).min(1).max(100),
});

const genSku = () => 'TH-' + crypto.randomBytes(4).toString('hex').toUpperCase();

async function resolveCategory(db: Db, biz: string, id?: string | null, name?: string, parent?: string | null) {
  if (id) {
    if (!(await one('SELECT 1 FROM categories WHERE id=$1 AND business_id=$2', [id, biz], db))) throw bad('Category not found');
    return id;
  }
  if (!name) return null;
  const found = await one<any>(`SELECT id FROM categories WHERE business_id=$1 AND lower(name)=lower($2) AND parent_id IS NOT DISTINCT FROM $3`, [biz, name, parent ?? null], db);
  if (found) return found.id;
  return (await one<any>('INSERT INTO categories (business_id, name, parent_id) VALUES ($1,$2,$3) RETURNING id', [biz, name, parent ?? null], db)).id;
}
async function resolveBrand(db: Db, biz: string, id?: string | null, name?: string) {
  if (id) {
    if (!(await one('SELECT 1 FROM brands WHERE id=$1 AND business_id=$2', [id, biz], db))) throw bad('Brand not found');
    return id;
  }
  if (!name) return null;
  const found = await one<any>('SELECT id FROM brands WHERE business_id=$1 AND lower(name)=lower($2)', [biz, name], db);
  if (found) return found.id;
  return (await one<any>('INSERT INTO brands (business_id, name) VALUES ($1,$2) RETURNING id', [biz, name], db)).id;
}

export async function refreshSearchText(db: Db, productId: string) {
  await query(
    `UPDATE product_variations v SET search_text = lower(concat_ws(' ', p.name, p.model, b.name, c.name, sc.name, v.label, v.sku, v.barcode, p.specs::text, v.attributes::text, p.description))
       FROM products p LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN categories sc ON sc.id=p.subcategory_id
      WHERE v.product_id = p.id AND p.id = $1`, [productId], db);
}

async function insertVariation(db: Db, biz: string, productId: string, v: z.infer<typeof variationSchema>, userId: string, defaultMin: number) {
  const sku = v.sku || genSku();
  let row: any;
  try {
    row = await one<any>(
      `INSERT INTO product_variations (business_id, product_id, sku, barcode, label, attributes, purchase_price, selling_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, sku`,
      [biz, productId, sku, v.barcode || null, v.label || null, JSON.stringify(v.attributes || {}), v.purchase_price, v.selling_price], db);
  } catch (e: any) {
    if (e.code === '23505') throw conflict(e.constraint?.includes('barcode') ? 'That barcode is already used by another product' : `SKU "${sku}" already exists`, 'duplicate_sku');
    throw e;
  }
  await query('INSERT INTO inventory (variation_id, business_id, quantity, min_stock) VALUES ($1,$2,0,$3)', [row.id, biz, v.min_stock ?? defaultMin], db);
  let alert = null;
  if (v.quantity > 0) alert = (await applyStock(db, { businessId: biz, variationId: row.id, delta: v.quantity, type: 'initial', userId, reason: 'Initial stock when product was added' })).alert;
  return { id: row.id as string, sku: row.sku as string, alert };
}

// ---------- LIST / SEARCH (variation-level rows; always live from the database) ----------
productsRouter.get('/products', requireAny('products.view', 'products.create', 'products.edit', 'sales.create'), async (req, res) => {
  const q = z.object({
    q: z.string().trim().max(200).optional(), category_id: z.string().uuid().optional(), brand_id: z.string().uuid().optional(),
    min_price: z.coerce.number().min(0).optional(), max_price: z.coerce.number().min(0).optional(),
    stock: z.enum(['in', 'low', 'out', 'available']).optional(), include_inactive: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
  }).parse(req.query);
  const showCost = can(req.user, 'products.view_cost');
  const where = ['v.business_id = $1'];
  const params: any[] = [req.user!.business_id];
  const add = (sql: string, val: any) => { params.push(val); where.push(sql.replaceAll('?', '$' + params.length)); };
  if (!(q.include_inactive === 'true' && can(req.user, 'products.edit'))) where.push('v.is_active AND p.is_active');
  for (const term of (q.q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) add(`v.search_text LIKE ?`, `%${term.replace(/[%_\\]/g, '\\$&')}%`);
  if (q.category_id) add('(p.category_id = ? OR p.subcategory_id = ?)', q.category_id);
  if (q.brand_id) add('p.brand_id = ?', q.brand_id);
  if (q.min_price !== undefined) add('v.selling_price >= ?', q.min_price);
  if (q.max_price !== undefined) add('v.selling_price <= ?', q.max_price);
  if (q.stock === 'in') where.push(`i.status = 'in_stock'`);
  if (q.stock === 'low') where.push(`i.status = 'low_stock'`);
  if (q.stock === 'out') where.push(`i.status = 'out_of_stock'`);
  if (q.stock === 'available') where.push(`i.quantity > 0`);
  const whereSql = where.join(' AND ');
  const base = `FROM product_variations v JOIN products p ON p.id=v.product_id JOIN inventory i ON i.variation_id=v.id
      LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN categories sc ON sc.id=p.subcategory_id
      WHERE ${whereSql}`;
  const total = (await one<any>(`SELECT count(*) AS n ${base}`, params))!.n;
  const rows = await query(
    `SELECT v.id AS variation_id, p.id AS product_id, p.name, v.label, v.sku, v.barcode, v.attributes, p.model, b.name AS brand, b.id AS brand_id,
            c.name AS category, c.id AS category_id, sc.name AS subcategory, sc.id AS subcategory_id, p.image_url, p.condition, p.specs, p.description,
            v.selling_price, ${showCost ? 'v.purchase_price,' : ''} i.quantity, i.min_stock, i.status, p.is_demo, v.is_active AND p.is_active AS is_active
     ${base} ORDER BY lower(p.name), lower(coalesce(v.label,'')) LIMIT ${q.limit} OFFSET ${q.offset}`, params);
  res.json({
    total, items: rows, query: q.q || '',
    message: total === 0 ? 'Sorry, this product is currently not available in our inventory.' : undefined,
  });
});

productsRouter.get('/products/:id', requireAny('products.view', 'products.edit'), async (req, res) => {
  const showCost = can(req.user, 'products.view_cost');
  const p = await one<any>(
    `SELECT p.*, b.name AS brand, c.name AS category, sc.name AS subcategory FROM products p LEFT JOIN brands b ON b.id=p.brand_id
       LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN categories sc ON sc.id=p.subcategory_id WHERE p.id=$1 AND p.business_id=$2`, [req.params.id, req.user!.business_id]);
  if (!p) throw notFound('Product not found');
  const variations = await query(
    `SELECT v.id, v.sku, v.barcode, v.label, v.attributes, v.selling_price, ${showCost ? 'v.purchase_price,' : ''} v.is_active, i.quantity, i.min_stock, i.status
       FROM product_variations v JOIN inventory i ON i.variation_id=v.id WHERE v.product_id=$1 ORDER BY v.created_at`, [p.id]);
  res.json({ product: p, variations });
});

// ---------- CREATE ----------
productsRouter.post('/products', requirePerm('products.create'), async (req, res) => {
  const b = productSchema.parse(req.body);
  const biz = req.user!.business_id;
  const out = await tx(async (c) => {
    const bizRow = await one<any>('SELECT default_min_stock FROM businesses WHERE id=$1', [biz], c);
    const categoryId = await resolveCategory(c, biz, b.category_id, b.category_name);
    const subId = await resolveCategory(c, biz, b.subcategory_id, b.subcategory_name, categoryId);
    const brandId = await resolveBrand(c, biz, b.brand_id, b.brand_name);
    const p = await one<any>(
      `INSERT INTO products (business_id, name, category_id, subcategory_id, brand_id, model, description, condition, specs, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [biz, b.name, categoryId, subId, brandId, b.model || null, b.description || null, b.condition, JSON.stringify(b.specs), req.user!.id], c);
    const vars = [];
    for (const v of b.variations) vars.push(await insertVariation(c, biz, p.id, v, req.user!.id, bizRow.default_min_stock));
    await refreshSearchText(c, p.id);
    await audit(req, req.user, 'product.create', 'product', p.id, { name: b.name, variations: vars.length }, c);
    return { id: p.id, variations: vars };
  });
  sendAlerts(biz, out.variations.map((v) => v.alert));
  res.status(201).json({ product_id: out.id, variations: out.variations.map(({ id, sku }) => ({ id, sku })) });
});

// ---------- EDIT PRODUCT DETAILS (no prices) ----------
productsRouter.put('/products/:id', requirePerm('products.edit'), async (req, res) => {
  const b = productSchema.omit({ variations: true }).partial().extend({ is_active: z.boolean().optional() }).parse(req.body);
  const biz = req.user!.business_id;
  await tx(async (c) => {
    const cur = await one<any>('SELECT * FROM products WHERE id=$1 AND business_id=$2 FOR UPDATE', [req.params.id, biz], c);
    if (!cur) throw notFound('Product not found');
    const categoryId = b.category_id !== undefined || b.category_name ? await resolveCategory(c, biz, b.category_id, b.category_name) : cur.category_id;
    const subId = b.subcategory_id !== undefined || b.subcategory_name ? await resolveCategory(c, biz, b.subcategory_id, b.subcategory_name, categoryId) : cur.subcategory_id;
    const brandId = b.brand_id !== undefined || b.brand_name ? await resolveBrand(c, biz, b.brand_id, b.brand_name) : cur.brand_id;
    await query(
      `UPDATE products SET name=$3, category_id=$4, subcategory_id=$5, brand_id=$6, model=$7, description=$8, condition=$9, specs=$10, is_active=$11, updated_at=now() WHERE id=$1 AND business_id=$2`,
      [cur.id, biz, b.name ?? cur.name, categoryId, subId, brandId, b.model !== undefined ? b.model : cur.model, b.description !== undefined ? b.description : cur.description,
       b.condition ?? cur.condition, JSON.stringify(b.specs ?? cur.specs), b.is_active ?? cur.is_active], c);
    await refreshSearchText(c, cur.id);
    await audit(req, req.user, 'product.update', 'product', cur.id, { fields: Object.keys(b) }, c);
  });
  res.json({ ok: true });
});

productsRouter.post('/products/:id/image', requirePerm('products.edit'), upload.single('image'), async (req, res) => {
  const biz = req.user!.business_id;
  if (!(await one('SELECT 1 FROM products WHERE id=$1 AND business_id=$2', [req.params.id, biz]))) throw notFound('Product not found');
  const url = saveImage(biz, req.file);
  await query('UPDATE products SET image_url=$3, updated_at=now() WHERE id=$1 AND business_id=$2', [req.params.id, biz, url]);
  await audit(req, req.user, 'product.image', 'product', String(req.params.id));
  res.json({ image_url: url });
});

// ---------- VARIATIONS ----------
productsRouter.post('/products/:id/variations', requirePerm('products.create'), async (req, res) => {
  const v = variationSchema.parse(req.body);
  const biz = req.user!.business_id;
  const out = await tx(async (c) => {
    if (!(await one('SELECT 1 FROM products WHERE id=$1 AND business_id=$2', [req.params.id, biz], c))) throw notFound('Product not found');
    const d = await one<any>('SELECT default_min_stock FROM businesses WHERE id=$1', [biz], c);
    const r = await insertVariation(c, biz, String(req.params.id), v, req.user!.id, d.default_min_stock);
    await refreshSearchText(c, String(req.params.id));
    await audit(req, req.user, 'variation.create', 'variation', r.id, { sku: r.sku }, c);
    return r;
  });
  sendAlerts(biz, [out.alert]);
  res.status(201).json({ id: out.id, sku: out.sku });
});

productsRouter.put('/variations/:id', requireAny('products.edit', 'products.edit_price'), async (req, res) => {
  const b = z.object({
    selling_price: money.optional(), purchase_price: money.optional(),
    label: z.string().trim().max(120).nullable().optional(), barcode: z.string().trim().max(60).nullable().optional(),
    attributes: z.record(z.string().max(100)).optional(), min_stock: int.min(0).max(1_000_000).optional(), is_active: z.boolean().optional(),
    sku: z.string().trim().min(1).max(60).optional(),
  }).parse(req.body);
  // Price changes require the explicit price permission – enforced here on the server.
  if ((b.selling_price !== undefined || b.purchase_price !== undefined) && !can(req.user, 'products.edit_price')) throw forbidden('You are not allowed to change prices');
  if ((b.label !== undefined || b.barcode !== undefined || b.attributes !== undefined || b.min_stock !== undefined || b.is_active !== undefined || b.sku !== undefined) && !can(req.user, 'products.edit')) throw forbidden();
  const biz = req.user!.business_id;
  const out = await tx(async (c) => {
    const cur = await one<any>('SELECT * FROM product_variations WHERE id=$1 AND business_id=$2 FOR UPDATE', [req.params.id, biz], c);
    if (!cur) throw notFound('Product not found');
    try {
      await query(
        `UPDATE product_variations SET selling_price=$3, purchase_price=$4, label=$5, barcode=$6, attributes=$7, is_active=$8, sku=$9, updated_at=now() WHERE id=$1 AND business_id=$2`,
        [cur.id, biz, b.selling_price ?? cur.selling_price, b.purchase_price ?? cur.purchase_price, b.label !== undefined ? b.label : cur.label,
         b.barcode !== undefined ? (b.barcode || null) : cur.barcode, JSON.stringify(b.attributes ?? cur.attributes), b.is_active ?? cur.is_active, b.sku ?? cur.sku], c);
    } catch (e: any) { if (e.code === '23505') throw conflict('That SKU or barcode is already in use'); throw e; }
    let alert = null;
    if (b.min_stock !== undefined) {
      const inv = await one<any>('UPDATE inventory SET min_stock=$2, updated_at=now() WHERE variation_id=$1 RETURNING quantity, min_stock', [cur.id, b.min_stock], c);
      // Re-evaluate alerts against the new threshold (no duplicates thanks to unique index)
      const { evaluateStockAlerts } = await import('../notify.ts');
      alert = await evaluateStockAlerts(c, biz, cur.id, cur.sku, inv.quantity, inv.quantity, inv.min_stock);
    }
    await refreshSearchText(c, cur.product_id);
    await audit(req, req.user, 'variation.update', 'variation', cur.id, {
      before: { selling_price: cur.selling_price, purchase_price: cur.purchase_price }, changes: b }, c);
    return alert;
  });
  sendAlerts(biz, [out]);
  res.json({ ok: true });
});

// ---------- DELETE ----------
productsRouter.delete('/products/:id', requirePerm('products.delete'), async (req, res) => {
  const biz = req.user!.business_id;
  const result = await tx(async (c) => {
    const p = await one<any>('SELECT id, name FROM products WHERE id=$1 AND business_id=$2 FOR UPDATE', [req.params.id, biz], c);
    if (!p) throw notFound('Product not found');
    const used = await one<any>(
      `SELECT (SELECT count(*) FROM sale_items si JOIN product_variations v ON v.id=si.variation_id WHERE v.product_id=$1)
            + (SELECT count(*) FROM purchase_order_items oi JOIN product_variations v ON v.id=oi.variation_id WHERE v.product_id=$1) AS n`, [p.id], c);
    if (used.n > 0) {
      await query('UPDATE products SET is_active=false, updated_at=now() WHERE id=$1', [p.id], c);
      await query('UPDATE product_variations SET is_active=false WHERE product_id=$1', [p.id], c);
      await audit(req, req.user, 'product.archive', 'product', p.id, { name: p.name }, c);
      return 'archived';
    }
    await query('DELETE FROM products WHERE id=$1', [p.id], c);
    await audit(req, req.user, 'product.delete', 'product', p.id, { name: p.name }, c);
    return 'deleted';
  });
  res.json({ ok: true, result, message: result === 'archived' ? 'This product has sales history, so it was archived instead of erased.' : 'Product deleted.' });
});

// ---------- DEMO DATA ----------
productsRouter.delete('/demo-data', requirePerm('products.delete'), async (req, res) => {
  const biz = req.user!.business_id;
  const n = await tx(async (c) => {
    await query(`UPDATE products SET is_active=false WHERE business_id=$1 AND is_demo`, [biz], c);
    await query(`UPDATE product_variations SET is_active=false WHERE business_id=$1 AND is_demo`, [biz], c);
    const del = await query(
      `DELETE FROM products p WHERE p.business_id=$1 AND p.is_demo AND NOT EXISTS (
         SELECT 1 FROM product_variations v WHERE v.product_id=p.id AND (EXISTS (SELECT 1 FROM sale_items s WHERE s.variation_id=v.id) OR EXISTS (SELECT 1 FROM purchase_order_items o WHERE o.variation_id=v.id))) RETURNING id`, [biz], c);
    await query(`UPDATE notifications SET resolved=true WHERE business_id=$1 AND variation_id IN (SELECT id FROM product_variations WHERE business_id=$1 AND NOT is_active)`, [biz], c);
    await audit(req, req.user, 'demo.clear', 'product', undefined, { removed: del.length }, c);
    return del.length;
  });
  res.json({ ok: true, removed: n });
});

productsRouter.post('/demo-data', requirePerm('products.create', 'stock.adjust'), async (req, res) => {
  const n = await tx((c) => loadDemoData(c, req.user!.business_id, req.user!.id));
  await audit(req, req.user, 'demo.load', 'product', undefined, { added: n });
  res.json({ ok: true, added: n, message: 'Sample products were added and are marked DEMO. Remove them any time from Settings.' });
});

// Generate a unique in-store EAN-13 barcode (prefix 200 = store-internal range) for a variation that has none.
const ean13 = (twelve: string) => { let s = 0; for (let i = 0; i < 12; i++) s += Number(twelve[i]) * (i % 2 ? 3 : 1); return twelve + String((10 - (s % 10)) % 10); };
productsRouter.post('/variations/:id/barcode', requirePerm('products.edit'), async (req, res) => {
  const biz = req.user!.business_id;
  const code = await tx(async (c) => {
    const v = await one<any>('SELECT id, barcode FROM product_variations WHERE id=$1 AND business_id=$2 FOR UPDATE', [req.params.id, biz], c);
    if (!v) throw notFound('Product not found');
    if (v.barcode) throw conflict('This product already has a barcode');
    for (let i = 0; i < 20; i++) {
      const code = ean13('200' + String(await nextCounter(c, biz, 'barcode')).padStart(9, '0'));
      if (!(await one('SELECT 1 FROM product_variations WHERE business_id=$1 AND barcode=$2', [biz, code], c))) {
        await query('UPDATE product_variations SET barcode=$2, updated_at=now() WHERE id=$1', [v.id, code], c);
        await audit(req, req.user, 'product.barcode', 'variation', v.id, { barcode: code }, c);
        return code;
      }
    }
    throw conflict('Could not generate a unique barcode, try again');
  });
  res.status(201).json({ barcode: code });
});
