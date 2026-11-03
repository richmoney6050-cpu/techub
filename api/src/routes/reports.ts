import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query, one, round2 } from '../db.ts';
import { requirePerm, requireOwner, requireAny, audit } from '../auth.ts';
import { config } from '../config.ts';
import { bad, notFound } from '../errors.ts';
import { pdfSymbol } from '../receipt.ts';

export const reportsRouter = Router();
const TZ = config.timezone;
const local = (col: string) => `(${col} AT TIME ZONE '${TZ}')`;

type Col = { key: string; label: string; type?: 'money' | 'int' | 'text' | 'date' };
interface Report { title: string; columns: Col[]; rows: any[]; summary: Array<{ label: string; value: number | string; type?: 'money' | 'int' | 'text' }> }

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  employee_id: z.string().uuid().optional(), format: z.enum(['json', 'xlsx', 'pdf', 'csv']).default('json'),
});

function groupExpr(g: 'day' | 'week' | 'month' | 'year', col: string) {
  const l = local(col);
  return g === 'day' ? `${l}::date` : `date_trunc('${g}', ${l})::date`;
}
const PERIOD_LABEL = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Annual' } as const;

/** Sales + profit by period. Revenue = sales net of refunds. Gross profit = revenue - cost of goods sold.
 *  Net profit = gross profit - operating expenses recorded in the period. */
async function salesReport(biz: string, g: 'day' | 'week' | 'month' | 'year', from: string, to: string, employeeId?: string): Promise<Report> {
  const rows = await query<any>(
    `WITH s AS (SELECT s.id, s.total, s.discount, s.refunded_total, ${groupExpr(g, 's.created_at')} AS period FROM sales s
                 WHERE s.business_id=$1 AND ${local('s.created_at')}::date BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR s.employee_id=$4)),
          c AS (SELECT si.sale_id, sum(si.unit_cost*si.quantity) AS cost, sum(si.quantity) AS units FROM sale_items si GROUP BY si.sale_id),
          rc AS (SELECT si.sale_id, sum(si.unit_cost*ri.quantity) AS cost FROM return_items ri JOIN sale_items si ON si.id=ri.sale_item_id WHERE ri.restocked GROUP BY si.sale_id)
     SELECT to_char(s.period,'YYYY-MM-DD') AS period, count(*) AS orders, coalesce(sum(c.units),0) AS units, sum(s.total) AS sales, sum(s.discount) AS discounts,
            sum(s.refunded_total) AS refunds, sum(s.total - s.refunded_total) AS revenue,
            sum(coalesce(c.cost,0) - coalesce(rc.cost,0)) AS cogs,
            sum(s.total - s.refunded_total - (coalesce(c.cost,0) - coalesce(rc.cost,0))) AS gross_profit
       FROM s LEFT JOIN c ON c.sale_id=s.id LEFT JOIN rc ON rc.sale_id=s.id GROUP BY s.period ORDER BY s.period`, [biz, from, to, employeeId || null]);
  const exp = await query<any>(
    `SELECT to_char(${g === 'day' ? 'e.expense_date' : `date_trunc('${g}', e.expense_date)::date`},'YYYY-MM-DD') AS period, sum(amount) AS expenses FROM expenses e
      WHERE e.business_id=$1 AND e.expense_date BETWEEN $2::date AND $3::date GROUP BY 1`, [biz, from, to]);
  const expBy = new Map(exp.map((e) => [e.period, e.expenses]));
  const periods = new Set([...rows.map((r) => r.period), ...(employeeId ? [] : exp.map((e) => e.period))]);
  const out = [...periods].sort().map((p) => {
    const r = rows.find((x) => x.period === p) || { orders: 0, units: 0, sales: 0, discounts: 0, refunds: 0, revenue: 0, cogs: 0, gross_profit: 0 };
    const expenses = employeeId ? 0 : (expBy.get(p) || 0);
    return { period: p, ...r, expenses, net_profit: round2(r.gross_profit - expenses) };
  });
  const sum = (k: string) => round2(out.reduce((s, r) => s + (r[k] || 0), 0));
  return {
    title: `${PERIOD_LABEL[g]} sales & profit report`,
    columns: [
      { key: 'period', label: g === 'week' ? 'Week starting' : g === 'month' ? 'Month' : g === 'year' ? 'Year' : 'Date', type: 'date' },
      { key: 'orders', label: 'Orders', type: 'int' }, { key: 'units', label: 'Units', type: 'int' }, { key: 'sales', label: 'Sales', type: 'money' },
      { key: 'discounts', label: 'Discounts', type: 'money' }, { key: 'refunds', label: 'Refunds', type: 'money' }, { key: 'revenue', label: 'Revenue', type: 'money' },
      { key: 'cogs', label: 'Cost of goods', type: 'money' }, { key: 'gross_profit', label: 'Gross profit', type: 'money' },
      { key: 'expenses', label: 'Expenses', type: 'money' }, { key: 'net_profit', label: 'Net profit', type: 'money' },
    ],
    rows: out,
    summary: [
      { label: 'Revenue (sales less refunds)', value: sum('revenue'), type: 'money' }, { label: 'Gross profit (revenue - cost of goods)', value: sum('gross_profit'), type: 'money' },
      { label: 'Expenses', value: sum('expenses'), type: 'money' }, { label: 'Net profit (gross profit - expenses)', value: sum('net_profit'), type: 'money' },
      { label: 'Orders', value: sum('orders'), type: 'int' },
    ],
  };
}

const BUILDERS: Record<string, (biz: string, from: string, to: string, emp?: string) => Promise<Report>> = {
  'sales-daily': (b, f, t, e) => salesReport(b, 'day', f, t, e),
  'sales-weekly': (b, f, t, e) => salesReport(b, 'week', f, t, e),
  'sales-monthly': (b, f, t, e) => salesReport(b, 'month', f, t, e),
  'sales-annual': (b, f, t, e) => salesReport(b, 'year', f, t, e),
  'gross-profit': async (b, f, t, e) => {
    const r = await salesReport(b, 'month', f, t, e);
    return { ...r, title: 'Gross profit report (by month)' };
  },
  products: async (biz, from, to) => {
    const rows = await query<any>(
      `SELECT si.product_name AS name, si.sku, sum(si.quantity) AS sold, sum(si.returned_qty) AS returned, sum(si.line_total) AS sales,
              sum(si.unit_cost * (si.quantity - si.returned_qty)) AS cost, sum(si.line_total) - sum(si.unit_cost * si.quantity) AS margin
         FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.business_id=$1 AND ${local('s.created_at')}::date BETWEEN $2::date AND $3::date
        GROUP BY si.product_name, si.sku ORDER BY sold DESC`, [biz, from, to]);
    return { title: 'Product sales report', columns: [{ key: 'name', label: 'Product' }, { key: 'sku', label: 'SKU' }, { key: 'sold', label: 'Units sold', type: 'int' }, { key: 'returned', label: 'Returned', type: 'int' },
      { key: 'sales', label: 'Sales', type: 'money' }, { key: 'cost', label: 'Cost', type: 'money' }, { key: 'margin', label: 'Margin before discounts', type: 'money' }], rows,
      summary: [{ label: 'Units sold', value: rows.reduce((s, r) => s + r.sold, 0), type: 'int' }, { label: 'Sales', value: round2(rows.reduce((s, r) => s + r.sales, 0)), type: 'money' }] };
  },
  employees: async (biz, from, to) => {
    const rows = await query<any>(
      `SELECT u.name, count(s.id) AS orders, coalesce(sum(s.total),0) AS sales, coalesce(sum(s.discount),0) AS discounts, coalesce(sum(s.refunded_total),0) AS refunds
         FROM users u LEFT JOIN sales s ON s.employee_id=u.id AND ${local('s.created_at')}::date BETWEEN $2::date AND $3::date WHERE u.business_id=$1 GROUP BY u.id ORDER BY sales DESC`, [biz, from, to]);
    return { title: 'Employee sales report', columns: [{ key: 'name', label: 'Employee' }, { key: 'orders', label: 'Orders', type: 'int' }, { key: 'sales', label: 'Sales', type: 'money' }, { key: 'discounts', label: 'Discounts given', type: 'money' }, { key: 'refunds', label: 'Refunds', type: 'money' }], rows,
      summary: [{ label: 'Total sales', value: round2(rows.reduce((s, r) => s + r.sales, 0)), type: 'money' }] };
  },
  inventory: async (biz) => {
    const rows = await query<any>(
      `SELECT p.name || coalesce(' (' || v.label || ')','') AS name, v.sku, coalesce(c.name,'') AS category, coalesce(b.name,'') AS brand, i.quantity, i.min_stock, i.status,
              v.purchase_price, v.selling_price, i.quantity * v.purchase_price AS cost_value, i.quantity * v.selling_price AS retail_value
         FROM inventory i JOIN product_variations v ON v.id=i.variation_id JOIN products p ON p.id=v.product_id LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands b ON b.id=p.brand_id
        WHERE i.business_id=$1 AND v.is_active AND p.is_active ORDER BY lower(p.name)`, [biz]);
    return { title: 'Inventory report (current stock)', columns: [{ key: 'name', label: 'Product' }, { key: 'sku', label: 'SKU' }, { key: 'category', label: 'Category' }, { key: 'brand', label: 'Brand' }, { key: 'quantity', label: 'Qty', type: 'int' },
      { key: 'min_stock', label: 'Min', type: 'int' }, { key: 'status', label: 'Status' }, { key: 'purchase_price', label: 'Cost', type: 'money' }, { key: 'selling_price', label: 'Price', type: 'money' }, { key: 'cost_value', label: 'Stock cost value', type: 'money' }, { key: 'retail_value', label: 'Stock retail value', type: 'money' }], rows,
      summary: [{ label: 'Units in stock', value: rows.reduce((s, r) => s + r.quantity, 0), type: 'int' }, { label: 'Inventory value at cost', value: round2(rows.reduce((s, r) => s + r.cost_value, 0)), type: 'money' }, { label: 'Inventory value at retail', value: round2(rows.reduce((s, r) => s + r.retail_value, 0)), type: 'money' }] };
  },
  'low-stock': async (biz) => {
    const rows = await query<any>(
      `SELECT p.name || coalesce(' (' || v.label || ')','') AS name, v.sku, i.quantity, i.min_stock, i.status FROM inventory i JOIN product_variations v ON v.id=i.variation_id JOIN products p ON p.id=v.product_id
        WHERE i.business_id=$1 AND v.is_active AND p.is_active AND i.status <> 'in_stock' ORDER BY i.quantity, lower(p.name)`, [biz]);
    return { title: 'Low-stock & out-of-stock report', columns: [{ key: 'name', label: 'Product' }, { key: 'sku', label: 'SKU' }, { key: 'quantity', label: 'Qty', type: 'int' }, { key: 'min_stock', label: 'Minimum', type: 'int' }, { key: 'status', label: 'Status' }], rows,
      summary: [{ label: 'Products needing restock', value: rows.length, type: 'int' }] };
  },
  cashflow: async (biz, from, to) => {
    const base = `WITH m AS (
      SELECT ${local('p.created_at')}::date AS d, CASE WHEN p.kind='payment' THEN 'in' ELSE 'out' END AS dir, CASE WHEN p.kind='payment' THEN 'sales' ELSE 'refunds' END AS k, p.method, p.amount FROM payments p WHERE p.business_id=$1
      UNION ALL SELECT e.expense_date, 'out', 'expenses', e.payment_method, e.amount FROM expenses e WHERE e.business_id=$1
      UNION ALL SELECT i.income_date, 'in', 'other', i.payment_method, i.amount FROM other_income i WHERE i.business_id=$1
      UNION ALL SELECT ${local('sp.created_at')}::date, 'out', 'supplier', coalesce(nullif(lower(sp.method),''),'cash'), sp.amount FROM supplier_payments sp WHERE sp.business_id=$1)`;
    const open = await one<any>(`${base} SELECT (SELECT opening_cash FROM businesses WHERE id=$1) + coalesce(sum(CASE WHEN dir='in' THEN amount ELSE -amount END) FILTER (WHERE d < $2::date),0) AS opening FROM m`, [biz, from]);
    const days = await query<any>(
      `${base} SELECT to_char(d,'YYYY-MM-DD') AS date,
         coalesce(sum(amount) FILTER (WHERE dir='in' AND method='cash'),0) AS cash_in, coalesce(sum(amount) FILTER (WHERE dir='in' AND method='momo'),0) AS momo_in,
         coalesce(sum(amount) FILTER (WHERE dir='in' AND method='bank_transfer'),0) AS bank_in, coalesce(sum(amount) FILTER (WHERE dir='in' AND method='card'),0) AS card_in, coalesce(sum(amount) FILTER (WHERE k='other'),0) AS other_income,
         coalesce(sum(amount) FILTER (WHERE k='refunds'),0) AS refunds, coalesce(sum(amount) FILTER (WHERE k='expenses'),0) AS expenses, coalesce(sum(amount) FILTER (WHERE k='supplier'),0) AS supplier_payments,
         coalesce(sum(CASE WHEN dir='in' THEN amount ELSE -amount END),0) AS net
       FROM m WHERE d BETWEEN $2::date AND $3::date GROUP BY d ORDER BY d`, [biz, from, to]);
    let bal = open.opening; const rows = days.map((r) => { bal = round2(bal + r.net); return { ...r, closing: bal }; });
    const sum = (k: string) => round2(rows.reduce((t, r) => t + r[k], 0));
    const money = (key: string, label: string) => ({ key, label, type: 'money' as const });
    return { title: 'Cash flow (money actually received and paid out)', columns: [{ key: 'date', label: 'Date', type: 'date' }, money('cash_in', 'Cash in'), money('momo_in', 'MoMo in'), money('bank_in', 'Bank in'), money('card_in', 'Card in'), money('other_income', 'of which other income'),
      money('refunds', 'Refunds'), money('expenses', 'Expenses'), money('supplier_payments', 'Supplier pay'), money('net', 'Net'), money('closing', 'Closing balance')], rows,
      summary: [{ label: 'Opening balance', value: round2(open.opening), type: 'money' }, { label: 'Money in', value: round2(sum('cash_in') + sum('momo_in') + sum('bank_in') + sum('card_in')), type: 'money' }, { label: 'Of which other income', value: sum('other_income'), type: 'money' },
        { label: 'Money out', value: round2(sum('refunds') + sum('expenses') + sum('supplier_payments')), type: 'money' }, { label: 'Closing balance', value: round2(bal), type: 'money' }] };
  },
  receivables: async (biz) => {
    const rows = await query<any>(
      `SELECT c.name AS customer, coalesce(c.phone,'') AS phone, s.receipt_no, to_char(${local('s.created_at')},'YYYY-MM-DD') AS date, coalesce(to_char(s.due_date,'YYYY-MM-DD'),'') AS due, s.total, s.amount_paid AS paid, s.balance_due AS balance
         FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.business_id=$1 AND s.balance_due > 0 ORDER BY s.due_date NULLS LAST, s.created_at`, [biz]);
    return { title: 'Outstanding customer payments', columns: [{ key: 'customer', label: 'Customer' }, { key: 'phone', label: 'Phone' }, { key: 'receipt_no', label: 'Receipt' }, { key: 'date', label: 'Sold' }, { key: 'due', label: 'Due' },
      { key: 'total', label: 'Total', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' }], rows,
      summary: [{ label: 'Total owed by customers', value: round2(rows.reduce((t, r) => t + r.balance, 0)), type: 'money' }] };
  },
  payables: async (biz) => {
    const rows = await query<any>(
      `SELECT s.name AS supplier, count(po.id) AS orders, coalesce(sum(po.total_cost),0) AS ordered, coalesce(sum(po.amount_paid),0) AS paid, coalesce(sum(po.total_cost - po.amount_paid),0) AS balance
         FROM suppliers s LEFT JOIN purchase_orders po ON po.supplier_id=s.id AND po.status <> 'cancelled' WHERE s.business_id=$1 GROUP BY s.id HAVING count(po.id) > 0 ORDER BY balance DESC, lower(s.name)`, [biz]);
    return { title: 'Supplier balances (what we owe)', columns: [{ key: 'supplier', label: 'Supplier' }, { key: 'orders', label: 'Orders', type: 'int' }, { key: 'ordered', label: 'Ordered', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' }], rows,
      summary: [{ label: 'Total owed to suppliers', value: round2(rows.reduce((t, r) => t + r.balance, 0)), type: 'money' }] };
  },
  'sales-by-payment': async (biz, from, to) => {
    const rows = await query<any>(
      `SELECT p.method, count(DISTINCT p.sale_id) AS sales, coalesce(sum(p.amount) FILTER (WHERE p.kind='payment'),0) AS received, coalesce(sum(p.amount) FILTER (WHERE p.kind='refund'),0) AS refunded
         FROM payments p WHERE p.business_id=$1 AND ${local('p.created_at')}::date BETWEEN $2::date AND $3::date GROUP BY p.method ORDER BY received DESC`, [biz, from, to]);
    return { title: 'Payments by method', columns: [{ key: 'method', label: 'Method' }, { key: 'sales', label: 'Sales', type: 'int' }, { key: 'received', label: 'Received', type: 'money' }, { key: 'refunded', label: 'Refunded', type: 'money' }], rows,
      summary: [{ label: 'Total received', value: round2(rows.reduce((t, r) => t + r.received, 0)), type: 'money' }] };
  },
  'sales-by-category': async (biz, from, to) => {
    const rows = await query<any>(
      `SELECT coalesce(c.name,'Uncategorised') AS category, sum(si.quantity - si.returned_qty) AS units, sum(si.line_total * (si.quantity - si.returned_qty) / si.quantity) AS revenue
         FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN product_variations v ON v.id=si.variation_id JOIN products p ON p.id=v.product_id LEFT JOIN categories c ON c.id=p.category_id
        WHERE si.business_id=$1 AND ${local('s.created_at')}::date BETWEEN $2::date AND $3::date GROUP BY 1 ORDER BY revenue DESC`, [biz, from, to]);
    return { title: 'Sales by category (before sale-level discounts)', columns: [{ key: 'category', label: 'Category' }, { key: 'units', label: 'Units', type: 'int' }, { key: 'revenue', label: 'Revenue', type: 'money' }], rows,
      summary: [{ label: 'Total', value: round2(rows.reduce((t, r) => t + Number(r.revenue), 0)), type: 'money' }] };
  },
  'stock-movements': async (biz, from, to) => {
    const rows = await query<any>(
      `SELECT to_char(${local('m.created_at')},'YYYY-MM-DD HH24:MI') AS date, p.name || coalesce(' (' || v.label || ')','') AS product, m.type, m.qty_change AS change, m.reason, coalesce(u.name,'') AS by
         FROM stock_movements m JOIN product_variations v ON v.id=m.variation_id JOIN products p ON p.id=v.product_id LEFT JOIN users u ON u.id=m.user_id
        WHERE m.business_id=$1 AND ${local('m.created_at')}::date BETWEEN $2::date AND $3::date ORDER BY m.created_at DESC LIMIT 5000`, [biz, from, to]);
    return { title: 'Stock movements', columns: [{ key: 'date', label: 'When' }, { key: 'product', label: 'Product' }, { key: 'type', label: 'Type' }, { key: 'change', label: 'Change', type: 'int' }, { key: 'reason', label: 'Reason' }, { key: 'by', label: 'By' }], rows,
      summary: [{ label: 'Movements', value: rows.length, type: 'int' }] };
  },
  expenses: async (biz, from, to) => {
    const rows = await query<any>(
      `SELECT to_char(e.expense_date,'YYYY-MM-DD') AS date, e.category, coalesce(e.description,'') AS description, e.amount, u.name AS recorded_by FROM expenses e LEFT JOIN users u ON u.id=e.created_by
        WHERE e.business_id=$1 AND e.expense_date BETWEEN $2::date AND $3::date ORDER BY e.expense_date`, [biz, from, to]);
    return { title: 'Expense report', columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'recorded_by', label: 'Recorded by' }], rows,
      summary: [{ label: 'Total expenses', value: round2(rows.reduce((s, r) => s + r.amount, 0)), type: 'money' }] };
  },
};

const fmt = (v: any, t?: string, sym = 'GHS ') => v === null || v === undefined ? '' : t === 'money' ? `${sym}${Number(v).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(v);

reportsRouter.get('/reports/:name', requirePerm('reports.view'), async (req, res) => {
  const builder = BUILDERS[String(req.params.name)];
  if (!builder) throw notFound('Unknown report');
  const q = rangeSchema.parse(req.query);
  const today = (await one<any>(`SELECT to_char(${local('now()')}::date,'YYYY-MM-DD') AS d`))!.d;
  const from = q.from || today.slice(0, 8) + '01';
  const to = q.to || today;
  if (from > to) throw bad('The start date must be before the end date');
  const biz = req.user!.business_id;
  const report = await builder(biz, from, to, q.employee_id);
  const b = await one<any>('SELECT name, currency_symbol FROM businesses WHERE id=$1', [biz]);
  const meta = { business: b.name, period: { from, to }, generated_at: new Date().toISOString() };

  if (q.format === 'json') return res.json({ ...report, meta });

  const filename = `${String(req.params.name)}_${from}_to_${to}`;
  if (q.format === 'csv') {
    const esc = (v: any) => { let t = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t; };
    const lines = [[`${b.name} - ${report.title}`], [`Period: ${from} to ${to}`, `Generated: ${meta.generated_at}`], [], report.columns.map((c) => c.label),
      ...report.rows.map((r) => report.columns.map((c) => r[c.key])), [], ...report.summary.map((x) => [x.label, x.value])];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send('\uFEFF' + lines.map((l) => l.map(esc).join(',')).join('\r\n'));
  }
  if (q.format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');
    ws.addRow([`${b.name} — ${report.title}`]).font = { bold: true, size: 14 };
    ws.addRow([`Period: ${from} to ${to}`]);
    ws.addRow([]);
    const head = ws.addRow(report.columns.map((c) => c.label));
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F3A' } }; });
    for (const r of report.rows) ws.addRow(report.columns.map((c) => (c.type === 'money' || c.type === 'int') ? Number(r[c.key] ?? 0) : r[c.key] ?? ''));
    report.columns.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = Math.max(14, c.label.length + 4); if (c.type === 'money') col.numFmt = `"${b.currency_symbol}"#,##0.00`; });
    ws.addRow([]);
    for (const s of report.summary) { const row = ws.addRow([s.label, s.type === 'money' || s.type === 'int' ? Number(s.value) : s.value]); row.getCell(1).font = { bold: true }; if (s.type === 'money') row.getCell(2).numFmt = `"${b.currency_symbol}"#,##0.00`; }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }

  // PDF
  const doc = new PDFDocument({ size: 'A4', layout: report.columns.length > 6 ? 'landscape' : 'portrait', margin: 36 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0B1F3A').text(b.name);
  doc.fontSize(12).fillColor('#2563EB').text(report.title);
  doc.font('Helvetica').fontSize(9).fillColor('#555').text(`Period: ${from} to ${to}   |   Generated: ${new Date().toLocaleString('en-GB', { timeZone: TZ })}`).moveDown();
  const pageW = doc.page.width - 72;
  const colW = pageW / report.columns.length;
  const drawRow = (vals: string[], bold = false, bg?: string) => {
    const y = doc.y;
    if (y > doc.page.height - 60) { doc.addPage(); }
    const top = doc.y;
    if (bg) doc.rect(36, top - 2, pageW, 16).fill(bg);
    doc.fillColor(bg ? '#FFFFFF' : '#111').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    vals.forEach((v, i) => doc.text(v, 36 + i * colW + 2, top, { width: colW - 4, height: 12, ellipsis: true, lineBreak: false }));
    doc.y = top + 15; doc.x = 36;
  };
  drawRow(report.columns.map((c) => c.label), true, '#0B1F3A');
  for (const r of report.rows) drawRow(report.columns.map((c) => fmt(r[c.key], c.type, pdfSymbol(b.currency_symbol))));
  doc.moveDown();
  for (const s of report.summary) { doc.fillColor('#111').font('Helvetica-Bold').fontSize(10).text(`${s.label}: ${fmt(s.value, s.type, pdfSymbol(b.currency_symbol))}`, 36); }
  doc.end();
});

reportsRouter.put('/finance/opening-cash', requireOwner, async (req, res) => {
  const b = z.object({ opening_cash: z.coerce.number().min(-1e9).max(1e9) }).parse(req.body);
  const old = await one<any>('SELECT opening_cash FROM businesses WHERE id=$1', [req.user!.business_id]);
  await query('UPDATE businesses SET opening_cash=$2 WHERE id=$1', [req.user!.business_id, round2(b.opening_cash)]);
  await audit(req, req.user, 'settings.opening_cash', 'business', req.user!.business_id, { from: old?.opening_cash, to: b.opening_cash });
  res.json({ ok: true });
});
reportsRouter.get('/finance/opening-cash', requirePerm('reports.view'), async (req, res) => {
  res.json(await one('SELECT opening_cash FROM businesses WHERE id=$1', [req.user!.business_id]));
});

// ---- other income ----
reportsRouter.get('/income', requireAny('expenses.manage', 'reports.view'), async (req, res) => {
  const rows = await query(`SELECT i.id, i.title, i.amount, i.payment_method, i.income_date, u.name AS created_by_name FROM other_income i LEFT JOIN users u ON u.id=i.created_by WHERE i.business_id=$1 ORDER BY i.income_date DESC, i.created_at DESC LIMIT 200`, [req.user!.business_id]);
  res.json({ income: rows });
});
reportsRouter.post('/income', requirePerm('expenses.manage'), async (req, res) => {
  const b = z.object({ title: z.string().trim().min(2).max(120), amount: z.coerce.number().positive().max(100_000_000), payment_method: z.enum(['cash', 'momo', 'bank_transfer', 'card']).default('cash'), income_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body);
  const row = await one<any>('INSERT INTO other_income (business_id, title, amount, payment_method, income_date, created_by) VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6) RETURNING *', [req.user!.business_id, b.title, round2(b.amount), b.payment_method, b.income_date || null, req.user!.id]);
  await audit(req, req.user, 'income.create', 'other_income', row.id, { title: b.title, amount: b.amount });
  res.status(201).json({ income: row });
});
reportsRouter.delete('/income/:id', requirePerm('expenses.manage'), async (req, res) => {
  const row = await one<any>('DELETE FROM other_income WHERE id=$1 AND business_id=$2 RETURNING id, title, amount', [req.params.id, req.user!.business_id]);
  if (!row) throw notFound('Income entry not found');
  await audit(req, req.user, 'income.delete', 'other_income', row.id, { title: row.title, amount: row.amount });
  res.json({ ok: true });
});
