import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers';
import { SCHEMA_V2 } from '../src/data/legacy-schema';
import { migrate } from '../src/data/schema';
import migrations from '../src/data/migrations';

test('Drizzle adoption preserves v2 income, expenses, recurring occurrence links, settings, ids and balances', async () => {
  const f = await fixture(() => '2026-10-09', true);
  try {
    await f.client.execAsync(SCHEMA_V2);
    await f.client.execAsync(`
      UPDATE settings SET value='USD' WHERE key='currency';
      INSERT INTO settings VALUES('online_ai','{"provider":"openrouter","baseUrl":"https://openrouter.ai/api/v1","model":"example/tools"}');
      INSERT INTO wallets(id,name,opening_cents) VALUES(7,'Cash',10000);
      INSERT INTO recurring(id,kind,wallet_id,source,amount_cents,description,start_date,frequency,next_index)
        VALUES(9,'income',7,'Salary',50000,'Salary','2026-10-01','monthly',1);
      INSERT INTO incomes(id,wallet_id,amount_cents,source,description,date,recurring_id) VALUES(11,7,50000,'Salary','Salary','2026-10-01',9);
      INSERT INTO expenses(id,wallet_id,category_id,amount_cents,description,date) VALUES(13,7,1,2500,'Lunch','2026-10-08');
      INSERT INTO recurring_occurrences VALUES(9,'2026-10-01','posted');
      UPDATE settings SET value='42' WHERE key='revision';
    `);
    const before = await f.repo.snapshot();
    await migrate(f.client);
    await migrate(f.client);
    assert.deepEqual(await f.repo.snapshot(), before);
    assert.equal(before.wallets[0].balance_cents, 57500);
    assert.equal(before.recurring[0].next_date, '2026-11-01');
    assert.equal((await f.repo.getAiSettings())!.model, 'example/tools');
    assert.deepEqual(
      (await f.client.getAllAsync('SELECT * FROM recurring_occurrences')).map(
        (row) => ({ ...(row as object) }),
      ),
      [{ recurring_id: 9, date: '2026-10-01', status: 'posted' }],
    );
    const journal = await f.client.getAllAsync<{ created_at: number }>(
      'SELECT created_at FROM __drizzle_migrations',
    );
    assert.deepEqual(
      journal.map((row) => ({ ...row })),
      [{ created_at: migrations.journal.entries[0].when }],
    );
    await f.write({
      name: 'create_wallet',
      arguments: { name: 'Bank', opening_balance: '1' },
    });
    assert.equal((await f.repo.snapshot()).wallets[1].id, 8);
    await assert.rejects(
      f.write({
        name: 'create_wallet',
        arguments: { name: 'cash', opening_balance: '0' },
      }),
      /already exists/,
    );
  } finally {
    f.close();
  }
});

test('incomplete legacy adoption fails atomically and can retry after schema repair', async () => {
  const f = await fixture(undefined, true);
  try {
    await f.client.execAsync(SCHEMA_V2);
    await f.client.execAsync('DROP TABLE incomes');
    await assert.rejects(migrate(f.client), /incomes/);
    assert.equal(
      await f.client.getFirstAsync(
        "SELECT name FROM sqlite_master WHERE name='__drizzle_migrations'",
      ),
      null,
    );
    assert.equal(
      (await f.client.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version',
      ))!.user_version,
      2,
    );
    // A correct table repair makes the one-time adoption repeatable.
    const incomeDDL = migrations.migrations.m0000
      .split('--> statement-breakpoint')
      .find((sql) => sql.includes('CREATE TABLE `incomes`'))!;
    await f.client.execAsync(incomeDDL);
    await migrate(f.client);
    assert.equal((await f.repo.snapshot()).categories.length, 6);
  } finally {
    f.close();
  }
});

test('newer Drizzle journal prevents an older app from opening or changing data', async () => {
  const f = await fixture();
  try {
    await f.write({
      name: 'create_wallet',
      arguments: { name: 'Cash', opening_balance: '100' },
    });
    await f.client.runAsync(
      'INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)',
      '',
      migrations.journal.entries[0].when + 1,
    );
    await assert.rejects(migrate(f.client), /newer app/);
    assert.equal((await f.repo.snapshot()).wallets[0].balance_cents, 10000);
  } finally {
    f.close();
  }
});
