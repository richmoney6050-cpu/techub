import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { query, one, tx, Db } from './db.ts';
import { config } from './config.ts';
import { uploadRoot } from './files.ts';
import { audit } from './auth.ts';
import { deliverExternal } from './notify.ts';

const gzip = promisify(zlib.gzip); const gunzip = promisify(zlib.gunzip);
export const backupRoot = path.resolve(process.env.BACKUP_DIR || path.join(config.uploadDir, '..', 'backups'));
const MAGIC = Buffer.from('THB1');
const MAX_FILES_BYTES = 150 * 1024 * 1024;

/** Business data that a restore replaces, parents first. Users/roles/sessions/audit logs are deliberately NOT rolled back. */
export const REPLACED: { table: string; scope: string }[] = [
  { table: 'categories', scope: 'business_id=$1' }, { table: 'brands', scope: 'business_id=$1' }, { table: 'customers', scope: 'business_id=$1' }, { table: 'suppliers', scope: 'business_id=$1' },
  { table: 'products', scope: 'business_id=$1' }, { table: 'product_variations', scope: 'business_id=$1' }, { table: 'inventory', scope: 'business_id=$1' }, { table: 'stock_movements', scope: 'business_id=$1' },
  { table: 'counters', scope: 'business_id=$1' }, { table: 'sales', scope: 'business_id=$1' }, { table: 'sale_items', scope: 'business_id=$1' }, { table: 'payments', scope: 'business_id=$1' }, { table: 'receipts', scope: 'business_id=$1' },
  { table: 'purchase_orders', scope: 'business_id=$1' }, { table: 'purchase_order_items', scope: 'purchase_order_id IN (SELECT id FROM purchase_orders WHERE business_id=$1)' }, { table: 'supplier_payments', scope: 'business_id=$1' },
  { table: 'returns', scope: 'business_id=$1' }, { table: 'return_items', scope: 'return_id IN (SELECT id FROM returns WHERE business_id=$1)' }, { table: 'expenses', scope: 'business_id=$1' },
  { table: 'notifications', scope: 'business_id=$1' }, { table: 'warranties', scope: 'business_id=$1' }, { table: 'warranty_claims', scope: 'business_id=$1' },
];
/** Copied into the backup for reference, restored only when missing (never overwrite current access control). */
const KEEP_IF_MISSING = [{ table: 'roles', scope: 'business_id=$1' }, { table: 'users', scope: 'business_id=$1' }];

const key = () => crypto.scryptSync(process.env.BACKUP_ENCRYPTION_KEY || config.jwtSecret, 'techhub-backup-v1', 32);
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

function encrypt(plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), enc]);
}
function decrypt(buf: Buffer): Buffer {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Not a TECHHUB backup file');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(4, 16)); d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

async function columns(db: Db, table: string): Promise<string[]> {
  const r = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND is_generated='NEVER' ORDER BY ordinal_position`, [table], db);
  return r.map((x) => x.column_name);
}

/** Builds the backup file for one business, writes it, then VERIFIES it. Status becomes 'verified' only if verification passes. */
export async function createBackup(businessId: string, kind: 'manual' | 'scheduled' | 'pre_restore', userId: string | null): Promise<{ id: string; status: string; error?: string }> {
  const rec = await one<any>(`INSERT INTO backups (business_id, kind, created_by) VALUES ($1,$2,$3) RETURNING id`, [businessId, kind, userId]);
  try {
    fs.mkdirSync(backupRoot, { recursive: true, mode: 0o750 });
    // one consistent snapshot of every table
    const parts: string[] = []; const counts: Record<string, number> = {};
    await tx(async (c) => {
      await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY', [], c).catch(() => {});
      const biz = await one<any>(`SELECT row_to_json(b)::text AS j FROM businesses b WHERE id=$1`, [businessId], c);
      parts.push(`"business":${biz!.j}`);
      for (const t of [...KEEP_IF_MISSING, ...REPLACED]) {
        const r = await one<any>(`SELECT coalesce(json_agg(t),'[]'::json)::text AS j, count(*)::int AS n FROM ${t.table} t WHERE ${t.scope}`, [businessId], c);
        parts.push(`${JSON.stringify(t.table)}:${r!.j}`); counts[t.table] = r!.n;
      }
    });
    // uploaded images
    const files: Record<string, string> = {}; let total = 0, skipped = 0;
    const dir = path.join(uploadRoot, businessId);
    if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name); const st = fs.statSync(full);
      if (!st.isFile() || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)) continue;
      if (total + st.size > MAX_FILES_BYTES) { skipped++; continue; }
      files[name] = fs.readFileSync(full).toString('base64'); total += st.size;
    }
    const meta = { format: 1, app: 'TECHHUB', business_id: businessId, created_at: new Date().toISOString(), counts, files: Object.keys(files).length, files_skipped: skipped };
    const json = `{"meta":${JSON.stringify(meta)},"files":${JSON.stringify(files)},${parts.join(',')}}`;
    const packed = encrypt(await gzip(Buffer.from(json, 'utf8')));
    const filename = `${rec.id}.thb`;
    fs.writeFileSync(path.join(backupRoot, filename), packed, { mode: 0o640 });
    await query(`UPDATE backups SET filename=$2, size_bytes=$3, sha256=$4, encrypted=true, table_counts=$5, file_count=$6, status='running' WHERE id=$1`,
      [rec.id, filename, packed.length, sha(packed), JSON.stringify(counts), meta.files]);
    await verifyBackup(rec.id, businessId);   // throws if corrupt
    await pruneBackups(businessId);
    return { id: rec.id, status: 'verified' };
  } catch (e: any) {
    console.error('backup failed', e);
    await query(`UPDATE backups SET status='failed', error=$2 WHERE id=$1`, [rec.id, String(e.message || e).slice(0, 300)]);
    await query(`INSERT INTO notifications (business_id, type, message) VALUES ($1,'system',$2)`, [businessId, `Backup FAILED: ${String(e.message || e).slice(0, 150)}`]).catch(() => {});
    deliverExternal(businessId, 'Backup failed', `A ${kind} backup failed: ${e.message || e}`);
    return { id: rec.id, status: 'failed', error: String(e.message || e) };
  }
}

/** Reads the stored file back: checksum, decryption, JSON structure and row counts must all match. */
export async function readBackup(id: string, businessId: string): Promise<any> {
  const b = await one<any>('SELECT * FROM backups WHERE id=$1 AND business_id=$2', [id, businessId]);
  if (!b || !b.filename) throw new Error('Backup not found');
  const file = path.join(backupRoot, path.basename(b.filename));
  if (!fs.existsSync(file)) throw new Error('Backup file is missing from the server');
  const buf = fs.readFileSync(file);
  if (sha(buf) !== b.sha256) throw new Error('Checksum mismatch: the backup file is corrupted');
  const data = JSON.parse((await gunzip(decrypt(buf))).toString('utf8'));
  if (data.meta?.format !== 1 || data.meta.business_id !== businessId) throw new Error('Backup belongs to a different business or is not valid');
  for (const [t, n] of Object.entries<number>(b.table_counts || {})) if (!Array.isArray(data[t]) || data[t].length !== n) throw new Error(`Backup content check failed for ${t}`);
  return data;
}
export async function verifyBackup(id: string, businessId: string) {
  await readBackup(id, businessId);
  await query(`UPDATE backups SET status='verified', verified_at=now(), error=NULL WHERE id=$1`, [id]);
}

async function pruneBackups(businessId: string) {
  const b = await one<any>('SELECT backup_retention AS n FROM businesses WHERE id=$1', [businessId]);
  const old = await query<any>(`SELECT id, filename FROM backups WHERE business_id=$1 AND status='verified' ORDER BY created_at DESC OFFSET $2`, [businessId, b?.n ?? 14]);
  for (const o of old) { try { fs.rmSync(path.join(backupRoot, path.basename(o.filename)), { force: true }); } catch {} await query('DELETE FROM backups WHERE id=$1', [o.id]); }
}

/** Replaces the business data with the contents of a verified backup. Takes a safety backup first; all-or-nothing. */
export async function restoreBackup(req: any, id: string): Promise<{ safety_backup_id: string }> {
  const user = req.user; const biz = user.business_id;
  const data = await readBackup(id, biz);                                   // 1. verify the chosen backup
  const safety = await createBackup(biz, 'pre_restore', user.id);          // 2. safety copy of the CURRENT data
  if (safety.status !== 'verified') throw new Error('Could not take a safety backup of the current data, so nothing was changed');
  await tx(async (c) => {
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', [`restore:${biz}`], c);
    for (const t of KEEP_IF_MISSING) {                                       // access control: only add what is missing
      const cols = (await columns(c, t.table)).map((x) => `"${x}"`).join(',');
      await query(`INSERT INTO ${t.table} (${cols}) SELECT ${cols} FROM json_populate_recordset(null::${t.table}, $1::json) ON CONFLICT DO NOTHING`, [JSON.stringify(data[t.table])], c);
    }
    for (const t of [...REPLACED].reverse()) await query(`DELETE FROM ${t.table} WHERE ${t.scope}`, [biz], c);
    for (const t of REPLACED) {
      if (!data[t.table].length) continue;
      const cols = (await columns(c, t.table)).map((x) => `"${x}"`).join(',');
      await query(`INSERT INTO ${t.table} (${cols}) SELECT ${cols} FROM json_populate_recordset(null::${t.table}, $1::json)`, [JSON.stringify(data[t.table])], c);
    }
    const bcols = (await columns(c, 'businesses')).filter((x) => !['id', 'created_at'].includes(x));
    await query(`UPDATE businesses b SET ${bcols.map((x) => `"${x}"=r."${x}"`).join(',')} FROM json_populate_record(null::businesses, $2::json) r WHERE b.id=$1`, [biz, JSON.stringify(data.business)], c);
    await query('UPDATE backups SET restored_at=now(), restored_by=$2 WHERE id=$1', [id, user.id], c);
    await audit(req, user, 'backup.restore', 'backup', id, { safety_backup_id: safety.id, counts: data.meta.counts }, c);
  });
  // images that are in the backup but missing on disk
  const dir = path.join(uploadRoot, biz); fs.mkdirSync(dir, { recursive: true });
  for (const [name, b64] of Object.entries<string>(data.files || {})) {
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)) continue;
    const p = path.join(dir, name); if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.from(b64, 'base64'), { mode: 0o640 });
  }
  await query(`INSERT INTO notifications (business_id, type, message) VALUES ($1,'system',$2)`, [biz, `Data was restored from the backup of ${data.meta.created_at.slice(0, 16).replace('T', ' ')} UTC by ${user.name}`]);
  return { safety_backup_id: safety.id };
}

/** Scheduled backups: called periodically; creates one when the last verified scheduled/manual one is older than the interval. */
export async function runScheduledBackups() {
  try {
    const due = await query<any>(
      `SELECT b.id FROM businesses b WHERE b.backup_frequency <> 'off' AND NOT EXISTS (
         SELECT 1 FROM backups k WHERE k.business_id=b.id AND k.status IN ('verified','running') AND k.kind <> 'pre_restore'
            AND k.created_at > now() - CASE b.backup_frequency WHEN 'weekly' THEN interval '7 days' ELSE interval '23 hours' END)
         AND NOT EXISTS (SELECT 1 FROM backups k WHERE k.business_id=b.id AND k.status='failed' AND k.created_at > now() - interval '3 hours')`);
    for (const d of due) {
      const r = await createBackup(d.id, 'scheduled', null);
      if (r.status === 'verified') await query(`INSERT INTO notifications (business_id, type, message) VALUES ($1,'system','Automatic backup completed and verified')`, [d.id]);
    }
  } catch (e) { console.error('scheduled backups failed', e); }
}
