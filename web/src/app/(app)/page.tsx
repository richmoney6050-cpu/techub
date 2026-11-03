'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApi, money, num, dt, METHOD } from '@/lib/api';
import { Page, Card, Stat, Loading, Err, LineChart, BarChart, HBars, StatusBadge } from '@/components/ui';
import { useMe } from '@/lib/me';

export default function Dashboard() {
  const me = useMe();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const { data, error, loading } = useApi<any>(`/dashboard${range ? `?from=${range.from}&to=${range.to}` : ''}`, { interval: 8000 }); // refreshes automatically
  if (loading && !data) return <Loading />;
  if (error && !data) return <Err msg={error} />;
  const sym = me.currency_symbol;

  if (data.scope === 'employee') {
    return (<Page title={`Hello, ${me.name.split(' ')[0]}`} sub="Your shift at a glance" actions={me.permissions.includes('sales.create') && <Link href="/pos" className="btn lg">Start a sale</Link>}>
      <div className="grid g3">
        {data.my_today && <><Stat accent label="My sales today" value={money(data.my_today.sales_total, sym)} /><Stat label="Number of sales today" value={num(data.my_today.sales_count)} /></>}
        {data.stock_alerts && <Stat label="Items needing attention" value={num(data.stock_alerts.length)} sub="Low or out of stock" />}
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        {data.my_recent_sales && <Card><h2>My recent sales</h2><div className="table-wrap"><table><tbody>
          {data.my_recent_sales.map((s: any) => <tr key={s.id}><td><Link href={`/sales?open=${s.id}`}>{s.receipt_no}</Link></td><td className="muted small">{dt(s.created_at)}</td><td className="num"><b>{money(s.total, sym)}</b></td></tr>)}
          {data.my_recent_sales.length === 0 && <tr><td className="empty">No sales yet today</td></tr>}</tbody></table></div></Card>}
        {data.stock_alerts && <Card><h2>Stock alerts</h2><table><tbody>{data.stock_alerts.map((a: any, i: number) => <tr key={i}><td>{a.name}</td><td className="num">{a.quantity}</td><td><StatusBadge status={a.status} /></td></tr>)}
          {data.stock_alerts.length === 0 && <tr><td className="empty">Everything is in stock 👍</td></tr>}</tbody></table></Card>}
      </div>
    </Page>);
  }

  const c = data.cards;
  return (<Page title="Dashboard" sub={`${me.business_name} — live business overview`} actions={<>
    <Link href="/products/new" className="btn secondary">+ Add product</Link><Link href="/pos" className="btn">Open POS</Link></>}>
    <div className="grid g4">
      <Stat accent label="Sales today" value={money(c.today, sym)} sub={`This week ${money(c.week, sym)}`} />
      <Stat label="Sales this month" value={money(c.month, sym)} />
      <Stat label="Total revenue" value={money(c.revenue, sym)} sub={`After ${money(c.refunds, sym)} refunds`} />
      <Stat label="Estimated gross profit" value={money(c.gross_profit, sym)} sub={`Net profit ${money(c.net_profit, sym)} (after expenses)`} />
      <Stat label="Products" value={num(c.products)} sub={`${num(c.categories)} categories`} />
      <Stat label="Units in stock" value={num(c.stock_units)} />
      <Stat label="Inventory value" value={money(c.inventory_cost_value, sym)} sub={`Retail ${money(c.inventory_retail_value, sym)}`} />
      <Stat label="Owed by customers" value={money(c.pending_customer_payments, sym)} sub="Unpaid credit sales" />
      <Stat label="Owed to suppliers" value={money(c.outstanding_supplier_payments, sym)} sub="Unpaid purchase orders" />
      <Link href="/products?stock=low" style={{ textDecoration: 'none' }}><Stat label="Low / out of stock" value={<><span style={{ color: '#b7791f' }}>{num(c.low_stock)}</span> / <span style={{ color: '#d93025' }}>{num(c.out_of_stock)}</span></>} sub="Tap to review" /></Link>
    </div>
    <Card style={{ marginTop: 14 }}><div className="chart-title">Period summary</div>
      <div className="row" style={{ marginBottom: 10 }}>
        {([['Today', 0], ['Yesterday', -1], ['Last 7 days', 6], ['Last 30 days', 29]] as const).map(([l, n]) => <button key={l} className="btn secondary sm" onClick={() => { const t = new Date(); if (n === -1) { t.setDate(t.getDate() - 1); setRange({ from: iso(t), to: iso(t) }); } else { const f = new Date(); f.setDate(f.getDate() - n); setRange({ from: iso(f), to: iso(new Date()) }); } }}>{l}</button>)}
        <button className="btn secondary sm" onClick={() => { const t = new Date(); setRange({ from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) }); }}>This month</button>
        <button className="btn secondary sm" onClick={() => { const t = new Date(); setRange({ from: `${t.getFullYear()}-01-01`, to: iso(t) }); }}>This year</button>
        <input type="date" style={{ maxWidth: 160 }} aria-label="From" value={range?.from || ''} onChange={(e) => setRange({ from: e.target.value, to: range?.to || e.target.value })} />
        <input type="date" style={{ maxWidth: 160 }} aria-label="To" value={range?.to || ''} onChange={(e) => setRange({ from: range?.from || e.target.value, to: e.target.value })} />
        {range && <button className="btn ghost sm" onClick={() => setRange(null)}>Clear</button>}</div>
      {data.range ? <><div className="grid g4"><Stat label={`Revenue (${data.range.sales_count} sales)`} value={money(data.range.revenue, sym)} sub={`After ${money(data.range.refunds, sym)} refunds`} /><Stat label="Cost of goods sold" value={money(data.range.cogs, sym)} /><Stat label="Gross profit" value={money(data.range.gross_profit, sym)} /><Stat accent label="Net profit" value={money(data.range.net_profit, sym)} sub={`After ${money(data.range.expenses, sym)} expenses`} /></div>
        <div style={{ height: 12 }} /><LineChart data={data.range.daily} x="day" sym={sym} series={[{ key: 'sales', label: 'Revenue', color: '#176bff' }]} /></> : <div className="muted small">Pick a period to see revenue, cost of goods, gross profit and net profit for exactly those dates.</div>}
    </Card>
    <div className="grid g2" style={{ marginTop: 14 }}>
      <Card><div className="chart-title">Sales — last 30 days</div><LineChart data={data.charts.daily_sales} x="day" sym={sym} series={[{ key: 'sales', label: 'Sales', color: '#1e6bff' }]} /></Card>
      <Card><div className="chart-title">Stock movement — last 14 days (units)</div><BarChart data={data.charts.stock_movements} x="day" series={[{ key: 'stock_in', label: 'Stock in', color: '#0f9d58' }, { key: 'stock_out', label: 'Stock out', color: '#0b1f3a' }]} /></Card>
    </div>
    <div className="grid g2" style={{ marginTop: 14 }}>
      <Card><div className="chart-title">Profit &amp; loss — last 6 months</div><BarChart data={data.charts.monthly_pnl} x="month" series={[{ key: 'revenue', label: 'Revenue', color: '#176bff' }, { key: 'gross_profit', label: 'Gross profit', color: '#38bdf8' }, { key: 'expenses', label: 'Expenses', color: '#f59e0b' }, { key: 'net_profit', label: 'Net profit', color: '#16a34a' }]} /></Card>
      <Card><div className="chart-title">Expenses by category — last 30 days</div>{data.charts.expense_breakdown.length ? <HBars data={data.charts.expense_breakdown} label="category" value="amount" color="#f59e0b" /> : <div className="empty">No expenses recorded</div>}</Card>
    </div>
    <div className="grid g3" style={{ marginTop: 14 }}>
      <Card><h2>Needs restocking</h2><div className="table-wrap"><table><tbody>
        {data.low_out_of_stock.slice(0, 8).map((p: any) => <tr key={p.variation_id}><td>{p.name}</td><td className="num">{p.quantity}</td><td><StatusBadge status={p.status} /></td></tr>)}
        {data.low_out_of_stock.length === 0 && <tr><td className="empty">All products are well stocked 👍</td></tr>}</tbody></table></div></Card>
      <Card><h2>Best sellers (30 days)</h2><HBars data={data.best_sellers} label="name" value="units" /></Card>
      <Card><h2>Stock by category</h2><HBars data={data.charts.stock_by_category} label="category" value="units" color="#0b1f3a" /></Card>
    </div>
    <Card className="" style={{ marginTop: 14 }}><div className="row between"><h2>Recent transactions</h2><Link href="/sales" className="small">View all</Link></div>
      <div className="table-wrap"><table><thead><tr><th>Receipt</th><th>Time</th><th>Employee</th><th>Payment</th><th className="num">Total</th><th>Status</th></tr></thead><tbody>
        {data.recent_sales.map((s: any) => <tr key={s.id}><td><Link href={`/sales?open=${s.id}`}>{s.receipt_no}</Link></td><td className="muted small">{dt(s.created_at)}</td><td>{s.employee_name}</td><td>{METHOD[s.payment_method]}</td><td className="num"><b>{money(s.total, sym)}</b></td><td><StatusBadge status={s.status} /></td></tr>)}
        {data.recent_sales.length === 0 && <tr><td colSpan={6} className="empty">No sales yet. Open the POS to make your first sale.</td></tr>}</tbody></table></div></Card>
  </Page>);
}
