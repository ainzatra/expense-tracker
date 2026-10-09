import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers';
import { migrate } from '../src/data/schema';
import { occurrenceDate } from '../src/lib/recurrence';
import type { WriteCall } from '../src/data/tools';

const deposit = {
  kind: 'income' as const,
  wallet_id: 1,
  category_id: null,
  source: 'Salary',
  amount: '1000',
  description: 'Monthly salary',
  start_date: '2026-01-31',
  frequency: 'monthly' as const,
  end_date: null,
};

test('v1 migration retains wallet, expense, currency, revision and model preferences', async () => {
  const f = await fixture(undefined, true);
  try {
    await f.client.runAsync(
      'INSERT INTO wallets (name,opening_cents) VALUES (?,?)',
      'Cash',
      100000,
    );
    await f.client.runAsync(
      'INSERT INTO expenses (wallet_id,category_id,amount_cents,description,date) VALUES (?,?,?,?,?)',
      1,
      1,
      20029,
      'Lunch',
      '2026-10-08',
    );
    await f.client.runAsync(
      "UPDATE settings SET value='7' WHERE key='revision'",
    );
    await f.repo.saveModel('file:///old.gguf', 'old.gguf');
    await migrate(f.client);
    await migrate(f.client);
    const s = await f.repo.snapshot();
    assert.equal(s.revision, 7);
    assert.equal(s.currency, 'PHP');
    assert.equal(s.expenses[0].id, 1);
    assert.equal(s.wallets[0].balance_cents, 79971);
    assert.equal(s.modelName, 'old.gguf');
    assert.equal(s.incomeCount, 0);
    assert.equal(s.recurring.length, 0);
  } finally {
    f.close();
  }
});

test('income CRUD, pagination, and summaries keep balances exact without income/expense join fanout', async () => {
  const f = await fixture();
  try {
    await f.write({
      name: 'create_wallet',
      arguments: { name: 'Cash', opening_balance: '100' },
    });
    await f.write({
      name: 'create_wallet',
      arguments: { name: 'Bank', opening_balance: '0' },
    });
    const args = {
      wallet_id: 1,
      amount: '200.29',
      source: 'Salary',
      description: 'Pay',
      date: '2026-10-08',
    };
    for (let i = 0; i < 2; i++) {
      await f.write({ name: 'create_income', arguments: args });
      await f.write({
        name: 'create_expense',
        arguments: {
          wallet_id: 1,
          category_id: 1,
          amount: '10.01',
          description: 'Lunch',
          date: args.date,
        },
      });
    }
    let s = await f.repo.snapshot();
    assert.equal(s.wallets[0].income_cents, 40058);
    assert.equal(s.wallets[0].spent_cents, 2002);
    assert.equal(s.wallets[0].balance_cents, 48056);
    const page = (await f.repo.read({
      name: 'list_incomes',
      arguments: {
        wallet_id: 1,
        limit: 1,
        offset: 1,
        start: args.date,
        end: args.date,
      },
    })) as { incomes: unknown[]; count: number; total_cents: number };
    assert.equal(page.incomes.length, 1);
    assert.equal(page.count, 2);
    assert.equal(page.total_cents, 40058);
    const summary = (await f.repo.read({
      name: 'get_summary',
      arguments: { start: args.date, end: args.date },
    })) as { income_cents: number; net_cents: number; income_count: number };
    assert.equal(summary.income_cents, 40058);
    assert.equal(summary.net_cents, 38056);
    assert.equal(summary.income_count, 2);
    await f.write({
      name: 'update_income',
      arguments: {
        ...args,
        id: 1,
        wallet_id: 2,
        amount: '0.29',
        source: 'Allowance',
      },
    });
    s = await f.repo.snapshot();
    assert.equal(s.wallets[0].balance_cents, 28027);
    assert.equal(s.wallets[1].balance_cents, 29);
    await assert.rejects(
      f.write({ name: 'delete_wallet', arguments: { id: 2 } }),
      /has income/,
    );
    await f.write({ name: 'delete_income', arguments: { id: 1 } });
    assert.equal((await f.repo.snapshot()).wallets[1].balance_cents, 0);
    await assert.rejects(
      f.write({ name: 'create_income', arguments: { ...args, amount: '-5' } }),
    );
    await assert.rejects(
      f.write({ name: 'create_income', arguments: { ...args, wallet_id: 99 } }),
      /no longer exists/,
    );
  } finally {
    f.close();
  }
});

test('recurrence clamps month ends without drift and preserves leap-year anchors', () => {
  assert.deepEqual(
    [0, 1, 2, 12].map((i) => occurrenceDate('2026-01-31', i, 'monthly')),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2027-01-31'],
  );
  assert.deepEqual(
    [1, 4].map((i) => occurrenceDate('2024-02-29', i, 'yearly')),
    ['2025-02-28', '2028-02-29'],
  );
  assert.equal(occurrenceDate('2026-12-28', 1, 'weekly'), '2027-01-04');
  assert.equal(occurrenceDate('2026-12-31', 1, 'daily'), '2027-01-01');
});

test('due deposits wait for confirmation; duplicate/stale posts cannot double-credit', async () => {
  let today = '2026-01-30';
  const f = await fixture(() => today);
  try {
    await f.write({
      name: 'create_wallet',
      arguments: { name: 'Bank', opening_balance: '0' },
    });
    await f.write({ name: 'create_recurring', arguments: deposit });
    assert.equal((await f.repo.snapshot()).recurring[0].due, false);
    await assert.rejects(
      f.write({
        name: 'post_recurring',
        arguments: { id: 1, date: deposit.start_date },
      }),
      /due occurrence/,
    );
    today = '2026-03-31';
    let s = await f.repo.snapshot();
    assert.equal(s.recurring[0].due, true);
    assert.equal(s.incomeCount, 0);
    assert.equal(s.wallets[0].balance_cents, 0);
    const p = await f.repo.propose({
      name: 'post_recurring',
      arguments: { id: 1, date: deposit.start_date },
    });
    assert.equal((await f.repo.snapshot()).incomeCount, 0);
    await f.repo.apply(p);
    await assert.rejects(f.repo.apply(p), /data changed/);
    s = await f.repo.snapshot();
    assert.equal(s.wallets[0].balance_cents, 100000);
    assert.equal(s.recurring[0].next_date, '2026-02-28');
    await assert.rejects(
      f.write({
        name: 'post_recurring',
        arguments: { id: 1, date: deposit.start_date },
      }),
      /due occurrence/,
    );
    await f.write({
      name: 'skip_recurring',
      arguments: { id: 1, date: '2026-02-28' },
    });
    s = await f.repo.snapshot();
    assert.equal(s.wallets[0].balance_cents, 100000);
    assert.equal(s.recurring[0].next_date, '2026-03-31');
    await f.write({ name: 'delete_income', arguments: { id: 1 } });
    assert.equal(
      (await f.repo.snapshot()).recurring[0].next_date,
      '2026-03-31',
    );
    await assert.rejects(
      f.write({
        name: 'update_recurring',
        arguments: { ...deposit, id: 1, start_date: '2026-01-30' },
      }),
      /cannot change/,
    );
    await f.write({
      name: 'update_recurring',
      arguments: { ...deposit, id: 1, amount: '2000', end_date: '2026-03-31' },
    });
    await f.write({
      name: 'post_recurring',
      arguments: { id: 1, date: '2026-03-31' },
    });
    s = await f.repo.snapshot();
    assert.equal(s.wallets[0].balance_cents, 200000);
    assert.equal(s.recurring[0].next_date, null);
    assert.equal(s.recurring[0].due, false);
    await f.write({ name: 'delete_recurring', arguments: { id: 1 } });
    s = await f.repo.snapshot();
    assert.equal(s.incomeCount, 1);
    assert.equal(s.incomes[0].recurring_id, null);
    assert.equal(s.wallets[0].balance_cents, 200000);
  } finally {
    f.close();
  }
});

test('bills can pause/resume and only posted occurrences reduce balances; invalid schedules fail atomically', async () => {
  const f = await fixture(() => '2026-10-08');
  try {
    await f.write({
      name: 'create_wallet',
      arguments: { name: 'Bank', opening_balance: '1000' },
    });
    const bill = {
      ...deposit,
      kind: 'expense' as const,
      source: null,
      category_id: 4,
      amount: '100',
      description: 'Internet',
      start_date: '2026-10-08',
    };
    for (const arguments_ of [
      { ...bill, category_id: null },
      { ...bill, source: 'Salary' },
      { ...bill, end_date: '2026-10-07' },
    ]) {
      await assert.rejects(
        f.write({
          name: 'create_recurring',
          arguments: arguments_,
        } as WriteCall),
      );
    }
    await f.write({ name: 'create_recurring', arguments: bill });
    await assert.rejects(
      f.write({ name: 'delete_wallet', arguments: { id: 1 } }),
      /recurring schedules/,
    );
    await f.write({
      name: 'set_recurring_enabled',
      arguments: { id: 1, enabled: false },
    });
    await assert.rejects(
      f.write({
        name: 'post_recurring',
        arguments: { id: 1, date: bill.start_date },
      }),
      /due occurrence/,
    );
    await f.write({
      name: 'set_recurring_enabled',
      arguments: { id: 1, enabled: true },
    });
    await f.write({
      name: 'post_recurring',
      arguments: { id: 1, date: bill.start_date },
    });
    let s = await f.repo.snapshot();
    assert.equal(s.expenseCount, 1);
    assert.equal(s.expenses[0].category_name, 'Bills');
    assert.equal(s.wallets[0].balance_cents, 90000);
    await f.write({ name: 'delete_recurring', arguments: { id: 1 } });
    s = await f.repo.snapshot();
    assert.equal(s.expenseCount, 1);
    assert.equal(s.wallets[0].balance_cents, 90000);
  } finally {
    f.close();
  }
});

test('model preferences persist separately and explicitly exclude an API key from SQLite', async () => {
  const f = await fixture();
  try {
    await f.repo.saveAiSettings({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'example/model',
      apiKey: 'secret-test-key',
    } as Parameters<typeof f.repo.saveAiSettings>[0]);
    const row = await f.client.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key='online_ai'",
    );
    assert.doesNotMatch(row!.value, /secret|apiKey/);
    assert.equal((await f.repo.getAiSettings())!.model, 'example/model');
    assert.equal((await f.repo.snapshot()).revision, 0);
  } finally {
    f.close();
  }
});
