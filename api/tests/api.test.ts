// Run with:  DATABASE_URL=postgres://.../techhub_test npm test
// WARNING: wipes all data in the target database. Never point this at real data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgres://techhub:techhub_dev@localhost:5432/techhub_test';
if (/prod|live/i.test(process.env.DATABASE_URL)) throw new Error('Refusing to run tests against a production-looking database');

const { createApp } = await import('../src/app.ts');
const { migrate } = await import('../src/migrate.ts');
const { pool } = await import('../src/db.ts');

let server: Server;
let base = '';
const S: any = {};

async function api(method: string, path: string, token?: string, body?: any) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data: data as any };
}
const key = () => crypto.randomUUID();

before(async () => {
  await migrate();
  await pool.query('TRUNCATE businesses CASCADE');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;

  const reg = await api('POST', '/api/auth/register', undefined, { business_name: 'Test Shop', owner_name: 'Ama Owner', username: 'ama', password: 'Passw0rdOwner' });
  assert.equal(reg.status, 201);
  S.owner = reg.data.token;

  // two employees with different permissions
  const mk = async (username: string, permissions: string[]) => {
    const r = await api('POST', '/api/employees', S.owner, { name: username, username, password: 'Passw0rdEmp1', permissions });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const l = await api('POST', '/api/auth/login', undefined, { username, password: 'Passw0rdEmp1' });
    assert.equal(l.status, 200);
    return { id: r.data.employee.id, token: l.data.token };
  };
  S.kofi = await mk('kofi', ['products.view', 'sales.create', 'sales.view']);
  S.abena = await mk('abena', ['products.view', 'sales.create', 'sales.view']); // "different device" login
  S.limited = await mk('limited', ['products.view']);
});
after(async () => { server?.close(); await pool.end(); });

test('TEST 1: owner creates a product with 10 units', async () => {
  const r = await api('POST', '/api/products', S.owner, {
    name: 'iPhone 16 Case', category_name: 'Phone Accessories', subcategory_name: 'Phone Cases', brand_name: 'Generic', model: 'iPhone 16',
    variations: [{ sku: 'T-CASE-16', purchase_price: 15, selling_price: 30, quantity: 10, min_stock: 3 }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  S.variation = r.data.variations[0].id;
  S.product = r.data.product_id;
});

test('TEST 2: employee searches and sees correct price and quantity', async () => {
  const r = await api('GET', '/api/products?q=iphone%2016%20case', S.kofi.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.items.length, 1);
  const it = r.data.items[0];
  assert.equal(it.selling_price, 30); assert.equal(it.quantity, 10); assert.equal(it.status, 'in_stock');
  assert.equal(it.purchase_price, undefined, 'cost price must be hidden from employees');
  const none = await api('GET', '/api/products?q=nonexistent%20gadget', S.kofi.token);
  assert.equal(none.data.items.length, 0);
  assert.equal(none.data.message, 'Sorry, this product is currently not available in our inventory.');
});

test('TEST 3+4: employee sells 1 unit; stock goes 10 -> 9; receipt produced', async () => {
  const r = await api('POST', '/api/sales', S.kofi.token, { idempotency_key: key(), items: [{ variation_id: S.variation, quantity: 1 }], payment_method: 'cash', amount_paid: 50 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.sale.total, 30); assert.equal(r.data.sale.change_due, 20);
  S.sale1 = r.data.sale.id;
  const p = await api('GET', '/api/products?q=iphone', S.kofi.token);
  assert.equal(p.data.items[0].quantity, 9);
  const pdf = await fetch(`${base}/api/sales/${S.sale1}/receipt.pdf`, { headers: { Authorization: `Bearer ${S.kofi.token}` } });
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
});

test('TEST 5: another employee on another device sees 9', async () => {
  const r = await api('GET', '/api/products?q=iphone', S.abena.token);
  assert.equal(r.data.items[0].quantity, 9);
});

test('TEST 6: owner gets low-stock notification at threshold, only once', async () => {
  // quantity 9, min 3. sell 6 -> 3 (== threshold)
  const r = await api('POST', '/api/sales', S.kofi.token, { idempotency_key: key(), items: [{ variation_id: S.variation, quantity: 6 }], payment_method: 'momo' });
  assert.equal(r.status, 201);
  const n = await api('GET', '/api/notifications', S.owner);
  const low = n.data.notifications.filter((x: any) => x.type === 'low_stock');
  assert.equal(low.length, 1);
  assert.match(low[0].message, /LOW STOCK: Only 3 iPhone 16 Case remaining/);
  // sell 1 more -> 2, still low: no duplicate alert
  await api('POST', '/api/sales', S.kofi.token, { idempotency_key: key(), items: [{ variation_id: S.variation, quantity: 1 }], payment_method: 'card' });
  const n2 = await api('GET', '/api/notifications', S.owner);
  assert.equal(n2.data.notifications.filter((x: any) => x.type === 'low_stock').length, 1);
  // employee without notifications.view cannot see them
  assert.equal((await api('GET', '/api/notifications', S.kofi.token)).status, 403);
});

test('TEST 7: reaching zero marks OUT OF STOCK; cannot oversell', async () => {
  const over = await api('POST', '/api/sales', S.kofi.token, { idempotency_key: key(), items: [{ variation_id: S.variation, quantity: 5 }], payment_method: 'cash' });
  assert.equal(over.status, 409); assert.equal(over.data.code, 'insufficient_stock');
  const r = await api('POST', '/api/sales', S.kofi.token, { idempotency_key: key(), items: [{ variation_id: S.variation, quantity: 2 }], payment_method: 'cash' });
  assert.equal(r.status, 201);
  const p = await api('GET', '/api/products?q=iphone', S.kofi.token);
  assert.equal(p.data.items[0].quantity, 0); assert.equal(p.data.items[0].status, 'out_of_stock');
  const n = await api('GET', '/api/notifications', S.owner);
  assert.ok(n.data.notifications.some((x: any) => x.type === 'out_of_stock'));
  const none = await api('POST', '/api/sales', S.kofi.token, { idempotency_key: key(), items: [{ variation_id: S.variation, quantity: 1 }], payment_method: 'cash' });
  assert.equal(none.status, 409);
});

test('TEST 8: owner restocks 20 units; back in stock + restocked notice', async () => {
  const r = await api('POST', `/api/inventory/${S.variation}/adjust`, S.owner, { action: 'restock', quantity: 20, reason: 'Supplier delivery' });
  assert.equal(r.status, 200); assert.equal(r.data.quantity_before, 0); assert.equal(r.data.quantity_after, 20);
  const p = await api('GET', '/api/products?q=iphone', S.owner);
  assert.equal(p.data.items[0].quantity, 20); assert.equal(p.data.items[0].status, 'in_stock');
  const n = await api('GET', '/api/notifications', S.owner);
  assert.ok(n.data.notifications.some((x: any) => x.type === 'restocked'));
  assert.ok(n.data.notifications.filter((x: any) => !x.resolved && (x.type === 'low_stock' || x.type === 'out_of_stock')).length === 0, 'old alerts resolved');
});

test('TEST 9: employees cannot change prices, delete products, adjust stock, or open settings', async () => {
  const v = S.kofi.token;
  assert.equal((await api('PUT', `/api/variations/${S.variation}`, v, { selling_price: 1 })).status, 403);
  assert.equal((await api('DELETE', `/api/products/${S.product}`, v)).status, 403);
  assert.equal((await api('POST', `/api/inventory/${S.variation}/adjust`, v, { action: 'manual_add', quantity: 5, reason: 'x' })).status, 403);
  assert.equal((await api('PUT', '/api/settings', v, { name: 'Hacked' })).status, 403);
  assert.equal((await api('GET', '/api/employees', v)).status, 403);
  assert.equal((await api('GET', '/api/reports/sales-daily', v)).status, 403);
  assert.equal((await api('POST', '/api/products', v, { name: 'x', variations: [{ selling_price: 1 }] })).status, 403);
  // limited employee cannot sell
  assert.equal((await api('POST', '/api/sales', S.limited.token, { idempotency_key: key(), items: [{ variation_id: S.variation, quantity: 1 }], payment_method: 'cash' })).status, 403);
  // no discount without permission
  assert.equal((await api('POST', '/api/sales', v, { idempotency_key: key(), items: [{ variation_id: S.variation, quantity: 1 }], payment_method: 'cash', discount: { type: 'percent', value: 5 } })).status, 403);
  // unauthenticated + bad token
  assert.equal((await api('GET', '/api/products')).status, 401);
  assert.equal((await api('GET', '/api/products', 'garbage')).status, 401);
  // price unchanged
  const p = await api('GET', '/api/products?q=iphone', S.owner);
  assert.equal(p.data.items[0].selling_price, 30);
});

test('TEST 10: sales, payments and stock movements are recorded accurately', async () => {
  const m = await api('GET', '/api/inventory/movements?variation_id=' + S.variation, S.owner);
  const mv = m.data.movements.reverse(); // oldest first
  assert.deepEqual(mv.map((x: any) => x.type), ['initial', 'sale', 'sale', 'sale', 'sale', 'restock']);
  for (const x of mv) assert.equal(x.qty_before + x.qty_change, x.qty_after);
  assert.deepEqual(mv.map((x: any) => x.qty_after), [10, 9, 3, 2, 0, 20]);
  const { rows } = await pool.query(`SELECT count(*)::int AS n, sum(amount)::float AS total FROM payments WHERE kind='payment'`);
  assert.equal(rows[0].n, 4); assert.equal(rows[0].total, 30 + 180 + 30 + 60);
  const d = await api('GET', '/api/dashboard', S.owner);
  assert.equal(d.data.cards.gross_sales, 300);
  assert.equal(d.data.cards.gross_profit, 150); // sold 10 units, cost 15, price 30
});

test('simultaneous sales never oversell', async () => {
  const p = await api('POST', '/api/products', S.owner, { name: 'Race Charger', variations: [{ sku: 'T-RACE', purchase_price: 5, selling_price: 10, quantity: 10 }] });
  const vid = p.data.variations[0].id;
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) =>
    api('POST', '/api/sales', i % 2 ? S.kofi.token : S.abena.token, { idempotency_key: key(), items: [{ variation_id: vid, quantity: 1 }], payment_method: 'cash' })));
  const ok = results.filter((r) => r.status === 201).length;
  assert.equal(ok, 10);
  assert.equal(results.filter((r) => r.status === 409).length, 15);
  const { rows } = await pool.query('SELECT quantity FROM inventory WHERE variation_id=$1', [vid]);
  assert.equal(rows[0].quantity, 0);
});

test('duplicate submission with same idempotency key deducts only once', async () => {
  const p = await api('POST', '/api/products', S.owner, { name: 'Idem Cable', variations: [{ sku: 'T-IDEM', purchase_price: 5, selling_price: 10, quantity: 10 }] });
  const vid = p.data.variations[0].id;
  const k = key();
  const rs = await Promise.all([1, 2, 3, 4].map(() => api('POST', '/api/sales', S.kofi.token, { idempotency_key: k, items: [{ variation_id: vid, quantity: 3 }], payment_method: 'cash' })));
  assert.ok(rs.every((r) => r.status === 200 || r.status === 201));
  assert.equal(new Set(rs.map((r) => r.data.sale.id)).size, 1);
  const { rows } = await pool.query('SELECT quantity FROM inventory WHERE variation_id=$1', [vid]);
  assert.equal(rows[0].quantity, 7);
  S.idemVar = vid; S.idemSale = rs[0].data.sale;
});

test('returns: resellable goods go back to stock only after inspection; refund recorded', async () => {
  const sale = S.idemSale;
  const item = sale.items[0];
  const r = await api('POST', '/api/returns', S.owner, { sale_id: sale.id, type: 'return', reason: 'Customer changed mind', items: [{ sale_item_id: item.id, quantity: 2 }], request_refund: true, refund_method: 'cash' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.return.refund_amount, 20); assert.equal(r.data.return.refund_status, 'paid');
  let q = (await pool.query('SELECT quantity FROM inventory WHERE variation_id=$1', [S.idemVar])).rows[0].quantity;
  assert.equal(q, 7, 'stock must not change before inspection');
  const over = await api('POST', '/api/returns', S.owner, { sale_id: sale.id, type: 'return', reason: 'again', items: [{ sale_item_id: item.id, quantity: 2 }] });
  assert.equal(over.status, 409, 'cannot return more than was bought');
  const ins = await api('POST', `/api/returns/${r.data.return.id}/inspect`, S.owner, { items: r.data.return.items.map((i: any) => ({ id: i.id, condition: 'Unopened', resellable: true })) });
  assert.equal(ins.status, 200);
  q = (await pool.query('SELECT quantity FROM inventory WHERE variation_id=$1', [S.idemVar])).rows[0].quantity;
  assert.equal(q, 9);
  const s = await api('GET', `/api/sales/${sale.id}`, S.owner);
  assert.equal(s.data.sale.status, 'partially_refunded'); assert.equal(s.data.sale.refunded_total, 20);
  assert.equal((await api('POST', `/api/returns/${r.data.return.id}/inspect`, S.owner, { items: [] })).status, 400);
});

test('employees only see their own sales; owner sees all; deactivated employee is locked out immediately', async () => {
  const mine = await api('GET', '/api/sales', S.abena.token);
  assert.ok(mine.data.sales.every((x: any) => x.employee_name === 'abena'));
  const all = await api('GET', '/api/sales', S.owner);
  assert.ok(all.data.sales.length > mine.data.sales.length);
  assert.equal((await api('GET', `/api/sales/${S.sale1}`, S.abena.token)).status, 403); // kofi's sale
  const off = await api('PUT', `/api/employees/${S.limited.id}`, S.owner, { is_active: false });
  assert.equal(off.status, 200);
  assert.equal((await api('GET', '/api/products', S.limited.token)).status, 401);
  const login = await api('POST', '/api/auth/login', undefined, { username: 'limited', password: 'Passw0rdEmp1' });
  assert.equal(login.status, 403);
});

test('tenant isolation: another business cannot see or touch this business data', async () => {
  const reg = await api('POST', '/api/auth/register', undefined, { business_name: 'Other Shop', owner_name: 'Eve', username: 'eve', password: 'Passw0rdEve1' });
  const t = reg.data.token;
  assert.equal((await api('GET', '/api/products', t)).data.items.length, 0);
  assert.equal((await api('PUT', `/api/variations/${S.variation}`, t, { selling_price: 1 })).status, 404);
  assert.equal((await api('POST', `/api/inventory/${S.variation}/adjust`, t, { action: 'manual_add', quantity: 5, reason: 'x' })).status, 404);
  assert.equal((await api('GET', `/api/sales/${S.sale1}`, t)).status, 404);
  assert.equal((await api('POST', '/api/sales', t, { idempotency_key: key(), items: [{ variation_id: S.variation, quantity: 1 }], payment_method: 'cash' })).status, 404);
});

test('reports: revenue, gross profit and net profit are distinct; exports work', async () => {
  await api('POST', '/api/expenses', S.owner, { category: 'Rent', amount: 50 });
  const r = await api('GET', '/api/reports/sales-monthly', S.owner);
  assert.equal(r.status, 200);
  const sm = Object.fromEntries(r.data.summary.map((s: any) => [s.label.split(' (')[0], s.value]));
  assert.ok(sm['Revenue'] > 0 && sm['Gross profit'] > 0);
  assert.equal(Math.round((sm['Gross profit'] - sm['Expenses']) * 100) / 100, sm['Net profit']);
  for (const fmt of ['xlsx', 'pdf']) {
    const f = await fetch(`${base}/api/reports/sales-daily?format=${fmt}`, { headers: { Authorization: `Bearer ${S.owner}` } });
    assert.equal(f.status, 200); assert.ok((await f.arrayBuffer()).byteLength > 500);
  }
});

test('supplier purchase order receiving updates stock and history', async () => {
  const sup = await api('POST', '/api/suppliers', S.owner, { name: 'Accra Wholesale', phone: '0240000000' });
  const po = await api('POST', '/api/purchase-orders', S.owner, { supplier_id: sup.data.supplier.id, items: [{ variation_id: S.variation, quantity: 10, unit_cost: 14 }] });
  assert.equal(po.status, 201); assert.equal(po.data.purchase_order.total_cost, 140);
  const rec = await api('POST', `/api/purchase-orders/${po.data.purchase_order.id}/receive`, S.owner, { items: [{ item_id: po.data.purchase_order.items[0].id, quantity: 10 }] });
  assert.equal(rec.status, 200); assert.equal(rec.data.purchase_order.status, 'received');
  const q = (await pool.query('SELECT quantity FROM inventory WHERE variation_id=$1', [S.variation])).rows[0].quantity;
  assert.equal(q, 30);
  const pay = await api('POST', `/api/purchase-orders/${po.data.purchase_order.id}/payments`, S.owner, { amount: 100 });
  assert.equal(pay.data.purchase_order.amount_paid, 100);
  assert.equal((await api('POST', `/api/purchase-orders/${po.data.purchase_order.id}/payments`, S.owner, { amount: 100 })).status, 400);
});

// ---------------- Upgrade v2: customers, credit, warranties, notifications, backups ----------------
test('credit sale needs a customer + permission; customer payments settle the balance exactly once', async () => {
  const cust = await api('POST', '/api/customers', S.owner, { name: 'Kwame Mensah', phone: '0244111222' });
  assert.equal(cust.status, 201); S.customer = cust.data.customer.id;
  assert.equal((await api('POST', '/api/customers', S.owner, { name: 'Dup', phone: '0244111222' })).status, 409);
  const sale = (extra: any, tok = S.owner) => api('POST', '/api/sales', tok, { idempotency_key: key(), items: [{ variation_id: S.variation, quantity: 2 }], payment_method: 'cash', amount_paid: 20, ...extra });
  assert.equal((await sale({})).status, 400, 'credit without a customer is rejected');
  assert.equal((await sale({ customer_id: S.customer }, S.kofi.token)).status, 403, 'employee without customers.credit cannot sell on credit');
  const ok = await sale({ customer_id: S.customer, due_date: '2020-01-01' });
  assert.equal(ok.status, 201); assert.equal(ok.data.sale.balance_due, 40);
  const saleId = ok.data.sale.id;
  const detail = await api('GET', `/api/customers/${S.customer}`, S.owner);
  assert.equal(detail.data.totals.outstanding, 40);
  const k = key();
  const pay = await api('POST', `/api/customers/${S.customer}/payments`, S.owner, { idempotency_key: k, sale_id: saleId, amount: 25, method: 'momo' });
  assert.equal(pay.status, 201); assert.equal(pay.data.sale.balance_due, 15);
  const again = await api('POST', `/api/customers/${S.customer}/payments`, S.owner, { idempotency_key: k, sale_id: saleId, amount: 25, method: 'momo' });
  assert.equal(again.data.duplicate, true);
  assert.equal((await api('GET', `/api/customers/${S.customer}`, S.owner)).data.totals.outstanding, 15, 'duplicate submission did not post twice');
  assert.equal((await api('POST', `/api/customers/${S.customer}/payments`, S.owner, { idempotency_key: key(), sale_id: saleId, amount: 99, method: 'cash' })).status, 400, 'cannot overpay');
  assert.equal((await api('GET', '/api/customers', S.limited.token)).status, 403);
});

test('warranty: unique serial, claim flow, expired warranties cannot be claimed', async () => {
  const w = await api('POST', '/api/warranties', S.owner, { product_name: 'HP Laptop', serial_number: 'SN-TEST-1', duration_months: 12, customer_id: S.customer });
  assert.equal(w.status, 201);
  assert.equal((await api('POST', '/api/warranties', S.owner, { product_name: 'Other', serial_number: 'sn-test-1', duration_months: 6 })).status, 409);
  assert.equal((await api('POST', '/api/warranties', S.owner, { product_name: 'No id', duration_months: 6 })).status, 400);
  const id = w.data.warranty.id;
  const claim = await api('POST', `/api/warranties/${id}/claims`, S.owner, { issue: 'Screen flickers' });
  assert.equal(claim.status, 201);
  assert.equal((await api('GET', `/api/warranties/${id}`, S.owner)).data.warranty.status, 'under_review');
  assert.equal((await api('PUT', `/api/warranties/${id}/claims/${claim.data.claim.id}`, S.owner, { status: 'resolved', resolution: 'Screen replaced' })).status, 200);
  assert.equal((await api('GET', `/api/warranties/${id}`, S.owner)).data.warranty.status, 'completed');
  await pool.query(`UPDATE warranties SET status='active', end_date = current_date - 5 WHERE id=$1`, [id]);
  assert.equal((await api('GET', `/api/warranties/${id}`, S.owner)).data.warranty.status, 'expired');
  assert.equal((await api('POST', `/api/warranties/${id}/claims`, S.owner, { issue: 'Late claim' })).status, 400);
  assert.equal((await api('GET', '/api/warranties', S.kofi.token)).status, 403);
});

test('overdue customer alerts are role-restricted and not duplicated', async () => {
  const { runDailyChecks } = await import('../src/jobs.ts');
  await runDailyChecks(); await runDailyChecks();
  const n = (await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE type='customer_overdue'`)).rows[0].n;
  assert.equal(n, 1);
  const own = await api('GET', '/api/notifications', S.owner);
  assert.ok(own.data.notifications.some((x: any) => x.type === 'customer_overdue'));
  const emp = await api('POST', '/api/employees', S.owner, { name: 'notif', username: 'notifuser', password: 'Passw0rdEmp1', permissions: ['notifications.view'] });
  const l = await api('POST', '/api/auth/login', undefined, { username: 'notifuser', password: 'Passw0rdEmp1' });
  assert.equal(emp.status, 201);
  const theirs = await api('GET', '/api/notifications', l.data.token);
  assert.ok(!theirs.data.notifications.some((x: any) => x.type === 'customer_overdue'), 'balances are hidden from staff without customers.manage');
});

test('reports: cashflow reconciles and CSV export works', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const cf = await api('GET', `/api/reports/cashflow?from=${today}&to=${today}`, S.owner);
  assert.equal(cf.status, 200);
  const s = Object.fromEntries(cf.data.summary.map((x: any) => [x.label, x.value]));
  assert.equal(Math.round((s['Opening balance'] + s['Money in'] - s['Money out']) * 100), Math.round(s['Closing balance'] * 100));
  const csv = await fetch(`${base}/api/reports/receivables?format=csv`, { headers: { Authorization: `Bearer ${S.owner}` } });
  assert.equal(csv.status, 200); assert.match(await csv.text(), /Kwame Mensah/);
  assert.equal((await api('GET', '/api/reports/cashflow', S.kofi.token)).status, 403);
});

test('backups: owner-only; create is verified; restore needs password + confirmation and brings data back', async () => {
  assert.equal((await api('GET', '/api/backups', S.kofi.token)).status, 403);
  assert.equal((await api('POST', '/api/backups', S.kofi.token)).status, 403);
  const b = await api('POST', '/api/backups', S.owner);
  assert.equal(b.status, 201, JSON.stringify(b.data)); assert.equal(b.data.backup.status, 'verified');
  const id = b.data.backup.id;
  assert.equal((await api('POST', `/api/backups/${id}/verify`, S.owner)).status, 200);
  const before = (await pool.query('SELECT count(*)::int AS n FROM sales')).rows[0].n;
  await pool.query('DELETE FROM payments'); await pool.query('DELETE FROM warranty_claims'); await pool.query('DELETE FROM receipts'); await pool.query('DELETE FROM return_items'); await pool.query('DELETE FROM returns');
  await pool.query('DELETE FROM sale_items'); await pool.query('DELETE FROM sales');
  assert.equal((await api('POST', `/api/backups/${id}/restore`, S.owner, { confirm: 'RESTORE', password: 'wrong-password' })).status, 400);
  assert.equal((await api('POST', `/api/backups/${id}/restore`, S.owner, { confirm: 'nope', password: 'Passw0rdOwner' })).status, 400);
  const r = await api('POST', `/api/backups/${id}/restore`, S.owner, { confirm: 'RESTORE', password: 'Passw0rdOwner' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM sales')).rows[0].n, before);
  const list = await api('GET', '/api/backups', S.owner);
  assert.ok(list.data.backups.some((x: any) => x.kind === 'pre_restore' && x.status === 'verified'), 'safety copy exists');
  assert.equal((await api('GET', `/api/backups/${id}/download`, S.kofi.token)).status, 403);
});

test('theme preference is saved per user', async () => {
  assert.equal((await api('PUT', '/api/auth/preferences', S.owner, { theme: 'dark' })).status, 200);
  assert.equal((await api('GET', '/api/auth/me', S.owner)).data.user.theme, 'dark');
  assert.equal((await api('PUT', '/api/auth/preferences', S.owner, { theme: 'neon' })).status, 400);
});
