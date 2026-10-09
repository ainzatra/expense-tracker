import { HumanMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { agentOptions, createExpenseAgent } from '../src/lib/ai/agent';
import { createOnlineModel, OPENROUTER_URL } from '../src/lib/ai/online';
import type { Repository } from '../src/data/repository';

export const config = {
  provider: 'openrouter' as const,
  baseUrl: OPENROUTER_URL,
  model: 'example/tools',
  apiKey: 'test-only-key',
};
export const response = (message: object, finish_reason = 'stop') =>
  new Response(
    JSON.stringify({
      id: globalThis.crypto.randomUUID(),
      object: 'chat.completion',
      created: 1,
      model: config.model,
      choices: [
        { index: 0, finish_reason, message: { role: 'assistant', ...message } },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
export const toolCall = (name: string, args: object, id = 'call-test') => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
export async function turn(repo: Repository, fetcher: typeof fetch) {
  return createExpenseAgent(
    repo,
    createOnlineModel(config, fetcher),
    await repo.snapshot(),
  );
}
export function start(
  session: Awaited<ReturnType<typeof turn>>,
  signal?: AbortSignal,
) {
  return session.agent.invoke(
    { messages: [new HumanMessage('Please track my money.')] },
    agentOptions(signal),
  );
}
export function resume(
  session: Awaited<ReturnType<typeof turn>>,
  decision: 'approve' | 'reject',
) {
  session.decide(decision);
  return session.agent.invoke(
    new Command({ resume: { decisions: [{ type: decision }] } }),
    agentOptions(),
  );
}
