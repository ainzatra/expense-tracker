import type { LlamaContext } from 'llama.rn';
import { outputJsonSchema } from '../../data/tools';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
let context: LlamaContext | null = null;

export async function loadModel(path: string) {
  await unloadModel();
  const { initLlama } = await import('llama.rn').catch(() => {
    throw new Error('On-device AI needs an Android development build with llama.rn. Expo Go cannot load the model.');
  });
  // CPU baseline for the Vivo V40. OpenCL offload needs a measured device test.
  context = await initLlama({ model: path, n_ctx: 4096, n_batch: 128, n_threads: 4, n_gpu_layers: 0, use_mlock: false });
}
export async function unloadModel() {
  if (context) { await context.release(); context = null; }
}
export async function complete(messages: ChatMessage[], signal?: AbortSignal) {
  if (!context) throw new Error('Load a model in Settings before using the assistant.');
  if (signal?.aborted) throw new Error('Cancelled.');
  const active = context;
  const stop = () => { void active.stopCompletion().catch(() => undefined); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const result = await active.completion({
      messages, n_predict: 512, temperature: 0.1,
      response_format: { type: 'json_schema', json_schema: { strict: true, schema: outputJsonSchema } },
      stop: ['<|im_end|>', '<|eot_id|>', '</s>'],
    });
    if (signal?.aborted) throw new Error('Cancelled.');
    return result.text;
  } finally { signal?.removeEventListener('abort', stop); }
}
