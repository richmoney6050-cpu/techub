import { query } from './db.ts';
import { config } from './config.ts';
import { deliverExternal } from './notify.ts';

const today = `(now() AT TIME ZONE '${config.timezone}')::date`;
const WARRANTY_DAYS = Number(process.env.WARRANTY_ALERT_DAYS || 30);

/** Creates (once per item, thanks to the partial unique index) warranty-expiry and overdue-balance notifications. Never throws. */
export async function runDailyChecks() {
  try {
    const w = await query<any>(
      `INSERT INTO notifications (business_id, type, ref_id, message)
       SELECT w.business_id, 'warranty_expiring', w.id, 'Warranty for ' || w.product_name || coalesce(' (' || coalesce(w.serial_number, w.imei) || ')','') || ' ends on ' || to_char(w.end_date,'DD Mon YYYY')
         FROM warranties w WHERE w.status='active' AND w.end_date >= ${today} AND w.end_date <= ${today} + $1::int
       ON CONFLICT DO NOTHING RETURNING business_id, message`, [WARRANTY_DAYS]);
    const o = await query<any>(
      `INSERT INTO notifications (business_id, type, ref_id, message)
       SELECT s.business_id, 'customer_overdue', s.id, c.name || ' owes ' || s.balance_due::text || ' on ' || s.receipt_no || ' (due ' || to_char(s.due_date,'DD Mon YYYY') || ')'
         FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.balance_due > 0 AND s.due_date IS NOT NULL AND s.due_date < ${today}
       ON CONFLICT DO NOTHING RETURNING business_id, message`);
    // expired warranties no longer need their "expiring" alert
    await query(`UPDATE notifications n SET resolved=true FROM warranties w WHERE n.ref_id=w.id AND n.type='warranty_expiring' AND NOT n.resolved AND w.end_date < ${today}`);
    for (const n of [...w, ...o]) deliverExternal(n.business_id, 'TECHHUB reminder', n.message);
  } catch (e) { console.error('daily checks failed', e); }
}
export function startJobs() {
  setTimeout(runDailyChecks, 15_000);
  setInterval(runDailyChecks, 6 * 60 * 60 * 1000).unref();
}
