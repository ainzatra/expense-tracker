// Compatibility bridge for databases created by Pocket Ledger 1.0–1.2.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings VALUES ('currency', 'PHP'), ('revision', '0');
CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  opening_cents INTEGER NOT NULL CHECK(opening_cents >= 0 AND opening_cents <= 1000000000000)
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE
);
INSERT OR IGNORE INTO categories (name) VALUES
  ('Food & drink'), ('Transport'), ('Shopping'), ('Bills'), ('Health'), ('Other');
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 1000000000000),
  description TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(date DESC, id DESC);
CREATE INDEX IF NOT EXISTS expenses_wallet_idx ON expenses(wallet_id);
PRAGMA user_version = 1;
`;

export const SCHEMA_V2 = `
CREATE TABLE recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  category_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  source TEXT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 1000000000000),
  description TEXT NOT NULL,
  start_date TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekly','monthly','yearly')),
  end_date TEXT,
  next_index INTEGER NOT NULL DEFAULT 0 CHECK(next_index >= 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  CHECK((kind='income' AND source IS NOT NULL AND category_id IS NULL) OR
        (kind='expense' AND category_id IS NOT NULL AND source IS NULL))
);
CREATE TABLE incomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 1000000000000),
  source TEXT NOT NULL,
  description TEXT NOT NULL,
  date TEXT NOT NULL,
  recurring_id INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
ALTER TABLE expenses ADD COLUMN recurring_id INTEGER REFERENCES recurring(id) ON DELETE SET NULL;
CREATE TABLE recurring_occurrences (
  recurring_id INTEGER NOT NULL REFERENCES recurring(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('posted','skipped')),
  PRIMARY KEY (recurring_id,date)
);
CREATE INDEX incomes_date_idx ON incomes(date DESC,id DESC);
CREATE INDEX incomes_wallet_idx ON incomes(wallet_id);
PRAGMA user_version = 2;
`;
