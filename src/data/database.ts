import { drizzle } from 'drizzle-orm/expo-sqlite/driver';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as tables from './tables';
import type { SqlClient } from './schema';
export function createDatabase(client: SqlClient) {
  return drizzle(client as SQLiteDatabase, { schema: tables });
}
