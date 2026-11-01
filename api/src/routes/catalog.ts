import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db.ts';
import { requirePerm, requireAny, audit } from '../auth.ts';
import { notFound, conflict } from '../errors.ts';

export const catalogRouter = Router();
const view = requireAny('products.view', 'products.create', 'products.edit');

catalogRouter.get('/categories', view, async (req, res) => {
  const rows = await query(
    `SELECT c.id, c.name, c.parent_id,
            (SELECT count(*) FROM products p WHERE p.is_active AND (p.category_id=c.id OR p.subcategory_id=c.id)) AS product_count
       FROM categories c WHERE c.business_id=$1 ORDER BY c.parent_id NULLS FIRST, lower(c.name)`, [req.user!.business_id]);
  res.json({ categories: rows });
});

const catSchema = z.object({ name: z.string().trim().min(1).max(80), parent_id: z.string().uuid().nullable().optional() });
catalogRouter.post('/categories', requirePerm('products.create'), async (req, res) => {
  const b = catSchema.parse(req.body);
  if (b.parent_id && !(await one('SELECT 1 FROM categories WHERE id=$1 AND business_id=$2', [b.parent_id, req.user!.business_id]))) throw notFound('Parent category not found');
  try {
    const row = await one('INSERT INTO categories (business_id, parent_id, name) VALUES ($1,$2,$3) RETURNING id, name, parent_id', [req.user!.business_id, b.parent_id ?? null, b.name]);
    await audit(req, req.user, 'category.create', 'category', row.id, { name: b.name });
    res.status(201).json({ category: row });
  } catch (e: any) { if (e.code === '23505') throw conflict('That category already exists'); throw e; }
});
catalogRouter.put('/categories/:id', requirePerm('products.edit'), async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  try {
    const row = await one('UPDATE categories SET name=$3 WHERE id=$1 AND business_id=$2 RETURNING id, name, parent_id', [req.params.id, req.user!.business_id, b.name]);
    if (!row) throw notFound();
    await audit(req, req.user, 'category.update', 'category', row.id, { name: b.name });
    res.json({ category: row });
  } catch (e: any) { if (e.code === '23505') throw conflict('That category already exists'); throw e; }
});
catalogRouter.delete('/categories/:id', requirePerm('products.delete'), async (req, res) => {
  const row = await one('DELETE FROM categories WHERE id=$1 AND business_id=$2 RETURNING id, name', [req.params.id, req.user!.business_id]);
  if (!row) throw notFound();
  await audit(req, req.user, 'category.delete', 'category', row.id, { name: row.name });
  res.json({ ok: true });
});

catalogRouter.get('/brands', view, async (req, res) => {
  res.json({ brands: await query('SELECT id, name FROM brands WHERE business_id=$1 ORDER BY lower(name)', [req.user!.business_id]) });
});
catalogRouter.post('/brands', requirePerm('products.create'), async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  try {
    const row = await one('INSERT INTO brands (business_id, name) VALUES ($1,$2) RETURNING id, name', [req.user!.business_id, b.name]);
    await audit(req, req.user, 'brand.create', 'brand', row.id, { name: b.name });
    res.status(201).json({ brand: row });
  } catch (e: any) { if (e.code === '23505') throw conflict('That brand already exists'); throw e; }
});
catalogRouter.delete('/brands/:id', requirePerm('products.delete'), async (req, res) => {
  const row = await one('DELETE FROM brands WHERE id=$1 AND business_id=$2 RETURNING id, name', [req.params.id, req.user!.business_id]);
  if (!row) throw notFound();
  await audit(req, req.user, 'brand.delete', 'brand', row.id, { name: row.name });
  res.json({ ok: true });
});
