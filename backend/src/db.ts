import { Pool } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.DATABASE_URL });

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationDir = join(__dirname, '../migrations');
  const files = (await readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const exists = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
    if (exists.rowCount) {
      continue;
    }

    const sql = await readFile(join(migrationDir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
