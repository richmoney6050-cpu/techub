import pg from 'pg';
import { config } from './config.ts';

// numeric -> number, bigint -> number (all money values are < 2^53 in practice)
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// date -> 'YYYY-MM-DD' string
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX || 10),
});

export type Db = pg.PoolClient | pg.Pool;

export async function query<T = any>(text: string, params: any[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query(text, params);
  return r.rows as T[];
}
export async function one<T = any>(text: string, params: any[] = [], db: Db = pool): Promise<T | null> {
  const rows = await query<T>(text, params, db);
  return rows[0] ?? null;
}

/** Run fn inside a transaction. Retries on serialization failures / deadlocks. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e: any) {
      try { await client.query('ROLLBACK'); } catch {}
      if ((e.code === '40001' || e.code === '40P01') && i < attempts) continue;
      throw e;
    } finally {
      client.release();
    }
  }
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
