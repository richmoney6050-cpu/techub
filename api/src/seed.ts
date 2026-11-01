// Creates a DEMO business with sample (flagged) products so you can try TECHHUB immediately.
// Usage: SEED_OWNER_PASSWORD=YourPassw0rd npm run seed
import crypto from 'node:crypto';
import { migrate } from './migrate.ts';
import { pool, one, tx } from './db.ts';
import { hashPassword } from './auth.ts';
import { PERMISSIONS } from './config.ts';
import { loadDemoData } from './demo.ts';
import { ROLE_TEMPLATES } from './routes/auth.ts';

await migrate();
const username = process.env.SEED_OWNER_USERNAME || 'owner';
if (await one('SELECT 1 FROM users WHERE lower(username)=lower($1)', [username])) {
  console.log(`User "${username}" already exists – nothing to do.`);
  await pool.end(); process.exit(0);
}
const password = process.env.SEED_OWNER_PASSWORD || crypto.randomBytes(9).toString('base64url') + '7a';
await tx(async (c) => {
  const biz = await one<any>(`INSERT INTO businesses (name, phone, address, email) VALUES ('TechHub Demo Shop','+233 24 000 0000','Accra, Ghana','owner@example.com') RETURNING id`, [], c);
  let ownerRole = '';
  for (const [name, perms] of Object.entries({ Owner: [...PERMISSIONS], ...ROLE_TEMPLATES })) {
    const r = await one<any>('INSERT INTO roles (business_id,name,permissions,is_system) VALUES ($1,$2,$3,$4) RETURNING id', [biz.id, name, perms, name === 'Owner'], c);
    if (name === 'Owner') ownerRole = r.id;
  }
  const u = await one<any>(`INSERT INTO users (business_id, role_id, role, name, username, email, password_hash, permissions) VALUES ($1,$2,'owner','Shop Owner',$3,'owner@example.com',$4,$5) RETURNING id`,
    [biz.id, ownerRole, username, await hashPassword(password), [...PERMISSIONS]], c);
  const n = await loadDemoData(c, biz.id, u.id);
  console.log(`Created demo business with ${n} DEMO products.`);
});
console.log(`\nLogin  ->  username: ${username}   password: ${password}\n(Change this password after first login.)`);
await pool.end();
