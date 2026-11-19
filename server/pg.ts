import 'dotenv/config';
import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPgPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not configured.');
  }

  pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err.message);
  });

  return pool;
}

export async function verifyPgConnection(): Promise<{
  connected: boolean;
  database: string;
  serverVersion: string;
  existingTables: string[];
}> {
  const client = await getPgPool().connect();
  try {
    const info = await client.query<{ db: string; version: string }>(
      `SELECT current_database() AS db, version() AS version`
    );
    const tablesRes = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename ASC`
    );
    return {
      connected: true,
      database: info.rows[0]?.db || 'unknown',
      serverVersion: (info.rows[0]?.version || '').split(' on ')[0],
      existingTables: tablesRes.rows.map((r) => r.tablename),
    };
  } finally {
    client.release();
  }
}
