import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query, one } from '../db.ts';
import { requireOwner, checkPassword, audit } from '../auth.ts';
import { bad, notFound } from '../errors.ts';
import { createBackup, verifyBackup, restoreBackup, backupRoot } from '../backup.ts';

export const backupsRouter = Router();
const restoreLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many restore attempts. Wait a few minutes.' } });
const busy = new Set<string>();   // one backup/restore per business at a time

backupsRouter.get('/backups', requireOwner, async (req, res) => {
  const biz = req.user!.business_id;
  const rows = await query(
    `SELECT k.id, k.kind, k.status, k.size_bytes, k.sha256, k.encrypted, k.file_count, k.table_counts, k.error, k.created_at, k.verified_at, k.restored_at, u.name AS created_by_name
       FROM backups k LEFT JOIN users u ON u.id=k.created_by WHERE k.business_id=$1 ORDER BY k.created_at DESC LIMIT 100`, [biz]);
  const settings = await one('SELECT backup_frequency, backup_retention FROM businesses WHERE id=$1', [biz]);
  res.json({ backups: rows, settings, custom_key: !!process.env.BACKUP_ENCRYPTION_KEY });
});

backupsRouter.put('/backups/settings', requireOwner, async (req, res) => {
  const b = z.object({ backup_frequency: z.enum(['off', 'daily', 'weekly']), backup_retention: z.coerce.number().int().min(3).max(90) }).parse(req.body);
  await query('UPDATE businesses SET backup_frequency=$2, backup_retention=$3 WHERE id=$1', [req.user!.business_id, b.backup_frequency, b.backup_retention]);
  await audit(req, req.user, 'backup.settings', 'business', req.user!.business_id, b);
  res.json({ ok: true });
});

backupsRouter.post('/backups', requireOwner, async (req, res) => {
  const biz = req.user!.business_id;
  if (busy.has(biz)) throw bad('Another backup or restore is already running');
  busy.add(biz);
  try {
    const r = await createBackup(biz, 'manual', req.user!.id);
    await audit(req, req.user, 'backup.create', 'backup', r.id, { status: r.status });
    if (r.status !== 'verified') return res.status(500).json({ error: `Backup failed: ${r.error}`, code: 'backup_failed' });
    res.status(201).json({ backup: r });
  } finally { busy.delete(biz); }
});

backupsRouter.post('/backups/:id/verify', requireOwner, async (req, res) => {
  try { await verifyBackup(String(req.params.id), req.user!.business_id); }
  catch (e: any) {
    await query(`UPDATE backups SET status='failed', error=$3 WHERE id=$1 AND business_id=$2`, [req.params.id, req.user!.business_id, String(e.message).slice(0, 300)]);
    throw bad(`Verification failed: ${e.message}`);
  }
  res.json({ ok: true });
});

backupsRouter.get('/backups/:id/download', requireOwner, async (req, res) => {
  const b = await one<any>(`SELECT filename, created_at FROM backups WHERE id=$1 AND business_id=$2 AND status='verified'`, [req.params.id, req.user!.business_id]);
  if (!b) throw notFound('Backup not found');
  const file = path.join(backupRoot, path.basename(b.filename));
  if (!fs.existsSync(file)) throw notFound('The backup file is missing from the server');
  await audit(req, req.user, 'backup.download', 'backup', String(req.params.id), {});
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="techhub-backup-${new Date(b.created_at).toISOString().slice(0, 10)}.thb"`);
  fs.createReadStream(file).pipe(res);
});

// Restoring replaces business data, so it needs: owner, the owner's password, and the typed word RESTORE.
backupsRouter.post('/backups/:id/restore', requireOwner, restoreLimiter, async (req, res) => {
  const b = z.object({ confirm: z.literal('RESTORE'), password: z.string().min(1).max(200) }).parse(req.body);
  const biz = req.user!.business_id;
  const u = await one<any>('SELECT password_hash FROM users WHERE id=$1', [req.user!.id]);
  if (!u || !(await checkPassword(b.password, u.password_hash))) throw bad('Your password is not correct');
  const rec = await one<any>(`SELECT id FROM backups WHERE id=$1 AND business_id=$2 AND status='verified' AND kind IN ('manual','scheduled','pre_restore')`, [req.params.id, biz]);
  if (!rec) throw notFound('Only a verified backup can be restored');
  if (busy.has(biz)) throw bad('Another backup or restore is already running');
  busy.add(biz);
  try {
    const r = await restoreBackup(req, rec.id);
    res.json({ ok: true, safety_backup_id: r.safety_backup_id });
  } catch (e: any) {
    await audit(req, req.user, 'backup.restore_failed', 'backup', rec.id, { error: String(e.message).slice(0, 200) }).catch(() => {});
    throw bad(`Restore failed and your current data was not changed: ${e.message}`);
  } finally { busy.delete(biz); }
});
