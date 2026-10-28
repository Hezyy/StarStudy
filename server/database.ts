import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { SQL } from 'drizzle-orm';
export type Row = Record<string, unknown>;
export interface Database {
  query(q: SQL): Promise<Row[]>;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function postgresDatabase(url: string): Promise<Database> {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  const orm = drizzle(pool);
  const wrap = (driver: typeof orm): Database => ({
    query: async (q) => (await driver.execute(q)).rows as Row[],
    transaction: (fn) => driver.transaction((tx) => fn(wrap(tx as unknown as typeof orm))),
    close: () => pool.end(),
  });
  await migrate(orm, { migrationsFolder: 'server/migrations' });
  return wrap(orm);
}
export async function embeddedDatabase(directory?: string): Promise<Database> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('生产环境必须使用PostgreSQL，不允许嵌入式测试数据库');
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite(directory),
    orm = drizzle(client);
  const wrap = (driver: typeof orm): Database => ({
    query: async (q) => (await driver.execute(q)).rows as Row[],
    transaction: (fn) => driver.transaction((tx) => fn(wrap(tx as unknown as typeof orm))),
    close: () => client.close(),
  });
  await migrate(orm, { migrationsFolder: 'server/migrations' });
  return wrap(orm);
}
