import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';
const secret = process.env.JWT_SECRET || '';
if (isProd && secret.length < 32) {
  throw new Error('JWT_SECRET must be set to a random string of at least 32 characters in production');
}

export const config = {
  port: Number(process.env.PORT || 4000),
  isProd,
  databaseUrl: process.env.DATABASE_URL || 'postgres://techhub:techhub_dev@localhost:5432/techhub_dev',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: secret || 'dev-only-secret-do-not-use-in-production-0123456789',
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  timezone: process.env.BUSINESS_TZ || 'Africa/Accra',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'TECHHUB <no-reply@localhost>',
  },
};

export const PERMISSIONS = [
  'products.view', 'products.view_cost', 'products.create', 'products.edit', 'products.edit_price', 'products.delete',
  'stock.adjust', 'sales.create', 'sales.view', 'sales.view_all', 'discounts.apply', 'returns.process', 'returns.refund',
  'reports.view', 'suppliers.manage', 'expenses.manage', 'notifications.view', 'employees.manage', 'settings.manage',
] as const;
export const OWNER_ONLY = ['employees.manage', 'settings.manage'];
export const DEFAULT_EMPLOYEE_PERMISSIONS = ['products.view', 'sales.create', 'sales.view'];
