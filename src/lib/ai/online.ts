import { z } from 'zod';
import type { Inference } from './agent';
import { ChatOpenAI } from '@langchain/openai';
import { ensureCrypto } from './crypto';
import { TOOL_DEFINITIONS } from './agent';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
export type OnlineSettings = { provider: 'openrouter' | 'compatible'; baseUrl: string; model: string };
export type OnlineCredentials = OnlineSettings & { apiKey: string };
export type OnlineAuth = Omit<OnlineCredentials, 'model'>;
export const DEFAULT_ONLINE_SETTINGS: OnlineSettings = { provider: 'openrouter', baseUrl: OPENROUTER_URL, model: '' };

const authSchema = z.object({
  provider: z.enum(['openrouter', 'compatible']),
  baseUrl: z.string().trim().max(500),
  apiKey: z.string().trim().min(1, 'Enter your provider API key.').max(1024).regex(/^\S+$/, 'The API key cannot contain spaces.'),
});

export function validateAuth(input: OnlineAuth): OnlineAuth {
  const parsed = authSchema.parse(input);
  let url: URL;
  try { url = new URL(parsed.baseUrl); } catch { throw new Error('Enter a valid HTTPS API base URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTPS base URL without credentials, a query, or a fragment.');
  }
  const baseUrl = url.toString().replace(/\/+$/, '');
  if (parsed.provider === 'openrouter' && baseUrl !== OPENROUTER_URL) throw new Error('OpenRouter uses https://openrouter.ai/api/v1.');
  return { ...parsed, baseUrl };
}
export function validateCredentials(input: OnlineCredentials): OnlineCredentials {
  return { ...validateAuth(input), model: z.string().trim().min(1, 'Enter a model ID from your provider.').max(150).parse(input.model) };
}

export function publicSettings({ provider, baseUrl, model }: OnlineCredentials): OnlineSettings {
  return { provider, baseUrl, model };
}

function responseError(status: number) {
  if (status === 401) return 'The provider rejected your API key. Update it in Settings.';
  if (status === 402) return 'Your provider account needs credits. Check its balance or choose an available free model.';
  if (status === 403) return 'The provider denied access to this model. Check your account and model permissions.';
  if (status === 404) return 'The model or API endpoint was not found. Check Settings.';
  if (status === 429) return 'The provider rate limit was reached. Wait before trying again.';
  if (status === 400 || status === 422) return 'The provider rejected this request. Choose a chat model that supports tool calling.';
  return `The provider is unavailable (HTTP ${status}). Try again later.`;
}

export class ProviderRequestError extends Error {}

export function createOnlineModel(input: OnlineCredentials, fetcher: typeof fetch = fetch, timeoutMs = 60000) {
  ensureCrypto();
  const config = validateCredentials(input);
  const client = new ChatOpenAI({ model: config.model, apiKey: config.apiKey, temperature: 0.1, maxTokens: 1600,
    maxRetries: 0, timeout: timeoutMs, useResponsesApi: false,
    configuration: { baseURL: config.baseUrl, dangerouslyAllowBrowser: true,
      defaultHeaders: config.provider === 'openrouter' ? { 'X-OpenRouter-Title': 'Pocket Ledger' } : {},
      fetch: async (url, options) => {
        if ((typeof url === 'string' ? url : url instanceof URL ? url.href : url.url) !== `${config.baseUrl}/chat/completions`) throw new ProviderRequestError('Unexpected provider endpoint. Check your API base URL.');
        let response: Response;
        try { response = await fetcher(url, { ...options, redirect: 'error' }); }
        catch {
          if (options?.signal?.aborted) throw new ProviderRequestError('The provider took too long. Try again. Nothing was changed.');
          throw new ProviderRequestError('Could not reach the provider. Check your internet connection and API URL.');
        }
        if (!response.ok) throw new ProviderRequestError(responseError(response.status));
        const raw = await response.text();
        if (raw.length > 65536) throw new ProviderRequestError('The provider response was too large. Nothing was changed.');
        try { JSON.parse(raw); } catch { throw new ProviderRequestError('The provider returned an unreadable response. Nothing was changed.'); }
        return new Response(raw, { status: response.status, headers: response.headers });
      },
    },
  });
  const model = client.bindTools(TOOL_DEFINITIONS, { parallel_tool_calls: false });
  return {
    async invoke(messages: Parameters<typeof model.invoke>[0], options?: { signal?: AbortSignal }) {
      if (options?.signal?.aborted) throw new Error('Cancelled.');
      try { return await model.invoke(messages, { ...options, callbacks: [] }); }
      catch (error) {
        if (options?.signal?.aborted) throw new Error('Cancelled.');
        let current: unknown = error;
        for (let i = 0; i < 5 && current instanceof Error; i++) {
          if (current instanceof ProviderRequestError) throw current;
          if (current.name === 'APIConnectionTimeoutError') throw new Error('The provider took too long. Try again. Nothing was changed.');
          current = current.cause;
        }
        throw new Error('The provider could not produce a valid tool response. Try another model that supports tool calling.');
      }
    },
  };
}

export function createOnlineInference(input: OnlineCredentials, fetcher: typeof fetch = fetch, timeoutMs = 60000): Inference {
  const config = validateCredentials(input);
  return async (messages, signal) => {
    if (signal?.aborted) throw new Error('Cancelled.');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetcher(`${config.baseUrl}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}`,
          ...(config.provider === 'openrouter' ? { 'X-OpenRouter-Title': 'Pocket Ledger' } : {}) },
        body: JSON.stringify({ model: config.model, messages, stream: false, temperature: 0.1,
          max_tokens: 800, response_format: { type: 'json_object' } }),
      });
      if (!response.ok) throw new Error(responseError(response.status));
      const raw = await response.text();
      if (raw.length > 65536) throw new Error('The provider response was too large. Nothing was changed.');
      let payload;
      try { payload = JSON.parse(raw); } catch { throw new Error('The provider returned an unreadable response. Nothing was changed.'); }
      const choice = payload?.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error('The response was cut short. Try a simpler request. Nothing was changed.');
      if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) {
        throw new Error('The provider returned no answer. Check that the selected model supports chat and JSON responses.');
      }
      if (controller.signal.aborted) throw new Error('Cancelled.');
      return choice.message.content;
    } catch (error) {
      if (signal?.aborted) throw new Error('Cancelled.');
      if (timedOut) throw new Error('The provider took too long. Try again. Nothing was changed.');
      // Never expose provider response bodies or transport errors that might contain a key.
      if (error instanceof TypeError) throw new Error('Could not reach the provider. Check your internet connection and API URL.');
      throw error;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    }
  };
}
