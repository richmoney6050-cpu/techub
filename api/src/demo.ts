import { Db, one, query } from './db.ts';
import { applyStock } from './inventory.ts';
import { refreshSearchText } from './routes/products.ts';

type Demo = { name: string; category: string; sub?: string; brand: string; model?: string; specs?: Record<string, string>; condition?: string;
  variations: Array<{ label?: string; sku: string; cost: number; price: number; qty: number; min: number }> };

const DEMO: Demo[] = [
  { name: 'HP EliteBook 840 G8', category: 'Laptops', brand: 'HP', model: '840 G8', specs: { Processor: 'Intel Core i5', RAM: '16GB', Storage: '512GB SSD' }, condition: 'refurbished',
    variations: [{ sku: 'DEMO-HP-840G8', cost: 3600, price: 4500, qty: 5, min: 2 }] },
  { name: 'Dell Latitude 5420', category: 'Laptops', brand: 'Dell', model: 'Latitude 5420', specs: { Processor: 'Intel Core i7', RAM: '16GB', Storage: '512GB SSD' }, condition: 'refurbished',
    variations: [{ sku: 'DEMO-DELL-5420', cost: 4000, price: 5000, qty: 3, min: 1 }] },
  { name: 'iPhone 16 Case', category: 'Phone Accessories', sub: 'Phone Cases', brand: 'Generic', model: 'iPhone 16', variations: [{ sku: 'DEMO-CASE-IP16', cost: 15, price: 30, qty: 10, min: 3 }] },
  { name: 'iPhone 16 Pro Case', category: 'Phone Accessories', sub: 'Phone Cases', brand: 'Generic', model: 'iPhone 16 Pro', variations: [{ sku: 'DEMO-CASE-IP16P', cost: 20, price: 40, qty: 8, min: 3 }] },
  { name: 'iPhone 16 Pro Max Case', category: 'Phone Accessories', sub: 'Phone Cases', brand: 'Generic', model: 'iPhone 16 Pro Max', variations: [{ sku: 'DEMO-CASE-IP16PM', cost: 25, price: 50, qty: 12, min: 3 }] },
  { name: 'Samsung S24 Case', category: 'Phone Accessories', sub: 'Phone Cases', brand: 'Generic', model: 'Galaxy S24', variations: [{ sku: 'DEMO-CASE-S24', cost: 17, price: 35, qty: 6, min: 2 }] },
  { name: 'Infinix Hot 50 Case', category: 'Phone Accessories', sub: 'Phone Cases', brand: 'Generic', model: 'Hot 50', variations: [{ sku: 'DEMO-CASE-INF50', cost: 8, price: 20, qty: 15, min: 3 }] },
  { name: 'Tecno Camon 40 Case', category: 'Phone Accessories', sub: 'Phone Cases', brand: 'Generic', model: 'Camon 40', variations: [{ sku: 'DEMO-CASE-TC40', cost: 10, price: 25, qty: 10, min: 3 }] },
  { name: 'USB-C Charging Cable 1m', category: 'Phone Accessories', sub: 'Charging Cables', brand: 'Anker', variations: [
    { label: 'Black', sku: 'DEMO-USBC-BLK', cost: 18, price: 40, qty: 20, min: 5 }, { label: 'White', sku: 'DEMO-USBC-WHT', cost: 18, price: 40, qty: 4, min: 5 }] },
  { name: 'Wireless Mouse M185', category: 'Computer Accessories', brand: 'Logitech', model: 'M185', variations: [{ sku: 'DEMO-MOUSE-M185', cost: 45, price: 80, qty: 9, min: 3 }] },
];

/** Inserts clearly-flagged DEMO products (is_demo = true). Safe to remove later with DELETE /api/demo-data. */
export async function loadDemoData(db: Db, businessId: string, userId: string) {
  let n = 0;
  for (const d of DEMO) {
    if (await one('SELECT 1 FROM product_variations WHERE business_id=$1 AND sku=$2', [businessId, d.variations[0].sku], db)) continue;
    const cat = await upsert(db, 'categories', businessId, d.category, null);
    const sub = d.sub ? await upsert(db, 'categories', businessId, d.sub, cat) : null;
    const brand = (await one<any>(`INSERT INTO brands (business_id, name) VALUES ($1,$2) ON CONFLICT (business_id, lower(name)) DO UPDATE SET name=brands.name RETURNING id`, [businessId, d.brand], db)).id;
    const p = await one<any>(
      `INSERT INTO products (business_id, name, category_id, subcategory_id, brand_id, model, condition, specs, is_demo, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9) RETURNING id`,
      [businessId, d.name, cat, sub, brand, d.model || null, d.condition || 'brand_new', JSON.stringify(d.specs || {}), userId], db);
    for (const v of d.variations) {
      const row = await one<any>(
        `INSERT INTO product_variations (business_id, product_id, sku, label, purchase_price, selling_price, is_demo) VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
        [businessId, p.id, v.sku, v.label || null, v.cost, v.price], db);
      await query('INSERT INTO inventory (variation_id, business_id, quantity, min_stock) VALUES ($1,$2,0,$3)', [row.id, businessId, v.min], db);
      await applyStock(db, { businessId, variationId: row.id, delta: v.qty, type: 'initial', userId, reason: 'DEMO sample stock' });
    }
    await refreshSearchText(db, p.id);
    n++;
  }
  return n;
}
async function upsert(db: Db, _t: string, biz: string, name: string, parent: string | null) {
  const f = await one<any>('SELECT id FROM categories WHERE business_id=$1 AND lower(name)=lower($2) AND parent_id IS NOT DISTINCT FROM $3', [biz, name, parent], db);
  if (f) return f.id as string;
  return (await one<any>('INSERT INTO categories (business_id, name, parent_id) VALUES ($1,$2,$3) RETURNING id', [biz, name, parent], db)).id as string;
}
