import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { pool, one, query, tx } from '../db.ts';
import { authenticate, hashPassword, checkPassword, createSession, validatePasswordStrength, audit, effectivePermissions } from '../auth.ts';
import { HttpError, bad, conflict } from '../errors.ts';
import { PERMISSIONS } from '../config.ts';
import bcrypt from 'bcryptjs';

// Used to keep login timing similar whether or not the username exists
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait a few minutes.' } });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-ups from this address. Try later.' } });

export const ROLE_TEMPLATES: Record<string, string[]> = {
  Cashier: ['products.view', 'sales.create', 'sales.view'],
  'Senior Cashier': ['products.view', 'sales.create', 'sales.view', 'sales.view_all', 'discounts.apply', 'returns.process', 'notifications.view', 'customers.manage'],
  'Stock Clerk': ['products.view', 'products.create', 'products.edit', 'stock.adjust', 'notifications.view'],
  Manager: PERMISSIONS.filter((p) => !['employees.manage', 'settings.manage'].includes(p)) as string[],
};

const registerSchema = z.object({
  business_name: z.string().trim().min(2).max(120),
  owner_name: z.string().trim().min(2).max(120),
  username: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9._-]+$/, 'Username may only contain letters, numbers, . _ -'),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional(),
  password: z.string(),
});

authRouter.post('/register', registerLimiter, async (req, res) => {
  const b = registerSchema.parse(req.body);
  validatePasswordStrength(b.password);
  const hash = await hashPassword(b.password);
  const out = await tx(async (c) => {
    if (await one('SELECT 1 FROM users WHERE lower(username)=lower($1)', [b.username], c)) throw conflict('That username is already taken', 'username_taken');
    if (b.email && await one('SELECT 1 FROM users WHERE lower(email)=lower($1)', [b.email], c)) throw conflict('That email is already registered', 'email_taken');
    const biz = await one<any>('INSERT INTO businesses (name, email, phone) VALUES ($1,$2,$3) RETURNING id', [b.business_name, b.email || null, b.phone || null], c);
    let ownerRole: string | null = null;
    for (const [name, perms] of Object.entries({ Owner: [...PERMISSIONS], ...ROLE_TEMPLATES })) {
      const r = await one<any>('INSERT INTO roles (business_id, name, permissions, is_system) VALUES ($1,$2,$3,$4) RETURNING id', [biz.id, name, perms, name === 'Owner'], c);
      if (name === 'Owner') ownerRole = r.id;
    }
    const u = await one<any>(
      `INSERT INTO users (business_id, role_id, role, name, phone, email, username, password_hash, permissions)
       VALUES ($1,$2,'owner',$3,$4,$5,$6,$7,$8) RETURNING id`,
      [biz.id, ownerRole, b.owner_name, b.phone || null, b.email || null, b.username, hash, [...PERMISSIONS]], c);
    await audit(req, { id: u.id, business_id: biz.id }, 'business.register', 'business', biz.id, {}, c);
    const token = await createSession(u.id, req.get('user-agent'), req.ip, c);
    return { token, user_id: u.id, business_id: biz.id };
  });
  res.status(201).json({ token: out.token });
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const b = z.object({ username: z.string().trim().min(1), password: z.string().min(1), device: z.string().max(100).optional() }).parse(req.body);
  const u = await one<any>('SELECT * FROM users WHERE lower(username)=lower($1) OR lower(email)=lower($1)', [b.username]);
  const generic = new HttpError(401, 'Incorrect username or password', 'bad_credentials');
  if (!u) { await checkPassword(b.password, DUMMY_HASH); throw generic; }
  if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(429, 'Account temporarily locked after too many failed attempts. Try again in a few minutes.', 'locked');
  const ok = await checkPassword(b.password, u.password_hash);
  if (!ok) {
    const n = u.failed_logins + 1;
    await query(`UPDATE users SET failed_logins = CASE WHEN $2::int >= 8 THEN 0 ELSE $2::int END,
                   locked_until = CASE WHEN $2::int >= 8 THEN now() + interval '15 minutes' ELSE NULL END WHERE id=$1`, [u.id, n]);
    await audit(req, { id: u.id, business_id: u.business_id }, 'auth.login_failed', 'user', u.id);
    throw generic;
  }
  if (!u.is_active) throw new HttpError(403, 'This account has been deactivated. Please contact the business owner.', 'deactivated');
  await query('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1', [u.id]);
  const token = await createSession(u.id, b.device || req.get('user-agent'), req.ip);
  await audit(req, { id: u.id, business_id: u.business_id }, 'auth.login', 'user', u.id);
  res.json({ token });
});

authRouter.get('/me', authenticate, async (req, res) => {
  const u = req.user!;
  const row = await one<any>(
    `SELECT u.id, u.name, u.username, u.email, u.phone, u.role, b.id AS business_id, b.name AS business_name, b.logo_url, b.currency, b.currency_symbol, u.theme
       FROM users u JOIN businesses b ON b.id=u.business_id WHERE u.id=$1`, [u.id]);
  res.json({ user: { ...row, permissions: u.permissions } });
});

authRouter.put('/preferences', authenticate, async (req, res) => {
  const b = z.object({ theme: z.enum(['light', 'dark', 'system']) }).parse(req.body);
  await query('UPDATE users SET theme=$2 WHERE id=$1', [req.user!.id, b.theme]);
  res.json({ ok: true, theme: b.theme });
});

authRouter.post('/logout', authenticate, async (req, res) => {
  await query('UPDATE sessions SET revoked=true WHERE id=$1', [req.user!.session_id]);
  res.json({ ok: true });
});

authRouter.post('/change-password', authenticate, async (req, res) => {
  const b = z.object({ current_password: z.string(), new_password: z.string() }).parse(req.body);
  validatePasswordStrength(b.new_password);
  const u = await one<any>('SELECT password_hash FROM users WHERE id=$1', [req.user!.id]);
  if (!(await checkPassword(b.current_password, u.password_hash))) throw bad('Current password is incorrect');
  await query('UPDATE users SET password_hash=$2 WHERE id=$1', [req.user!.id, await hashPassword(b.new_password)]);
  await query('UPDATE sessions SET revoked=true WHERE user_id=$1 AND id<>$2', [req.user!.id, req.user!.session_id]);
  await audit(req, req.user, 'auth.change_password', 'user', req.user!.id);
  res.json({ ok: true });
});

authRouter.post('/push-token', authenticate, async (req, res) => {
  const b = z.object({ token: z.string().min(10).max(300), platform: z.string().max(20).optional() }).parse(req.body);
  await query('INSERT INTO push_tokens (user_id, token, platform) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.user!.id, b.token, b.platform ?? null]);
  res.json({ ok: true });
});
