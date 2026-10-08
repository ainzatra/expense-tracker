import { z } from 'zod';
import type { Inference } from './agent';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
export type OnlineSettings = { provider: 'openrouter' | 'compatible'; baseUrl: string; model: string };
export type OnlineCredentials = OnlineSettings & { apiKey: string };
export const DEFAULT_ONLINE_SETTINGS: OnlineSettings = { provider: 'openrouter', baseUrl: OPENROUTER_URL, model: '' };

const credentialsSchema = z.object({
  provider: z.enum(['openrouter', 'compatible']),
  baseUrl: z.string().trim().max(500),
  model: z.string().trim().min(1, 'Enter a model ID from your provider.').max(150),
  apiKey: z.string().trim().min(1, 'Enter your provider API key.').max(1024).regex(/^\S+$/, 'The API key cannot contain spaces.'),
});

export function validateCredentials(input: OnlineCredentials): OnlineCredentials {
  const parsed = credentialsSchema.parse(input);
  let url: URL;
  try { url = new URL(parsed.baseUrl); } catch { throw new Error('Enter a valid HTTPS API base URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTPS base URL without credentials, a query, or a fragment.');
  }
  const baseUrl = url.toString().replace(/\/+$/, '');
  if (parsed.provider === 'openrouter' && baseUrl !== OPENROUTER_URL) throw new Error('OpenRouter uses https://openrouter.ai/api/v1.');
  return { ...parsed, baseUrl };
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
  if (status === 400 || status === 422) return 'The provider rejected this request. Choose a chat model that supports JSON responses.';
  return `The provider is unavailable (HTTP ${status}). Try again later.`;
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
