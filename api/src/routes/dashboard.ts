import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db.ts';
import { can } from '../auth.ts';
import { config } from '../config.ts';

export const dashboardRouter = Router();
const TZ = config.timezone;
const local = (col: string) => `(${col} AT TIME ZONE '${TZ}')`;

dashboardRouter.get('/dashboard', async (req, res) => {
  const u = req.user!;
  const rq = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
  const biz = u.business_id;
  const full = u.role === 'owner' || can(u, 'reports.view');

  if (!full) {
    // Employee dashboard: only what their permissions allow
    const out: any = { scope: 'employee', permissions: u.permissions };
    if (can(u, 'sales.view') || can(u, 'sales.create')) {
      out.my_today = await one(
        `SELECT count(*) AS sales_count, coalesce(sum(total),0) AS sales_total FROM sales WHERE business_id=$1 AND employee_id=$2 AND ${local('created_at')}::date = ${local('now()')}::date`, [biz, u.id]);
      out.my_recent_sales = await query(
        `SELECT id, receipt_no, total, payment_method, created_at FROM sales WHERE business_id=$1 AND employee_id=$2 ORDER BY created_at DESC LIMIT 8`, [biz, u.id]);
    }
    if (can(u, 'products.view') || can(u, 'notifications.view')) {
      out.stock_alerts = await query(
        `SELECT p.name || coalesce(' (' || v.label || ')','') AS name, i.quantity, i.status FROM inventory i JOIN product_variations v ON v.id=i.variation_id JOIN products p ON p.id=v.product_id
          WHERE i.business_id=$1 AND v.is_active AND p.is_active AND i.status <> 'in_stock' ORDER BY i.quantity, p.name LIMIT 15`, [biz]);
    }
    return res.json(out);
  }

  const [counts, sales, lowOut, recent, best, daily, movements, perCat] = await Promise.all([
    one<any>(
      `SELECT (SELECT count(*) FROM products WHERE business_id=$1 AND is_active) AS products,
              (SELECT count(*) FROM categories WHERE business_id=$1 AND parent_id IS NULL) AS categories,
              (SELECT coalesce(sum(i.quantity),0) FROM inventory i JOIN product_variations v ON v.id=i.variation_id WHERE i.business_id=$1 AND v.is_active) AS stock_units,
              (SELECT coalesce(sum(i.quantity * v.purchase_price),0) FROM inventory i JOIN product_variations v ON v.id=i.variation_id WHERE i.business_id=$1 AND v.is_active) AS inventory_cost_value,
              (SELECT coalesce(sum(i.quantity * v.selling_price),0) FROM inventory i JOIN product_variations v ON v.id=i.variation_id WHERE i.business_id=$1 AND v.is_active) AS inventory_retail_value,
              (SELECT count(*) FROM inventory i JOIN product_variations v ON v.id=i.variation_id WHERE i.business_id=$1 AND v.is_active AND i.status='low_stock') AS low_stock,
              (SELECT count(*) FROM inventory i JOIN product_variations v ON v.id=i.variation_id WHERE i.business_id=$1 AND v.is_active AND i.status='out_of_stock') AS out_of_stock`, [biz]),
    one<any>(
      `WITH s AS (SELECT total, refunded_total, ${local('created_at')}::date AS d, id FROM sales WHERE business_id=$1),
            c AS (SELECT si.sale_id, sum(si.unit_cost * si.quantity) AS cost FROM sale_items si WHERE si.business_id=$1 GROUP BY si.sale_id),
            rc AS (SELECT si.sale_id, sum(si.unit_cost * ri.quantity) AS cost FROM return_items ri JOIN sale_items si ON si.id=ri.sale_item_id WHERE ri.restocked GROUP BY si.sale_id),
            today AS (SELECT ${local('now()')}::date AS d)
       SELECT
         coalesce(sum(s.total) FILTER (WHERE s.d = today.d),0) AS today,
         coalesce(sum(s.total) FILTER (WHERE s.d >= date_trunc('week', today.d)),0) AS week,
         coalesce(sum(s.total) FILTER (WHERE s.d >= date_trunc('month', today.d)),0) AS month,
         coalesce(sum(s.total),0) AS gross_sales,
         coalesce(sum(s.refunded_total),0) AS refunds,
         coalesce(sum(s.total - s.refunded_total),0) AS revenue,
         coalesce(sum(s.total - s.refunded_total - (coalesce(c.cost,0) - coalesce(rc.cost,0))),0) AS gross_profit,
         (SELECT coalesce(sum(amount),0) FROM expenses WHERE business_id=$1) AS expenses
       FROM s CROSS JOIN today LEFT JOIN c ON c.sale_id=s.id LEFT JOIN rc ON rc.sale_id=s.id`, [biz]),
    query(
      `SELECT v.id AS variation_id, p.name || coalesce(' (' || v.label || ')','') AS name, i.quantity, i.min_stock, i.status FROM inventory i
         JOIN product_variations v ON v.id=i.variation_id JOIN products p ON p.id=v.product_id
        WHERE i.business_id=$1 AND v.is_active AND p.is_active AND i.status <> 'in_stock' ORDER BY (i.status='out_of_stock') DESC, i.quantity, p.name LIMIT 30`, [biz]),
    query(`SELECT s.id, s.receipt_no, s.total, s.payment_method, s.status, s.created_at, u.name AS employee_name FROM sales s JOIN users u ON u.id=s.employee_id WHERE s.business_id=$1 ORDER BY s.created_at DESC LIMIT 8`, [biz]),
    query(
      `SELECT si.product_name AS name, sum(si.quantity - si.returned_qty) AS units, sum(si.line_total) AS revenue FROM sale_items si JOIN sales s ON s.id=si.sale_id
        WHERE si.business_id=$1 AND s.created_at > now() - interval '30 days' GROUP BY si.product_name ORDER BY units DESC LIMIT 5`, [biz]),
    query(
      `WITH days AS (SELECT generate_series(${local('now()')}::date - 29, ${local('now()')}::date, '1 day')::date AS d)
       SELECT to_char(days.d,'YYYY-MM-DD') AS day, coalesce(sum(s.total),0) AS sales, count(s.id) AS orders FROM days
         LEFT JOIN sales s ON s.business_id=$1 AND ${local('s.created_at')}::date = days.d GROUP BY days.d ORDER BY days.d`, [biz]),
    query(
      `WITH days AS (SELECT generate_series(${local('now()')}::date - 13, ${local('now()')}::date, '1 day')::date AS d)
       SELECT to_char(days.d,'YYYY-MM-DD') AS day, coalesce(sum(m.qty_change) FILTER (WHERE m.qty_change > 0),0) AS stock_in, coalesce(-sum(m.qty_change) FILTER (WHERE m.qty_change < 0),0) AS stock_out FROM days
         LEFT JOIN stock_movements m ON m.business_id=$1 AND ${local('m.created_at')}::date = days.d GROUP BY days.d ORDER BY days.d`, [biz]),
    query(
      `SELECT coalesce(c.name,'Uncategorised') AS category, sum(i.quantity) AS units FROM inventory i JOIN product_variations v ON v.id=i.variation_id JOIN products p ON p.id=v.product_id
         LEFT JOIN categories c ON c.id=p.category_id WHERE i.business_id=$1 AND v.is_active GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [biz]),
  ]);
  const [owed, payable, expenseBreakdown, monthly] = await Promise.all([
    one<any>('SELECT coalesce(sum(balance_due),0) AS n FROM sales WHERE business_id=$1 AND balance_due > 0', [biz]),
    one<any>(`SELECT coalesce(sum(total_cost - amount_paid),0) AS n FROM purchase_orders WHERE business_id=$1 AND status <> 'cancelled'`, [biz]),
    query(`SELECT category, sum(amount) AS amount FROM expenses WHERE business_id=$1 AND expense_date >= (${local('now()')}::date - 29) GROUP BY category ORDER BY amount DESC LIMIT 8`, [biz]),
    query(`WITH months AS (SELECT generate_series(date_trunc('month', ${local('now()')})::date - interval '5 months', date_trunc('month', ${local('now()')})::date, '1 month')::date AS m),
      sl AS (SELECT date_trunc('month', ${local('s.created_at')})::date AS m, sum(s.total - s.refunded_total) AS revenue,
                    sum(s.total - s.refunded_total - (coalesce((SELECT sum(si.unit_cost*si.quantity) FROM sale_items si WHERE si.sale_id=s.id),0) - coalesce((SELECT sum(si.unit_cost*ri.quantity) FROM return_items ri JOIN sale_items si ON si.id=ri.sale_item_id WHERE si.sale_id=s.id AND ri.restocked),0))) AS gross
               FROM sales s WHERE s.business_id=$1 GROUP BY 1),
      ex AS (SELECT date_trunc('month', expense_date)::date AS m, sum(amount) AS expenses FROM expenses WHERE business_id=$1 GROUP BY 1)
      SELECT to_char(months.m,'YYYY-MM') AS month, coalesce(sl.revenue,0) AS revenue, coalesce(sl.gross,0) AS gross_profit, coalesce(ex.expenses,0) AS expenses, coalesce(sl.gross,0) - coalesce(ex.expenses,0) AS net_profit
        FROM months LEFT JOIN sl ON sl.m=months.m LEFT JOIN ex ON ex.m=months.m ORDER BY months.m`, [biz]),
  ]);
  // Optional date-range summary (business-local dates, inclusive; max 366 days)
  let range: any = null;
  if (rq.from && rq.to) {
    if (rq.from > rq.to) return res.status(400).json({ error: 'The start date must be before the end date' });
    const span = await one<any>('SELECT ($2::date - $1::date) AS d', [rq.from, rq.to]);
    if (span.d > 365) return res.status(400).json({ error: 'Choose a period of one year or less' });
    const [tot, daily] = await Promise.all([
      one<any>(
        `WITH s AS (SELECT id, total, refunded_total FROM sales WHERE business_id=$1 AND ${local('created_at')}::date BETWEEN $2::date AND $3::date),
              c AS (SELECT si.sale_id, sum(si.unit_cost * si.quantity) AS cost FROM sale_items si JOIN s ON s.id=si.sale_id GROUP BY si.sale_id),
              rc AS (SELECT si.sale_id, sum(si.unit_cost * ri.quantity) AS cost FROM return_items ri JOIN sale_items si ON si.id=ri.sale_item_id JOIN s ON s.id=si.sale_id WHERE ri.restocked GROUP BY si.sale_id)
         SELECT count(s.id) AS sales_count, coalesce(sum(s.total),0) AS gross_sales, coalesce(sum(s.refunded_total),0) AS refunds, coalesce(sum(s.total - s.refunded_total),0) AS revenue,
                coalesce(sum(coalesce(c.cost,0) - coalesce(rc.cost,0)),0) AS cogs,
                coalesce(sum(s.total - s.refunded_total - (coalesce(c.cost,0) - coalesce(rc.cost,0))),0) AS gross_profit,
                (SELECT coalesce(sum(amount),0) FROM expenses WHERE business_id=$1 AND expense_date BETWEEN $2::date AND $3::date) AS expenses
           FROM s LEFT JOIN c ON c.sale_id=s.id LEFT JOIN rc ON rc.sale_id=s.id`, [biz, rq.from, rq.to]),
      query(
        `WITH days AS (SELECT generate_series($2::date, $3::date, '1 day')::date AS d)
         SELECT to_char(days.d,'YYYY-MM-DD') AS day, coalesce(sum(s.total - s.refunded_total),0) AS sales FROM days
           LEFT JOIN sales s ON s.business_id=$1 AND ${local('s.created_at')}::date = days.d GROUP BY days.d ORDER BY days.d`, [biz, rq.from, rq.to]),
    ]);
    range = { from: rq.from, to: rq.to, ...tot, net_profit: Math.round((tot.gross_profit - tot.expenses) * 100) / 100, daily };
  }
  const unread = await one<any>('SELECT count(*) AS n FROM notifications WHERE business_id=$1 AND NOT is_read', [biz]);
  res.json({
    scope: 'owner', range,
    cards: { ...counts, ...sales, net_profit: Math.round((sales.gross_profit - sales.expenses) * 100) / 100, pending_customer_payments: owed.n, outstanding_supplier_payments: payable.n },
    low_out_of_stock: lowOut, recent_sales: recent, best_sellers: best,
    charts: { daily_sales: daily, stock_movements: movements, stock_by_category: perCat, expense_breakdown: expenseBreakdown, monthly_pnl: monthly },
    unread_notifications: unread.n,
  });
});
