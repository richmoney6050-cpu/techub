import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx } from '../db.ts';
import { requireOwner, requireAny, requirePerm, hashPassword, validatePasswordStrength, audit, can } from '../auth.ts';
import { PERMISSIONS, OWNER_ONLY, DEFAULT_EMPLOYEE_PERMISSIONS } from '../config.ts';
import { bad, notFound, conflict } from '../errors.ts';
import { upload, saveImage } from '../files.ts';

export const adminRouter = Router();

const grantable = (p: string[]) => [...new Set(p)].filter((x) => (PERMISSIONS as readonly string[]).includes(x) && !OWNER_ONLY.includes(x));

// ---------- permissions + roles ----------
adminRouter.get('/permissions', requireOwner, async (_req, res) => {
  res.json({ permissions: await query('SELECT key, description, owner_only FROM permissions ORDER BY owner_only, key') });
});
adminRouter.get('/roles', requireOwner, async (req, res) => {
  res.json({ roles: await query('SELECT id, name, permissions, is_system FROM roles WHERE business_id=$1 ORDER BY is_system DESC, name', [req.user!.business_id]) });
});
adminRouter.post('/roles', requireOwner, async (req, res) => {
  const b = z.object({ name: z.string().trim().min(2).max(60), permissions: z.array(z.string()) }).parse(req.body);
  try {
    const row = await one('INSERT INTO roles (business_id,name,permissions) VALUES ($1,$2,$3) RETURNING id,name,permissions,is_system', [req.user!.business_id, b.name, grantable(b.permissions)]);
    await audit(req, req.user, 'role.create', 'role', row.id, { name: b.name });
    res.status(201).json({ role: row });
  } catch (e: any) { if (e.code === '23505') throw conflict('A role with that name already exists'); throw e; }
});
adminRouter.put('/roles/:id', requireOwner, async (req, res) => {
  const b = z.object({ name: z.string().trim().min(2).max(60).optional(), permissions: z.array(z.string()).optional() }).parse(req.body);
  const cur = await one<any>('SELECT * FROM roles WHERE id=$1 AND business_id=$2', [req.params.id, req.user!.business_id]);
  if (!cur) throw notFound('Role not found');
  if (cur.is_system) throw bad('The Owner role cannot be changed');
  const row = await one('UPDATE roles SET name=$3, permissions=$4 WHERE id=$1 AND business_id=$2 RETURNING id,name,permissions,is_system', [cur.id, cur.business_id, b.name ?? cur.name, b.permissions ? grantable(b.permissions) : cur.permissions]);
  await audit(req, req.user, 'role.update', 'role', cur.id, b);
  res.json({ role: row });
});

// ---------- employees ----------
const empBase = z.object({
  name: z.string().trim().min(2).max(120), phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(160).optional().nullable().or(z.literal('')),
  username: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9._-]+$/),
});

adminRouter.get('/employees', requireOwner, async (req, res) => {
  const rows = await query(
    `SELECT u.id, u.name, u.phone, u.email, u.username, u.role, u.is_active, u.permissions, u.created_at, r.name AS role_name,
            (SELECT max(created_at) FROM audit_logs a WHERE a.user_id=u.id) AS last_activity,
            (SELECT count(*) FROM sales s WHERE s.employee_id=u.id) AS sales_count
       FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.business_id=$1 ORDER BY u.role, lower(u.name)`, [req.user!.business_id]);
  res.json({ employees: rows });
});

adminRouter.post('/employees', requireOwner, async (req, res) => {
  const b = empBase.extend({ password: z.string(), role_id: z.string().uuid().optional(), permissions: z.array(z.string()).optional() }).parse(req.body);
  validatePasswordStrength(b.password);
  const biz = req.user!.business_id;
  const hash = await hashPassword(b.password);
  const row = await tx(async (c) => {
    let perms = b.permissions ? grantable(b.permissions) : null;
    let roleId: string | null = null;
    if (b.role_id) {
      const r = await one<any>('SELECT id, permissions, is_system FROM roles WHERE id=$1 AND business_id=$2', [b.role_id, biz], c);
      if (!r || r.is_system) throw bad('Please choose a valid role');
      roleId = r.id; perms ??= grantable(r.permissions);
    }
    perms ??= DEFAULT_EMPLOYEE_PERMISSIONS;
    if (await one('SELECT 1 FROM users WHERE lower(username)=lower($1)', [b.username], c)) throw conflict('That username is already taken', 'username_taken');
    if (b.email && await one('SELECT 1 FROM users WHERE lower(email)=lower($1)', [b.email], c)) throw conflict('That email is already in use', 'email_taken');
    const u = await one<any>(
      `INSERT INTO users (business_id, role_id, role, name, phone, email, username, password_hash, permissions) VALUES ($1,$2,'employee',$3,$4,$5,$6,$7,$8)
       RETURNING id, name, username, email, phone, is_active, permissions`, [biz, roleId, b.name, b.phone || null, b.email || null, b.username, hash, perms], c);
    await audit(req, req.user, 'employee.create', 'user', u.id, { username: b.username, permissions: perms }, c);
    return u;
  });
  res.status(201).json({ employee: row });
});

adminRouter.put('/employees/:id', requireOwner, async (req, res) => {
  const b = empBase.partial().extend({ is_active: z.boolean().optional(), role_id: z.string().uuid().nullable().optional(), permissions: z.array(z.string()).optional() }).parse(req.body);
  const biz = req.user!.business_id;
  const out = await tx(async (c) => {
    const cur = await one<any>(`SELECT * FROM users WHERE id=$1 AND business_id=$2 AND role='employee' FOR UPDATE`, [req.params.id, biz], c);
    if (!cur) throw notFound('Employee not found');
    let perms = b.permissions ? grantable(b.permissions) : cur.permissions;
    let roleId = cur.role_id;
    if (b.role_id !== undefined) {
      if (b.role_id) {
        const r = await one<any>('SELECT id, permissions, is_system FROM roles WHERE id=$1 AND business_id=$2', [b.role_id, biz], c);
        if (!r || r.is_system) throw bad('Please choose a valid role');
        roleId = r.id; if (!b.permissions) perms = grantable(r.permissions);
      } else roleId = null;
    }
    try {
      await query(`UPDATE users SET name=$3, phone=$4, email=$5, username=$6, is_active=$7, permissions=$8, role_id=$9 WHERE id=$1 AND business_id=$2`,
        [cur.id, biz, b.name ?? cur.name, b.phone !== undefined ? b.phone : cur.phone, b.email !== undefined ? (b.email || null) : cur.email, b.username ?? cur.username, b.is_active ?? cur.is_active, perms, roleId], c);
    } catch (e: any) { if (e.code === '23505') throw conflict('That username or email is already in use'); throw e; }
    // Deactivation / permission changes take effect immediately on the server (sessions are re-checked per request).
    if (b.is_active === false) await query('UPDATE sessions SET revoked=true WHERE user_id=$1', [cur.id], c);
    await audit(req, req.user, b.is_active === false ? 'employee.deactivate' : 'employee.update', 'user', cur.id, { before: { permissions: cur.permissions, is_active: cur.is_active }, after: { permissions: perms, is_active: b.is_active ?? cur.is_active } }, c);
    return true;
  });
  res.json({ ok: out });
});

adminRouter.post('/employees/:id/reset-password', requireOwner, async (req, res) => {
  const b = z.object({ password: z.string() }).parse(req.body);
  validatePasswordStrength(b.password);
  const row = await one(`UPDATE users SET password_hash=$3, failed_logins=0, locked_until=NULL WHERE id=$1 AND business_id=$2 AND role='employee' RETURNING id`, [req.params.id, req.user!.business_id, await hashPassword(b.password)]);
  if (!row) throw notFound('Employee not found');
  await query('UPDATE sessions SET revoked=true WHERE user_id=$1', [row.id]);
  await audit(req, req.user, 'employee.reset_password', 'user', row.id);
  res.json({ ok: true });
});

adminRouter.get('/audit-logs', requireOwner, async (req, res) => {
  const q = z.object({ user_id: z.string().uuid().optional(), action: z.string().max(60).optional(), from: z.string().optional(), to: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
  const params: any[] = [req.user!.business_id];
  const w = ['a.business_id=$1'];
  const add = (sql: string, v: any) => { params.push(v); w.push(sql.replaceAll('?', '$' + params.length)); };
  if (q.user_id) add('a.user_id=?', q.user_id);
  if (q.action) add('a.action LIKE ?', q.action.replace(/[%_]/g, '') + '%');
  if (q.from) add('a.created_at >= ?::date', q.from);
  if (q.to) add('a.created_at < (?::date + 1)', q.to);
  const rows = await query(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.ip, a.created_at, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
      WHERE ${w.join(' AND ')} ORDER BY a.created_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`, params);
  res.json({ logs: rows });
});

// ---------- settings ----------
const SETTINGS_PUBLIC = 'id, name, logo_url, address, phone, email, currency, currency_symbol, receipt_footer, receipt_show_logo';
adminRouter.get('/settings', async (req, res) => {
  const extra = can(req.user, 'settings.manage') ? ', default_min_stock, max_discount_percent, notify_in_app, notify_email, notify_push' : '';
  res.json({ settings: await one(`SELECT ${SETTINGS_PUBLIC}${extra} FROM businesses WHERE id=$1`, [req.user!.business_id]) });
});
adminRouter.put('/settings', requirePerm('settings.manage'), async (req, res) => {
  const b = z.object({
    name: z.string().trim().min(2).max(120), address: z.string().trim().max(300).nullable(), phone: z.string().trim().max(40).nullable(),
    email: z.string().trim().email().max(160).nullable().or(z.literal('')), currency: z.string().trim().length(3).toUpperCase(), currency_symbol: z.string().trim().min(1).max(5),
    receipt_footer: z.string().trim().max(200), receipt_show_logo: z.boolean(), default_min_stock: z.coerce.number().int().min(0).max(100000),
    max_discount_percent: z.coerce.number().min(0).max(100), notify_in_app: z.boolean(), notify_email: z.boolean(), notify_push: z.boolean(),
  }).partial().parse(req.body);
  const cur = await one<any>('SELECT * FROM businesses WHERE id=$1', [req.user!.business_id]);
  const m = { ...cur, ...b, email: b.email === '' ? null : (b.email ?? cur.email) };
  await query(
    `UPDATE businesses SET name=$2, address=$3, phone=$4, email=$5, currency=$6, currency_symbol=$7, receipt_footer=$8, receipt_show_logo=$9, default_min_stock=$10,
            max_discount_percent=$11, notify_in_app=$12, notify_email=$13, notify_push=$14 WHERE id=$1`,
    [cur.id, m.name, m.address, m.phone, m.email, m.currency, m.currency_symbol, m.receipt_footer, m.receipt_show_logo, m.default_min_stock, m.max_discount_percent, m.notify_in_app, m.notify_email, m.notify_push]);
  await audit(req, req.user, 'settings.update', 'business', cur.id, b);
  res.json({ settings: await one(`SELECT ${SETTINGS_PUBLIC}, default_min_stock, max_discount_percent, notify_in_app, notify_email, notify_push FROM businesses WHERE id=$1`, [cur.id]) });
});
adminRouter.post('/settings/logo', requirePerm('settings.manage'), upload.single('image'), async (req, res) => {
  const url = saveImage(req.user!.business_id, req.file);
  await query('UPDATE businesses SET logo_url=$2 WHERE id=$1', [req.user!.business_id, url]);
  await audit(req, req.user, 'settings.logo', 'business', req.user!.business_id);
  res.json({ logo_url: url });
});

// ---------- notifications ----------
adminRouter.get('/notifications', requireAny('notifications.view'), async (req, res) => {
  const unread = req.query.unread === 'true';
  const rows = await query(
    `SELECT id, type, message, is_read, resolved, variation_id, created_at FROM notifications WHERE business_id=$1 ${unread ? 'AND NOT is_read' : ''} ORDER BY created_at DESC LIMIT 100`, [req.user!.business_id]);
  const c = await one<any>('SELECT count(*) AS n FROM notifications WHERE business_id=$1 AND NOT is_read', [req.user!.business_id]);
  res.json({ notifications: rows, unread_count: c.n });
});
adminRouter.post('/notifications/read-all', requireAny('notifications.view'), async (req, res) => {
  await query('UPDATE notifications SET is_read=true WHERE business_id=$1', [req.user!.business_id]);
  res.json({ ok: true });
});
adminRouter.post('/notifications/:id/read', requireAny('notifications.view'), async (req, res) => {
  await query('UPDATE notifications SET is_read=true WHERE id=$1 AND business_id=$2', [req.params.id, req.user!.business_id]);
  res.json({ ok: true });
});
