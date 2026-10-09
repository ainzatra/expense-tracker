import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { ensureCrypto } from './crypto';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
export type OnlineSettings = {
  provider: 'openrouter' | 'compatible';
  baseUrl: string;
  model: string;
};
export type OnlineCredentials = OnlineSettings & { apiKey: string };
export type OnlineAuth = Omit<OnlineCredentials, 'model'>;
export const DEFAULT_ONLINE_SETTINGS: OnlineSettings = {
  provider: 'openrouter',
  baseUrl: OPENROUTER_URL,
  model: '',
};

const authSchema = z.object({
  provider: z.enum(['openrouter', 'compatible']),
  baseUrl: z.string().trim().max(500),
  apiKey: z
    .string()
    .trim()
    .min(1, 'Enter your provider API key.')
    .max(1024)
    .regex(/^\S+$/, 'The API key cannot contain spaces.'),
});

export function validateAuth(input: OnlineAuth): OnlineAuth {
  const parsed = authSchema.parse(input);
  let url: URL;
  try {
    url = new URL(parsed.baseUrl);
  } catch {
    throw new Error('Enter a valid HTTPS API base URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Use an HTTPS base URL without credentials, a query, or a fragment.',
    );
  }
  const baseUrl = url.toString().replace(/\/+$/, '');
  if (parsed.provider === 'openrouter' && baseUrl !== OPENROUTER_URL)
    throw new Error('OpenRouter uses https://openrouter.ai/api/v1.');
  return { ...parsed, baseUrl };
}
export function validateCredentials(
  input: OnlineCredentials,
): OnlineCredentials {
  return {
    ...validateAuth(input),
    model: z
      .string()
      .trim()
      .min(1, 'Enter a model ID from your provider.')
      .max(150)
      .parse(input.model),
  };
}

export function publicSettings({
  provider,
  baseUrl,
  model,
}: OnlineCredentials): OnlineSettings {
  return { provider, baseUrl, model };
}

function responseError(status: number) {
  if (status === 401)
    return 'The provider rejected your API key. Update it in Settings.';
  if (status === 402)
    return 'Your provider account needs credits. Check its balance or choose an available free model.';
  if (status === 403)
    return 'The provider denied access to this model. Check your account and model permissions.';
  if (status === 404)
    return 'The model or API endpoint was not found. Check Settings.';
  if (status === 429)
    return 'The provider rate limit was reached. Wait before trying again.';
  if (status === 400 || status === 422)
    return 'The provider rejected this request. Choose a chat model that supports tool calling.';
  return `The provider is unavailable (HTTP ${status}). Try again later.`;
}

export class ProviderRequestError extends Error {}

export function createOnlineModel(
  input: OnlineCredentials,
  fetcher: typeof fetch = fetch,
  timeoutMs = 60000,
) {
  ensureCrypto();
  const config = validateCredentials(input);
  return new ChatOpenAI({
    model: config.model,
    apiKey: config.apiKey,
    temperature: 0.1,
    maxTokens: 1600,
    maxRetries: 0,
    timeout: timeoutMs,
    useResponsesApi: false,
    configuration: {
      baseURL: config.baseUrl,
      dangerouslyAllowBrowser: true,
      defaultHeaders:
        config.provider === 'openrouter'
          ? { 'X-OpenRouter-Title': 'Pocket Ledger' }
          : {},
      fetch: async (url, options) => {
        if (
          (typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.href
              : url.url) !== `${config.baseUrl}/chat/completions`
        )
          throw new ProviderRequestError(
            'Unexpected provider endpoint. Check your API base URL.',
          );
        let response: Response;
        try {
          response = await fetcher(url, { ...options, redirect: 'error' });
        } catch {
          if (options?.signal?.aborted)
            throw new ProviderRequestError(
              'The provider took too long. Try again. Nothing was changed.',
            );
          throw new ProviderRequestError(
            'Could not reach the provider. Check your internet connection and API URL.',
          );
        }
        if (!response.ok)
          throw new ProviderRequestError(responseError(response.status));
        const raw = await response.text();
        if (raw.length > 65536)
          throw new ProviderRequestError(
            'The provider response was too large. Nothing was changed.',
          );
        try {
          JSON.parse(raw);
        } catch {
          throw new ProviderRequestError(
            'The provider returned an unreadable response. Nothing was changed.',
          );
        }
        return new Response(raw, {
          status: response.status,
          headers: response.headers,
        });
      },
    },
  });
}

// SDK errors can wrap the guarded transport error several layers deep.
export function providerError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted) return new Error('Cancelled.');
  let current: unknown = error;
  for (let i = 0; i < 10 && current instanceof Error; i++) {
    if (current instanceof ProviderRequestError) return current;
    if (current.name === 'APIConnectionTimeoutError')
      return new Error(
        'The provider took too long. Try again. Nothing was changed.',
      );
    current = current.cause;
  }
  return new Error(
    'The provider could not produce a valid tool response. Try another model that supports tool calling.',
  );
}
