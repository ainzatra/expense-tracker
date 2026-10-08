import type { ChatMessage } from './runtime.native';
export async function loadModel(_path: string): Promise<void> { throw new Error('On-device AI requires the Android development build.'); }
export async function unloadModel(): Promise<void> {}
export async function complete(_messages: ChatMessage[], _signal?: AbortSignal): Promise<string> { throw new Error('On-device AI requires Android.'); }
