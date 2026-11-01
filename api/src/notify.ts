import nodemailer from 'nodemailer';
import { config } from './config.ts';
import { query, one, Db } from './db.ts';

let transporter: nodemailer.Transporter | null = null;
function mailer() {
  if (!config.smtp.host) return null;
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporter;
}

/** Fire-and-forget delivery of email + push to the owner(s). Never throws. */
export function deliverExternal(businessId: string, title: string, message: string) {
  (async () => {
    const biz = await one<any>('SELECT name, email, notify_email, notify_push FROM businesses WHERE id=$1', [businessId]);
    if (!biz) return;
    if (biz.notify_email && biz.email && mailer()) {
      await mailer()!.sendMail({ from: config.smtp.from, to: biz.email, subject: `[${biz.name}] ${title}`, text: message });
    }
    if (biz.notify_push) {
      const tokens = await query<{ token: string }>(
        `SELECT pt.token FROM push_tokens pt JOIN users u ON u.id = pt.user_id
          WHERE u.business_id=$1 AND u.is_active AND (u.role='owner' OR 'notifications.view' = ANY(u.permissions))`, [businessId]);
      const expo = tokens.map((t) => t.token).filter((t) => t.startsWith('ExponentPushToken'));
      if (expo.length) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(expo.map((to) => ({ to, title, body: message, sound: 'default' }))),
        });
      }
    }
  })().catch((e) => console.error('notification delivery failed:', e?.message));
}

/**
 * Compare the stock condition before/after a change and create (at most one) alert.
 * Must be called inside the same transaction as the stock change.
 * The partial unique index on notifications guarantees no duplicate active alerts.
 */
export async function evaluateStockAlerts(
  db: Db, businessId: string, variationId: string, productLabel: string,
  before: number, after: number, minStock: number,
): Promise<{ title: string; message: string } | null> {
  let alert: { type: string; title: string; message: string } | null = null;

  if (after === 0) {
    alert = { type: 'out_of_stock', title: 'OUT OF STOCK', message: `OUT OF STOCK: ${productLabel} is finished.` };
  } else if (after <= minStock && after > 0) {
    // low stock; if it was previously out of stock the out-of-stock alert is resolved below
    alert = { type: 'low_stock', title: 'LOW STOCK', message: `LOW STOCK: Only ${after} ${productLabel} remaining.` };
  }

  // Resolve alerts that no longer apply
  if (after > 0) await query(`UPDATE notifications SET resolved=true WHERE variation_id=$1 AND type='out_of_stock' AND resolved=false`, [variationId], db);
  if (after === 0) await query(`UPDATE notifications SET resolved=true WHERE variation_id=$1 AND type='low_stock' AND resolved=false`, [variationId], db);
  if (after > minStock) await query(`UPDATE notifications SET resolved=true WHERE variation_id=$1 AND type='low_stock' AND resolved=false`, [variationId], db);

  // Back in stock after being unavailable
  if (before === 0 && after > 0) {
    await query(`INSERT INTO notifications (business_id, variation_id, type, message) VALUES ($1,$2,'restocked',$3)`,
      [businessId, variationId, `RESTOCKED: ${productLabel} is available again (${after} in stock).`], db);
  }

  if (!alert) return before === 0 && after > 0 ? { title: 'RESTOCKED', message: `RESTOCKED: ${productLabel} is available again (${after} in stock).` } : null;

  const ins = await query(
    `INSERT INTO notifications (business_id, variation_id, type, message) VALUES ($1,$2,$3,$4)
     ON CONFLICT (variation_id, type) WHERE resolved = false AND type IN ('low_stock','out_of_stock') DO NOTHING RETURNING id`,
    [businessId, variationId, alert.type, alert.message], db);
  return ins.length ? { title: alert.title, message: alert.message } : null;
}
