import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOnlineModel, OPENROUTER_URL } from '../src/lib/ai/online';
import { ChatOpenAI } from '@langchain/openai';
import { fixture } from './helpers';
import { config, response, toolCall, turn, start, resume } from './ai-helpers';
import {
  readCredentials,
  saveCredentials,
  clearCredentials,
} from '../src/lib/ai/credentials.web';

test('ChatOpenAI and native LangChain tools send OpenRouter schemas and preserve read-call IDs before income review', async () => {
  const f = await fixture();
  let calls = 0;
  try {
    await f.write({
      name: 'create_wallet',
      arguments: { name: 'Cash', opening_balance: '100' },
    });
    assert.ok(createOnlineModel(config) instanceof ChatOpenAI);
    const session = await turn(f.repo, async (url, options) => {
      calls++;
      assert.equal(String(url), `${OPENROUTER_URL}/chat/completions`);
      assert.equal(options?.redirect, 'error');
      assert.equal(
        new Headers(options?.headers).get('authorization'),
        'Bearer test-only-key',
      );
      const body = JSON.parse(String(options?.body));
      assert.equal(body.model, config.model);
      assert.equal(body.parallel_tool_calls, false);
      assert.equal(body.tools.length, 22);
      assert.ok(
        body.tools.some(
          (t: { function: { name: string } }) =>
            t.function.name === 'create_income',
        ),
      );
      assert.doesNotMatch(String(options?.body), /test-only-key|model_path/);
      if (calls === 1)
        return response(
          {
            content: null,
            tool_calls: [toolCall('list_incomes', {}, 'income-query')],
          },
          'tool_calls',
        );
      const result = body.messages.at(-1);
      assert.equal(result.role, 'tool');
      assert.equal(result.tool_call_id, 'income-query');
      assert.match(result.content, /"count":0/);
      return response(
        {
          content: 'Saved!',
          tool_calls: [
            toolCall('create_income', {
              wallet_id: 1,
              amount: '5000',
              source: 'Salary',
              description: 'October salary',
              date: '2026-10-08',
            }),
          ],
        },
        'tool_calls',
      );
    });
    assert.equal((await start(session)).__interrupt__?.length, 1);
    assert.equal(calls, 2);
    assert.equal(session.getProposal()!.call.name, 'create_income');
    assert.equal((await f.repo.snapshot()).incomeCount, 0);
    await resume(session, 'approve');
    assert.equal((await f.repo.snapshot()).wallets[0].balance_cents, 510000);
    assert.equal(calls, 2);
  } finally {
    f.close();
  }
});

test('malformed, truncated, extra-field, unknown, mixed and multiple-write tool calls cannot mutate data', async () => {
  const f = await fixture();
  try {
    for (const makeResponse of [
      () =>
        response(
          { content: null, tool_calls: [toolCall('exec_sql', {})] },
          'tool_calls',
        ),
      () =>
        response(
          {
            content: null,
            tool_calls: [toolCall('delete_income', { id: -1 })],
          },
          'tool_calls',
        ),
      () =>
        response(
          {
            content: null,
            tool_calls: [
              toolCall('create_wallet', {
                name: 'Cash',
                opening_balance: '0',
                sql: 'oops',
              }),
            ],
          },
          'tool_calls',
        ),
      () =>
        response(
          {
            content: null,
            tool_calls: [
              toolCall('create_wallet', { name: 'Cash', opening_balance: '0' }),
              toolCall(
                'create_wallet',
                { name: 'Bank', opening_balance: '0' },
                'call-2',
              ),
            ],
          },
          'tool_calls',
        ),
      () =>
        response(
          {
            content: null,
            tool_calls: [
              toolCall('list_wallets', {}),
              toolCall(
                'create_wallet',
                { name: 'Bank', opening_balance: '0' },
                'call-2',
              ),
            ],
          },
          'tool_calls',
        ),
      () =>
        response(
          {
            content: null,
            tool_calls: [
              {
                id: 'bad',
                type: 'function',
                function: { name: 'create_wallet', arguments: '{"name":' },
              },
            ],
          },
          'tool_calls',
        ),
      () =>
        response(
          {
            content: 'Partial',
            tool_calls: [
              toolCall('create_wallet', { name: 'Cash', opening_balance: '0' }),
            ],
          },
          'length',
        ),
      () => response({ content: '' }),
    ])
      await assert.rejects(
        start(await turn(f.repo, async () => makeResponse())),
        /invalid action|one change/,
      );
    assert.equal((await f.repo.snapshot()).revision, 0);
  } finally {
    f.close();
  }
});

test('cancellation and edits made during inference cannot become a write proposal', async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    const session = await turn(f.repo, async () => {
      controller.abort();
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
    await assert.rejects(start(session, controller.signal), /Cancelled|Abort/i);
    const changing = await turn(f.repo, async () => {
      await f.write({
        name: 'create_wallet',
        arguments: { name: 'Bank', opening_balance: '0' },
      });
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
    await assert.rejects(start(changing), /data changed while I was thinking/);
    assert.deepEqual(
      (await f.repo.snapshot()).wallets.map((w) => w.name),
      ['Bank'],
    );
  } finally {
    f.close();
  }
});

test('web key saving accepts no selected model and keeps model choice out of credential storage', async () => {
  await saveCredentials({ ...config, model: '' });
  assert.equal((await readCredentials())!.model, '');
  assert.equal((await readCredentials())!.apiKey, 'test-only-key');
  await clearCredentials();
  assert.equal(await readCredentials(), null);
});
