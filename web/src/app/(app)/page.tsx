'use client';
import Link from 'next/link';
import { useApi, money, num, dt, METHOD } from '@/lib/api';
import { Page, Card, Stat, Loading, Err, LineChart, BarChart, HBars, StatusBadge } from '@/components/ui';
import { useMe } from '@/lib/me';

export default function Dashboard() {
  const me = useMe();
  const { data, error, loading } = useApi<any>('/dashboard', { interval: 8000 }); // refreshes automatically
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
      <Link href="/products?stock=low" style={{ textDecoration: 'none' }}><Stat label="Low / out of stock" value={<><span style={{ color: '#b7791f' }}>{num(c.low_stock)}</span> / <span style={{ color: '#d93025' }}>{num(c.out_of_stock)}</span></>} sub="Tap to review" /></Link>
    </div>
    <div className="grid g2" style={{ marginTop: 14 }}>
      <Card><div className="chart-title">Sales — last 30 days</div><LineChart data={data.charts.daily_sales} x="day" sym={sym} series={[{ key: 'sales', label: 'Sales', color: '#1e6bff' }]} /></Card>
      <Card><div className="chart-title">Stock movement — last 14 days (units)</div><BarChart data={data.charts.stock_movements} x="day" series={[{ key: 'stock_in', label: 'Stock in', color: '#0f9d58' }, { key: 'stock_out', label: 'Stock out', color: '#0b1f3a' }]} /></Card>
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
