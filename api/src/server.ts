import { createApp } from './app.ts';
import { migrate } from './migrate.ts';
import { config } from './config.ts';
import { pool } from './db.ts';
import { startJobs } from './jobs.ts';

await migrate();
const app = createApp();
const server = app.listen(config.port, () => console.log(`TECHHUB API listening on :${config.port}`));
startJobs();
const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
