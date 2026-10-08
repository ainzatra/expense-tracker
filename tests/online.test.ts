import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOnlineInference, OPENROUTER_URL, publicSettings, validateCredentials, type OnlineCredentials } from '../src/lib/ai/online';
import { runAgent } from '../src/lib/ai/agent';
import { fixture } from './helpers';

const config: OnlineCredentials = { provider: 'openrouter', baseUrl: OPENROUTER_URL, model: 'test/chat-model', apiKey: 'test-only-key' };
const messages = [{ role: 'user' as const, content: 'Hello' }];
const answer = (content: string, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content } }] }), { status: 200 });

test('online inference sends authenticated JSON chat requests without a downloaded model', async () => {
  let requests = 0;
  const infer = createOnlineInference(config, async (url, options) => {
    requests++;
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options?.method, 'POST'); assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-only-key');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, config.model); assert.deepEqual(body.messages, messages);
    assert.deepEqual(body.response_format, { type: 'json_object' }); assert.equal(body.stream, false);
    return answer('{"reply":"Hello","tool":null}');
  });
  assert.equal(await infer(messages), '{"reply":"Hello","tool":null}');
  assert.equal(requests, 1);
  assert.equal('apiKey' in publicSettings(config), false);
});

test('custom providers use their configured HTTPS endpoint and never inherit OpenRouter routing', async () => {
  const infer = createOnlineInference({ ...config, provider: 'compatible', baseUrl: 'https://example.com/v1/' }, async (url, options) => {
    assert.equal(url, 'https://example.com/v1/chat/completions');
    assert.equal(new Headers(options?.headers).has('X-OpenRouter-Title'), false);
    return answer('{"reply":"OK","tool":null}');
  });
  await infer(messages);
  for (const baseUrl of ['http://example.com/v1', 'https://key@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1#fragment']) {
    assert.throws(() => validateCredentials({ ...config, provider: 'compatible', baseUrl }), /HTTPS/);
  }
  assert.throws(() => validateCredentials({ ...config, baseUrl: 'https://example.com/v1' }), /OpenRouter uses/);
});

test('provider errors are actionable without exposing response bodies or retrying paid requests', async () => {
  for (const [status, pattern] of [[401, /API key/], [402, /credits/], [429, /rate limit/], [400, /JSON responses/], [503, /unavailable/]] as const) {
    let requests = 0;
    const infer = createOnlineInference(config, async () => {
      requests++; return new Response(JSON.stringify({ error: { message: 'test-only-key' } }), { status });
    });
    await assert.rejects(infer(messages), error => {
      assert.match((error as Error).message, pattern); assert.doesNotMatch((error as Error).message, /test-only-key/); return true;
    });
    assert.equal(requests, 1);
  }
});

test('empty, malformed, and truncated online responses fail without becoming actions', async () => {
  for (const response of [new Response('not JSON'), new Response('{"choices":[]}'), answer('{"reply":', 'length')]) {
    await assert.rejects(createOnlineInference(config, async () => response)(messages), /unreadable|no answer|cut short/);
  }
});

test('cancellation aborts the provider request and prevents an expense proposal', async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    const infer = createOnlineInference(config, async (_url, options) => {
      controller.abort(); assert.equal(options?.signal?.aborted, true);
      return answer('{"reply":"","tool":{"name":"create_wallet","arguments":{"name":"Cash","opening_balance":"1000"}}}');
    });
    await assert.rejects(runAgent(f.repo, infer, 'Create Cash', [], controller.signal), /Cancelled/);
    assert.equal((await f.repo.snapshot()).wallets.length, 0);
  } finally { f.close(); }
});

test('online request timeout aborts fetch and reports a timeout', async () => {
  const infer = createOnlineInference(config, (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }), 20);
  await assert.rejects(infer(messages), /took too long/);
});

test('online assistant proposals still require local confirmation and invalid tools cannot mutate SQLite', async () => {
  const f = await fixture();
  try {
    await f.write({ name: 'create_wallet', arguments: { name: 'Cash', opening_balance: '2000' } });
    const infer = createOnlineInference(config, async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      assert.match(request.messages[0].content, /Cash/);
      assert.doesNotMatch(String(options?.body), /model_path|test-only-key/);
      return answer('{"reply":"Saved!","tool":{"name":"create_expense","arguments":{"wallet_id":1,"category_id":1,"amount":"250","description":"Lunch","date":"2026-10-08"}}}');
    });
    const result = await runAgent(f.repo, infer, 'Spent 250 on lunch from Cash', []);
    assert.ok(result.proposal); assert.equal((await f.repo.snapshot()).expenseCount, 0);
    await f.repo.apply(result.proposal); assert.equal((await f.repo.snapshot()).expenses[0].amount_cents, 25000);
    await assert.rejects(runAgent(f.repo, createOnlineInference(config, async () => answer('{"reply":"","tool":{"name":"exec_sql","arguments":{}}}')), 'Delete all', []), /invalid action/);
    assert.equal((await f.repo.snapshot()).expenseCount, 1);
  } finally { f.close(); }
});

test('clearing a legacy model preference preserves expenses, wallets, and revision', async () => {
  const f = await fixture();
  try {
    await f.write({ name: 'create_wallet', arguments: { name: 'Cash', opening_balance: '2000' } });
    await f.repo.saveModel('file:///private/documents/models/model-123.gguf', 'old.gguf');
    const before = await f.repo.snapshot();
    await f.repo.clearModel();
    const after = await f.repo.snapshot();
    assert.equal(after.modelPath, null); assert.equal(after.modelName, null);
    assert.deepEqual(after.wallets, before.wallets); assert.equal(after.revision, before.revision);
  } finally { f.close(); }
});
