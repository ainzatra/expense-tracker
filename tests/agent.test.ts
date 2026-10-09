import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers';
import { replyText } from '../src/lib/ai/agent';
import { response, toolCall, turn, start, resume } from './ai-helpers';

test('native LangChain review pauses expense writes, resumes once, and returns the actual saved result without another paid call', async () => {
  const f = await fixture();
  let calls = 0;
  try {
    await f.write({
      name: 'create_wallet',
      arguments: { name: 'Cash', opening_balance: '2000' },
    });
    const session = await turn(f.repo, async () => {
      calls++;
      return response(
        {
          content: 'I saved it!',
          tool_calls: [
            toolCall('create_expense', {
              wallet_id: 1,
              category_id: 1,
              amount: '250',
              description: 'Lunch',
              date: '2026-10-08',
            }),
          ],
        },
        'tool_calls',
      );
    });
    const paused = await start(session);
    assert.equal(paused.__interrupt__?.length, 1);
    assert.equal(session.getProposal()!.call.name, 'create_expense');
    assert.equal((await f.repo.snapshot()).expenseCount, 0);
    const result = await resume(session, 'approve');
    assert.match(replyText(result.messages), /Lunch.*Saved on this device/);
    assert.equal((await f.repo.snapshot()).expenses[0].amount_cents, 25000);
    assert.equal(calls, 1);
    await assert.rejects(
      async () => resume(session, 'approve'),
      /already reviewed/,
    );
    assert.equal((await f.repo.snapshot()).expenseCount, 1);
  } finally {
    f.close();
  }
});

test('rejecting the native interrupt cannot write and uses no additional provider call', async () => {
  const f = await fixture();
  let calls = 0;
  try {
    const session = await turn(f.repo, async () => {
      calls++;
      return response(
        {
          content: '',
          tool_calls: [
            toolCall('create_wallet', { name: 'Cash', opening_balance: '0' }),
          ],
        },
        'tool_calls',
      );
    });
    await start(session);
    assert.match(
      replyText((await resume(session, 'reject')).messages),
      /cancelled/,
    );
    assert.equal((await f.repo.snapshot()).wallets.length, 0);
    assert.equal(calls, 1);
  } finally {
    f.close();
  }
});

test('stale native approval fails without re-proposing, retrying, or applying the write', async () => {
  const f = await fixture();
  let calls = 0;
  try {
    const session = await turn(f.repo, async () => {
      calls++;
      return response(
        {
          content: '',
          tool_calls: [
            toolCall('create_wallet', { name: 'Cash', opening_balance: '0' }),
          ],
        },
        'tool_calls',
      );
    });
    await start(session);
    await f.write({
      name: 'create_wallet',
      arguments: { name: 'Bank', opening_balance: '100' },
    });
    await assert.rejects(
      resume(session, 'approve'),
      /data changed since this proposal/,
    );
    assert.equal(calls, 1);
    assert.deepEqual(
      (await f.repo.snapshot()).wallets.map((w) => w.name),
      ['Bank'],
    );
  } finally {
    f.close();
  }
});

test('LangChain read tools return results to the model and model-call middleware bounds loops', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const session = await turn(f.repo, async (_url, options) => {
      if (++calls === 1)
        return response(
          {
            content: '',
            tool_calls: [
              toolCall('get_summary', {
                start: '2026-10-01',
                end: '2026-10-08',
              }),
            ],
          },
          'tool_calls',
        );
      assert.match(
        JSON.parse(String(options?.body)).messages.at(-1).content,
        /"total_cents":0/,
      );
      return response({ content: 'You have no expenses in this period.' });
    });
    assert.match(replyText((await start(session)).messages), /no expenses/);
    assert.equal(calls, 2);
    calls = 0;
    const loop = await turn(f.repo, async () => {
      calls++;
      return response(
        {
          content: '',
          tool_calls: [toolCall('list_wallets', {}, `read-${calls}`)],
        },
        'tool_calls',
      );
    });
    await assert.rejects(start(loop), /limit/i);
    assert.equal(calls, 6);
  } finally {
    f.close();
  }
});

test('unapproved session state disappears when a fresh native agent is created', async () => {
  const f = await fixture();
  try {
    const first = await turn(f.repo, async () =>
      response(
        {
          content: '',
          tool_calls: [
            toolCall('create_wallet', { name: 'Cash', opening_balance: '0' }),
          ],
        },
        'tool_calls',
      ),
    );
    await start(first);
    const fresh = await turn(f.repo, async (_url, options) => {
      assert.equal(
        JSON.parse(String(options?.body)).messages.filter(
          (m: { role: string }) => m.role === 'assistant',
        ).length,
        0,
      );
      return response({ content: 'How can I help?' });
    });
    assert.equal(fresh.getProposal(), null);
    assert.throws(() => fresh.decide('approve'), /already reviewed/);
    assert.equal((await start(fresh)).__interrupt__, undefined);
    assert.equal((await f.repo.snapshot()).revision, 0);
  } finally {
    f.close();
  }
});
