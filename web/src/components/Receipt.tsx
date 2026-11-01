'use client';
import { money } from '@/lib/api';
import { Modal } from '@/components/ui';

export function ReceiptModal({ r, sym, onClose }: { r: any; sym: string; onClose: () => void }) {
  const b = r.business;
  return (<Modal title="Receipt" onClose={onClose}>
    <div className="receipt">
      <div style={{ textAlign: 'center' }}>{b.logo_url && b.receipt_show_logo && <img src={b.logo_url} alt="" style={{ maxHeight: 54, marginBottom: 4 }} />}<b style={{ fontSize: 16 }}>{b.name}</b><br />{b.address}<br />{b.phone && `Tel: ${b.phone}`} {b.email}</div><hr />
      <div>Receipt: {r.receipt_no}</div><div>Date: {new Date(r.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Accra' })}</div><div>Served by: {r.employee_name}</div>{r.customer_name && <div>Customer: {r.customer_name}</div>}<hr />
      {r.items.map((i: any, k: number) => <div key={k}><b>{i.name}</b><div className="l"><span>{i.quantity} x {money(i.unit_price, sym)}</span><span>{money(i.line_total, sym)}</span></div></div>)}<hr />
      <div className="l"><span>Subtotal</span><span>{money(r.subtotal, sym)}</span></div>{r.discount > 0 && <div className="l"><span>Discount</span><span>−{money(r.discount, sym)}</span></div>}
      <div className="l"><b>TOTAL</b><b>{money(r.total, sym)}</b></div><div className="l"><span>Paid ({r.payment_method.replace('_', ' ')})</span><span>{money(r.amount_paid, sym)}</span></div>
      {r.change_due > 0 && <div className="l"><span>Change</span><span>{money(r.change_due, sym)}</span></div>}{r.balance_due > 0 && <div className="l"><b>Balance owing</b><b>{money(r.balance_due, sym)}</b></div>}<hr />
      <div style={{ textAlign: 'center' }}>{r.footer}</div>
    </div>
    <div className="row no-print" style={{ marginTop: 16, justifyContent: 'center' }}>
      <button className="btn" onClick={() => window.print()}>🖨 Print</button>
      <a className="btn secondary" href={`/api/sales/${r.sale_id}/receipt.pdf`} target="_blank" rel="noreferrer">⬇ PDF</a>
      <button className="btn secondary" onClick={onClose}>New sale</button>
    </div>
  </Modal>);
}
