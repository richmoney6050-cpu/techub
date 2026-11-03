import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import multer from 'multer';
import { config } from './config.ts';
import { pool } from './db.ts';
import { authenticate } from './auth.ts';
import { HttpError } from './errors.ts';
import { resolveFile } from './files.ts';
import { authRouter } from './routes/auth.ts';
import { catalogRouter } from './routes/catalog.ts';
import { productsRouter } from './routes/products.ts';
import { inventoryRouter } from './routes/inventory.ts';
import { salesRouter } from './routes/sales.ts';
import { returnsRouter } from './routes/returns.ts';
import { suppliersRouter } from './routes/suppliers.ts';
import { adminRouter } from './routes/admin.ts';
import { dashboardRouter } from './routes/dashboard.ts';
import { reportsRouter } from './routes/reports.ts';
import { customersRouter } from './routes/customers.ts';
import { warrantiesRouter } from './routes/warranties.ts';
import { backupsRouter } from './routes/backups.ts';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)),
    allowedHeaders: ['Content-Type', 'Authorization'], methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  }));
  app.use(express.json({ limit: '200kb' }));
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ ok: true, service: 'techhub-api' }); }
    catch { res.status(503).json({ ok: false }); }
  });

  app.use('/api/auth', authRouter);

  // Everything below requires a valid session. Permissions are enforced per route on the server.
  app.use('/api', authenticate);
  // Uploaded images are only served to signed-in members of the SAME business.
  app.get('/api/files/:biz/:name', (req, res) => {
    if (req.user!.business_id !== req.params.biz) return res.status(404).json({ error: 'Not found' });
    const file = resolveFile(String(req.params.biz), String(req.params.name));
    if (!file) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(file);
  });
  app.use('/api', catalogRouter, productsRouter, inventoryRouter, salesRouter, returnsRouter, suppliersRouter, adminRouter, dashboardRouter, reportsRouter, customersRouter, warrantiesRouter, backupsRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return res.status(400).json({ error: `${first.path.join('.') || 'Input'}: ${first.message}`, code: 'validation', details: err.issues });
    }
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (max 3MB)' : 'Upload failed' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err?.code === '23505') return res.status(409).json({ error: 'That record already exists', code: 'duplicate' });
    if (err?.code === '23514') return res.status(409).json({ error: 'That change is not allowed (it would break a stock or price rule)', code: 'constraint' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
