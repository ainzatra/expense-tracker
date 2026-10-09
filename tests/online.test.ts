import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HumanMessage } from '@langchain/core/messages';
import {
  createOnlineModel,
  providerError,
  publicSettings,
  validateCredentials,
} from '../src/lib/ai/online';
import { fixture } from './helpers';
import { config, response, turn, start } from './ai-helpers';

async function invoke(
  fetcher: typeof fetch,
  timeout = 60000,
  signal?: AbortSignal,
) {
  try {
    return await createOnlineModel(config, fetcher, timeout).invoke(
      [new HumanMessage('Hello')],
      { signal },
    );
  } catch (error) {
    throw providerError(error, signal);
  }
}

test('public settings contain no key and compatible endpoints require clean HTTPS URLs', async () => {
  assert.deepEqual(Object.keys(publicSettings(config)).sort(), [
    'baseUrl',
    'model',
    'provider',
  ]);
  const model = createOnlineModel(
    { ...config, provider: 'compatible', baseUrl: 'https://example.com/v1/' },
    async (url, options) => {
      assert.equal(String(url), 'https://example.com/v1/chat/completions');
      assert.equal(
        new Headers(options?.headers).has('X-OpenRouter-Title'),
        false,
      );
      return response({ content: 'OK' });
    },
  );
  await model.invoke([new HumanMessage('Hello')]);
  for (const baseUrl of [
    'http://example.com/v1',
    'https://key@example.com/v1',
    'https://example.com/v1?key=secret',
    'https://example.com/v1#fragment',
  ]) {
    assert.throws(
      () => validateCredentials({ ...config, provider: 'compatible', baseUrl }),
      /HTTPS/,
    );
  }
  assert.throws(
    () => validateCredentials({ ...config, baseUrl: 'https://example.com/v1' }),
    /OpenRouter uses/,
  );
});

test('native agent provider errors are actionable, hide response bodies and never retry paid requests', async () => {
  const f = await fixture();
  try {
    for (const [status, pattern] of [
      [401, /API key/],
      [402, /credits/],
      [429, /rate limit/],
      [400, /tool calling/],
      [503, /unavailable/],
    ] as const) {
      let requests = 0;
      const session = await turn(f.repo, async () => {
        requests++;
        return new Response('test-only-key', { status });
      });
      await assert.rejects(start(session), (error) => {
        assert.match((error as Error).message, pattern);
        assert.doesNotMatch((error as Error).message, /test-only-key/);
        return true;
      });
      assert.equal(requests, 1);
    }
  } finally {
    f.close();
  }
});

test('malformed and oversized responses do not expose provider content', async () => {
  for (const raw of ['not JSON test-only-key', 'x'.repeat(65537)]) {
    await assert.rejects(
      invoke(async () => new Response(raw)),
      (error) => {
        assert.match((error as Error).message, /unreadable|too large/);
        assert.doesNotMatch((error as Error).message, /test-only-key/);
        return true;
      },
    );
  }
  await assert.rejects(
    invoke(async () => new Response('{"choices":[]}')),
    /valid tool response/,
  );
});

test('native request timeout and cancellation abort transport', async () => {
  const hanging = (
    _url: RequestInfo | URL,
    options?: RequestInit,
  ): Promise<Response> =>
    new Promise((_resolve, reject) => {
      options?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });
  await assert.rejects(invoke(hanging, 30), /took too long/);
  const controller = new AbortController();
  await assert.rejects(
    invoke(
      (_url, options) => {
        controller.abort();
        assert.equal(options?.signal?.aborted, true);
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      },
      60000,
      controller.signal,
    ),
    /Cancelled/,
  );
});

test('clearing a legacy model preference preserves wallets and revision', async () => {
  const f = await fixture();
  try {
    await f.write({
      name: 'create_wallet',
      arguments: { name: 'Cash', opening_balance: '2000' },
    });
    await f.repo.saveModel(
      'file:///private/documents/models/model-123.gguf',
      'old.gguf',
    );
    const before = await f.repo.snapshot();
    await f.repo.clearModel();
    const after = await f.repo.snapshot();
    assert.equal(after.modelPath, null);
    assert.equal(after.modelName, null);
    assert.deepEqual(after.wallets, before.wallets);
    assert.equal(after.revision, before.revision);
  } finally {
    f.close();
  }
});
