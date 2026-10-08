import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA, type SqlClient } from '../src/data/schema';
import { Repository } from '../src/data/repository';
import type { WriteCall } from '../src/data/tools';

export async function fixture(today?: () => string, legacy = false) {
  const sql = new DatabaseSync(':memory:');
  const client: SqlClient = {
    async execAsync(query) { sql.exec(query); },
    async runAsync(query, ...params) { const r = sql.prepare(query).run(...params); return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) }; },
    async getFirstAsync<T>(query: string, ...params: (string | number | null)[]) { return (sql.prepare(query).get(...params) as T | undefined) ?? null; },
    async getAllAsync<T>(query: string, ...params: (string | number | null)[]) { return sql.prepare(query).all(...params) as T[]; },
    async withTransactionAsync(task) { sql.exec('BEGIN'); try { await task(); sql.exec('COMMIT'); } catch (e) { sql.exec('ROLLBACK'); throw e; } },
  };
  if (legacy) await client.execAsync(SCHEMA); else await migrate(client);
  const repo = new Repository(client, today);
  const write = async (call: WriteCall) => repo.apply(await repo.propose(call));
  return { repo, write, client, close: () => sql.close() };
}
