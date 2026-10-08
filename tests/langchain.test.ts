import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { createOnlineModel, OPENROUTER_URL } from '../src/lib/ai/online';
import { runAgent, type AgentModel } from '../src/lib/ai/agent';
import { fixture } from './helpers';
import { readCredentials, saveCredentials, clearCredentials } from '../src/lib/ai/credentials.web';

const config = { provider: 'openrouter' as const, baseUrl: OPENROUTER_URL, model: 'example/tools', apiKey: 'test-only-key' };
const response = (message: object, finish_reason = 'stop') => new Response(JSON.stringify({ id: 'chat-test', object: 'chat.completion', created: 1, model: config.model, choices: [{ index: 0, finish_reason, message: { role: 'assistant', ...message } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { 'Content-Type': 'application/json' } });
const tool = (name: string, args: object, id = 'call-test') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('LangChain sends native function schemas to OpenRouter, receives read results with matching IDs, and proposes income', async () => {
  const f = await fixture(); let calls = 0;
  try {
    await f.write({ name: 'create_wallet', arguments: { name: 'Cash', opening_balance: '100' } });
    const model = createOnlineModel(config, async (url, options) => {
      calls++; assert.equal(String(url), `${OPENROUTER_URL}/chat/completions`); assert.equal(options?.redirect, 'error');
      assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-only-key');
      const body = JSON.parse(String(options?.body));
      assert.equal(body.model, config.model); assert.equal(body.parallel_tool_calls, false);
      assert.ok(body.tools.some((t: { function: { name: string } }) => t.function.name === 'create_income'));
      assert.doesNotMatch(String(options?.body), /test-only-key|model_path/);
      if (calls === 1) return response({ content: null, tool_calls: [tool('list_incomes', {}, 'income-query')] }, 'tool_calls');
      const result = body.messages.at(-1); assert.equal(result.role, 'tool'); assert.equal(result.tool_call_id, 'income-query'); assert.match(result.content, /"count":0/);
      return response({ content: 'Saved!', tool_calls: [tool('create_income', { wallet_id: 1, amount: '5000', source: 'Salary', description: 'October salary', date: '2026-10-08' })] }, 'tool_calls');
    });
    const result = await runAgent(f.repo, model, 'Received 5000 salary in Cash', []);
    assert.equal(calls, 2); assert.equal(result.proposal!.call.name, 'create_income'); assert.match(result.reply, /Nothing has been saved/);
    assert.equal((await f.repo.snapshot()).incomeCount, 0);
    await f.repo.apply(result.proposal!); assert.equal((await f.repo.snapshot()).wallets[0].balance_cents, 510000);
  } finally { f.close(); }
});

test('native provider errors never leak response bodies or retry paid calls', async () => {
  for (const [status, pattern] of [[401, /API key/], [402, /credits/], [429, /rate limit/], [400, /tool calling/], [503, /unavailable/]] as const) {
    let calls = 0;
    const model = createOnlineModel(config, async () => { calls++; return new Response('test-only-key', { status }); });
    await assert.rejects(model.invoke([new HumanMessage('Hello')]), e => {
      assert.match((e as Error).message, pattern); assert.doesNotMatch((e as Error).message, /test-only-key/); return true;
    });
    assert.equal(calls, 1);
  }
});

test('native malformed, truncated, unknown, multiple-write and invalid-id tool calls cannot mutate data', async () => {
  const f = await fixture();
  try {
    for (const r of [
      response({ content: null, tool_calls: [tool('exec_sql', {})] }, 'tool_calls'),
      response({ content: null, tool_calls: [tool('delete_income', { id: -1 })] }, 'tool_calls'),
      response({ content: null, tool_calls: [tool('create_wallet', { name: 'Cash', opening_balance: '0' }), tool('create_wallet', { name: 'Bank', opening_balance: '0' }, 'call-2')] }, 'tool_calls'),
      response({ content: null, tool_calls: [{ id: 'bad', type: 'function', function: { name: 'create_wallet', arguments: '{"name":' } }] }, 'tool_calls'),
      response({ content: 'Partial', tool_calls: [tool('create_wallet', { name: 'Cash', opening_balance: '0' })] }, 'length'),
    ]) await assert.rejects(runAgent(f.repo, createOnlineModel(config, async () => r), 'Create wallet', []), /invalid action|one change/);
    assert.equal((await f.repo.snapshot()).revision, 0);
  } finally { f.close(); }
});

test('native cancellation and a changed revision block proposals', async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    const model: AgentModel = { async invoke() { controller.abort(); return new AIMessage({ content: '', tool_calls: [{ id: 'new', name: 'create_wallet', args: { name: 'Cash', opening_balance: '0' } }] }); } };
    await assert.rejects(runAgent(f.repo, model, 'Create Cash', [], controller.signal), /Cancelled/);
    const changing: AgentModel = { async invoke() {
      await f.write({ name: 'create_wallet', arguments: { name: 'Bank', opening_balance: '0' } });
      return new AIMessage({ content: '', tool_calls: [{ id: 'new', name: 'create_wallet', args: { name: 'Cash', opening_balance: '0' } }] });
    } };
    await assert.rejects(runAgent(f.repo, changing, 'Create Cash', []), /data changed/);
    assert.equal((await f.repo.snapshot()).wallets.length, 1);
  } finally { f.close(); }
});

test('web key saving accepts no selected model and keeps model choice out of credential storage', async () => {
  await saveCredentials({ ...config, model: '' });
  assert.equal((await readCredentials())!.model, ''); assert.equal((await readCredentials())!.apiKey, 'test-only-key');
  await clearCredentials(); assert.equal(await readCredentials(), null);
});

test('LangChain request timeout and cancellation abort transport without proposing writes', async () => {
 const hanging = (_url: RequestInfo | URL, options?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
   options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
 });
 const model = createOnlineModel(config, hanging, 30);
 await assert.rejects(model.invoke([new HumanMessage('Hello')]), /took too long/);
 const controller = new AbortController();
 const cancelled = createOnlineModel(config, (_url, options) => { controller.abort(); assert.equal(options?.signal?.aborted, true); return Promise.reject(new DOMException('Aborted', 'AbortError')); });
 await assert.rejects(cancelled.invoke([new HumanMessage('Hello')], { signal: controller.signal }), /Cancelled/);
});
