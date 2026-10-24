import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

const connectionString = process.env.DATABASE_URL;

const pool = new Pool(
  connectionString ? { connectionString } : undefined
);

pool.on('error', (err) => {
  console.warn('PostgreSQL background pool notice:', err.message);
});

export const db = drizzle(pool, { schema });
