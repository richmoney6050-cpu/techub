import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config, PERMISSIONS } from './config.ts';
import { one, query, pool, Db } from './db.ts';
import { HttpError, forbidden } from './errors.ts';

export interface AuthUser {
  id: string;
  business_id: string;
  name: string;
  role: 'owner' | 'employee';
  permissions: string[];
  session_id: string;
}
declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function validatePasswordStrength(pw: string) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters', 'weak_password');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new HttpError(400, 'Password must contain letters and numbers', 'weak_password');
}

export async function createSession(userId: string, device: string | undefined, ip: string | undefined, db: Db = pool) {
  const hours = config.sessionHours;
  const row = await one<{ id: string }>(
    `INSERT INTO sessions (user_id, device, ip, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' hours')::interval) RETURNING id`,
    [userId, device ?? null, ip ?? null, String(hours)], db);
  const token = jwt.sign({ sid: row!.id, uid: userId }, config.jwtSecret, { expiresIn: `${hours}h` });
  return token;
}

export function effectivePermissions(role: string, perms: string[]): string[] {
  return role === 'owner' ? [...PERMISSIONS] : perms.filter((p) => (PERMISSIONS as readonly string[]).includes(p));
}

/** Verifies the bearer token AND re-checks the session/user in the database on every request. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'Please log in', 'unauthenticated');
  let payload: any;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Your session has expired. Please log in again.', 'unauthenticated');
  }
  const row = await one<any>(
    `SELECT u.id, u.business_id, u.name, u.role, u.permissions, u.is_active, s.id AS session_id, s.revoked, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND u.id = $2`, [payload.sid, payload.uid]);
  if (!row || row.revoked || new Date(row.expires_at) < new Date()) throw new HttpError(401, 'Your session has ended. Please log in again.', 'unauthenticated');
  if (!row.is_active) throw new HttpError(401, 'This account has been deactivated', 'deactivated');
  req.user = {
    id: row.id, business_id: row.business_id, name: row.name, role: row.role,
    permissions: effectivePermissions(row.role, row.permissions || []), session_id: row.session_id,
  };
  next();
}

export const can = (u: AuthUser | undefined, perm: string) => !!u && u.permissions.includes(perm);

/** Require ALL listed permissions. Enforced on the server for every protected route. */
export function requirePerm(...perms: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, 'Please log in', 'unauthenticated');
    for (const p of perms) if (!can(req.user, p)) throw forbidden();
    next();
  };
}
/** Require ANY of the listed permissions. */
export function requireAny(...perms: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, 'Please log in', 'unauthenticated');
    if (!perms.some((p) => can(req.user, p))) throw forbidden();
    next();
  };
}
export const requireOwner = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) throw new HttpError(401, 'Please log in', 'unauthenticated');
  if (req.user.role !== 'owner') throw forbidden('Only the business owner can do this');
  next();
};

export async function audit(req: Request | null, user: { id?: string; business_id: string } | undefined, action: string, entity?: string, entityId?: string, details: any = {}, db: Db = pool) {
  await query(
    `INSERT INTO audit_logs (business_id, user_id, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [user?.business_id ?? null, user?.id ?? null, action, entity ?? null, entityId ?? null, JSON.stringify(details), req?.ip ?? null], db);
}
