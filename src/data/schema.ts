import type { SQLiteDatabase } from 'expo-sqlite';
import { sql } from 'drizzle-orm';
import { migrate as migrateDrizzle } from 'drizzle-orm/expo-sqlite/migrator';
import { createDatabase } from './database';
import migrations from './migrations';
import { SCHEMA_V2 } from './legacy-schema';
import * as tables from './tables';
export { SCHEMA } from './legacy-schema';

export interface SqlClient extends Pick<SQLiteDatabase, 'prepareSync'> {
  execAsync(sql: string): Promise<void>;
  runAsync(
    sql: string,
    ...params: (string | number | null)[]
  ): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync<T>(
    sql: string,
    ...params: (string | number | null)[]
  ): Promise<T | null>;
  getAllAsync<T>(
    sql: string,
    ...params: (string | number | null)[]
  ): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export async function migrate(client: SqlClient) {
  await client.execAsync('PRAGMA foreign_keys = ON;');
  const version =
    (
      await client.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version',
      )
    )?.user_version ?? 0;
  if (version > 3)
    throw new Error('This database requires a newer app version.');
  const db = createDatabase(client);
  if (version === 1)
    await client.withTransactionAsync(() => client.execAsync(SCHEMA_V2));
  if (version === 1 || version === 2) {
    // Adopt the existing v2 schema once. Never replay CREATE TABLE over user data.
    await client.withTransactionAsync(async () => {
      for (const table of Object.values(tables))
        db.select().from(table).limit(0).all();
      db.run(
        sql`CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
      );
      const latest = db.get<{ created_at: number }>(
        sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
      );
      if (!latest) {
        db.run(
          sql`CREATE UNIQUE INDEX IF NOT EXISTS wallets_name_unique ON wallets(name COLLATE NOCASE)`,
        );
        db.run(
          sql`CREATE UNIQUE INDEX IF NOT EXISTS categories_name_unique ON categories(name COLLATE NOCASE)`,
        );
        db.run(
          sql`INSERT INTO __drizzle_migrations(hash,created_at) VALUES('',${migrations.journal.entries[0].when})`,
        );
      }
    });
  }
  const hasJournal = db.get(
    sql`SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
  );
  if (hasJournal) {
    const latest = db.get<{ created_at: number }>(
      sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
    );
    if (
      latest &&
      latest.created_at >
        Math.max(...migrations.journal.entries.map((e) => e.when))
    )
      throw new Error('This database requires a newer app version.');
  }
  await migrateDrizzle(db, migrations);
  db.transaction((tx) => {
    tx.insert(tables.settings)
      .values([
        { key: 'currency', value: 'PHP' },
        { key: 'revision', value: '0' },
      ])
      .onConflictDoNothing()
      .run();
    tx.insert(tables.categories)
      .values(
        [
          'Food & drink',
          'Transport',
          'Shopping',
          'Bills',
          'Health',
          'Other',
        ].map((name) => ({ name })),
      )
      .onConflictDoNothing()
      .run();
  });
  await client.execAsync('PRAGMA user_version = 3;');
}
