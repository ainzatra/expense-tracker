import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers';
import { runAgent } from '../src/lib/ai/agent';

test('agent expense tool produces a reviewable proposal and only confirmation persists it', async () => {
  const f = await fixture(); try {
    await f.write({ name: 'create_wallet', arguments: { name: 'Cash', opening_balance: '2000' } });
    const result = await runAgent(f.repo, async () => JSON.stringify({ reply: 'I saved it!', tool: { name: 'create_expense', arguments: { wallet_id: 1, category_id: 1, amount: '250', description: 'Lunch', date: '2026-10-08' } } }), 'Spent 250 on lunch from Cash', []);
    assert.ok(result.proposal); assert.match(result.reply, /Nothing has been saved/); assert.equal((await f.repo.snapshot()).expenseCount, 0);
    await f.repo.apply(result.proposal); assert.equal((await f.repo.snapshot()).expenses[0].amount_cents, 25000);
  } finally { f.close(); }
});

test('agent executes read tools then feeds results back to inference', async () => {
  const f = await fixture(); try {
    let calls = 0;
    const result = await runAgent(f.repo, async messages => {
      if (++calls === 1) return JSON.stringify({ reply: '', tool: { name: 'get_summary', arguments: { start: '2026-10-01', end: '2026-10-08' } } });
      assert.match(messages.at(-1)!.content, /"total_cents":0/);
      return JSON.stringify({ reply: 'You have no expenses in this period.', tool: null });
    }, 'What did I spend this month?', []);
    assert.equal(calls, 2); assert.equal(result.proposal, undefined); assert.match(result.reply, /no expenses/);
  } finally { f.close(); }
});

test('malformed, unknown, extra-field, and invalid model actions cannot mutate storage', async () => {
  const f = await fixture(); try {
    for (const output of ['not JSON', '{"reply":"ok","tool":{"name":"exec_sql","arguments":{"sql":"DELETE FROM expenses"}}}', '{"reply":"ok","extra":true,"tool":null}', '{"reply":"ok","tool":{"name":"delete_expense","arguments":{"id":-1}}}']) {
      await assert.rejects(runAgent(f.repo, async () => output, 'Do something', []), /invalid action/);
    }
    assert.equal((await f.repo.snapshot()).revision, 0);
  } finally { f.close(); }
});

test('abort during inference prevents a returned action from becoming a proposal', async () => {
  const f = await fixture(); try {
    const controller = new AbortController();
    await assert.rejects(runAgent(f.repo, async () => {
      controller.abort(); return JSON.stringify({ reply: '', tool: { name: 'create_wallet', arguments: { name: 'Cash', opening_balance: '0' } } });
    }, 'Create wallet', [], controller.signal), /Cancelled/);
    assert.equal((await f.repo.snapshot()).wallets.length, 0);
  } finally { f.close(); }
});

test('agent limits repeated read calls instead of looping indefinitely', async () => {
  const f = await fixture(); try {
    let calls = 0;
    const result = await runAgent(f.repo, async () => { calls++; return JSON.stringify({ reply: '', tool: { name: 'list_wallets', arguments: {} } }); }, 'List wallets', []);
    assert.equal(calls, 6); assert.match(result.reply, /narrow/);
  } finally { f.close(); }
});

test('agent cannot propose overwriting edits made while inference was running', async () => {
  const f = await fixture(); try {
    await f.write({ name: 'create_wallet', arguments: { name: 'Cash', opening_balance: '1000' } });
    await assert.rejects(runAgent(f.repo, async () => {
      await f.write({ name: 'update_wallet', arguments: { id: 1, name: 'Cash', opening_balance: '2000' } });
      return JSON.stringify({ reply: '', tool: { name: 'update_wallet', arguments: { id: 1, name: 'Renamed cash', opening_balance: '1000' } } });
    }, 'Rename Cash', []), /data changed while I was thinking/);
    const s = await f.repo.snapshot(); assert.equal(s.wallets[0].opening_cents, 200000); assert.equal(s.wallets[0].name, 'Cash');
  } finally { f.close(); }
});
