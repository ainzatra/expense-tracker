import { desc, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const id = () => integer('id').primaryKey({ autoIncrement: true });
const createdAt = () =>
  text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
export const wallets = sqliteTable(
  'wallets',
  {
    id: id(),
    name: text('name').notNull(),
    opening_cents: integer('opening_cents').notNull(),
  },
  (t) => [
    uniqueIndex('wallets_name_unique').on(sql`${t.name} COLLATE NOCASE`),
    check(
      'wallets_opening_check',
      sql`${t.opening_cents} >= 0 AND ${t.opening_cents} <= 1000000000000`,
    ),
  ],
);
export const categories = sqliteTable(
  'categories',
  { id: id(), name: text('name').notNull() },
  (t) => [
    uniqueIndex('categories_name_unique').on(sql`${t.name} COLLATE NOCASE`),
  ],
);
export const recurring = sqliteTable(
  'recurring',
  {
    id: id(),
    kind: text('kind', { enum: ['income', 'expense'] }).notNull(),
    wallet_id: integer('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'restrict' }),
    category_id: integer('category_id').references(() => categories.id, {
      onDelete: 'restrict',
    }),
    source: text('source'),
    amount_cents: integer('amount_cents').notNull(),
    description: text('description').notNull(),
    start_date: text('start_date').notNull(),
    frequency: text('frequency', {
      enum: ['daily', 'weekly', 'monthly', 'yearly'],
    }).notNull(),
    end_date: text('end_date'),
    next_index: integer('next_index').notNull().default(0),
    enabled: integer('enabled').notNull().default(1),
  },
  (t) => [
    check('recurring_kind_check', sql`${t.kind} IN ('income','expense')`),
    check(
      'recurring_amount_check',
      sql`${t.amount_cents} > 0 AND ${t.amount_cents} <= 1000000000000`,
    ),
    check(
      'recurring_frequency_check',
      sql`${t.frequency} IN ('daily','weekly','monthly','yearly')`,
    ),
    check('recurring_index_check', sql`${t.next_index} >= 0`),
    check('recurring_enabled_check', sql`${t.enabled} IN (0,1)`),
    check(
      'recurring_source_check',
      sql`(${t.kind}='income' AND ${t.source} IS NOT NULL AND ${t.category_id} IS NULL) OR (${t.kind}='expense' AND ${t.category_id} IS NOT NULL AND ${t.source} IS NULL)`,
    ),
  ],
);
export const expenses = sqliteTable(
  'expenses',
  {
    id: id(),
    wallet_id: integer('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'restrict' }),
    category_id: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    amount_cents: integer('amount_cents').notNull(),
    description: text('description').notNull(),
    date: text('date').notNull(),
    created_at: createdAt(),
    recurring_id: integer('recurring_id').references(() => recurring.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('expenses_date_idx').on(desc(t.date), desc(t.id)),
    index('expenses_wallet_idx').on(t.wallet_id),
    check(
      'expenses_amount_check',
      sql`${t.amount_cents} > 0 AND ${t.amount_cents} <= 1000000000000`,
    ),
  ],
);
export const incomes = sqliteTable(
  'incomes',
  {
    id: id(),
    wallet_id: integer('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'restrict' }),
    amount_cents: integer('amount_cents').notNull(),
    source: text('source').notNull(),
    description: text('description').notNull(),
    date: text('date').notNull(),
    recurring_id: integer('recurring_id').references(() => recurring.id, {
      onDelete: 'set null',
    }),
    created_at: createdAt(),
  },
  (t) => [
    index('incomes_date_idx').on(desc(t.date), desc(t.id)),
    index('incomes_wallet_idx').on(t.wallet_id),
    check(
      'incomes_amount_check',
      sql`${t.amount_cents} > 0 AND ${t.amount_cents} <= 1000000000000`,
    ),
  ],
);
export const recurringOccurrences = sqliteTable(
  'recurring_occurrences',
  {
    recurring_id: integer('recurring_id')
      .notNull()
      .references(() => recurring.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    status: text('status', { enum: ['posted', 'skipped'] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.recurring_id, t.date] }),
    check(
      'recurring_occurrences_status_check',
      sql`${t.status} IN ('posted','skipped')`,
    ),
  ],
);
