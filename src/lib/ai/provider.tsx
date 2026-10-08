import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useData } from '../../data/provider';
import { removeModel } from './model-file';
import { runAgent } from './agent';
import { agentOutputSchema } from '../../data/tools';
import type { Proposal } from '../../data/repository';
import { userError } from '../errors';
import { clearCredentials, readCredentials, saveCredentials } from './credentials';
import { createOnlineInference, DEFAULT_ONLINE_SETTINGS, publicSettings, validateCredentials, type OnlineCredentials, type OnlineSettings } from './online';

export type Entry = { id: number; role: 'user' | 'assistant'; content: string };
type AiContextValue = {
  status: 'unloaded' | 'loading' | 'ready' | 'thinking'; error: string | null;
  settings: OnlineSettings; hasKey: boolean;
  history: Entry[]; pending: Proposal | null;
  connect: (settings: OnlineSettings, apiKey: string) => Promise<boolean>;
  disconnect: () => Promise<void>; deleteModel: () => Promise<void>;
  send: (text: string) => Promise<void>; confirm: () => Promise<void>; dismiss: () => void; cancel: () => void;
};
const AiContext = createContext<AiContextValue | null>(null);

export function AiProvider({ children }: { children: React.ReactNode }) {
  const { repo, data, refresh, apply } = useData();
  const [status, setStatus] = useState<AiContextValue['status']>('loading');
  const [settings, setSettings] = useState(DEFAULT_ONLINE_SETTINGS), [hasKey, setHasKey] = useState(false);
  const [error, setError] = useState<string | null>(null), [history, setHistory] = useState<Entry[]>([]);
  const [pending, setPending] = useState<Proposal | null>(null);
  const busy = useRef(true), credentials = useRef<OnlineCredentials | null>(null);
  const abort = useRef<AbortController | null>(null), sequence = useRef(0);
  const append = (role: Entry['role'], content: string) => {
    const entry = { id: ++sequence.current, role, content };
    setHistory(h => [...h, entry]);
  };
  const report = (e: unknown) => setError(userError(e, 'The assistant could not complete this operation.'));
  const restoreStatus = () => setStatus(credentials.current ? 'ready' : 'unloaded');

  useEffect(() => {
    let active = true;
    void readCredentials().then(value => {
      if (!active) return;
      credentials.current = value;
      if (value) setSettings(publicSettings(value));
      setHasKey(!!value); setStatus(value ? 'ready' : 'unloaded');
    }, () => { if (active) { setError('Could not read saved AI settings. Reconnect your provider in Settings.'); setStatus('unloaded'); } })
      .finally(() => { if (active) busy.current = false; });
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') abort.current?.abort(); });
    return () => { active = false; listener.remove(); abort.current?.abort(); };
  }, []);

  const connect = async (input: OnlineSettings, apiKey: string) => {
    if (busy.current || pending) return false;
    busy.current = true; setError(null); setStatus('loading');
    const controller = new AbortController(); abort.current = controller;
    try {
      const previous = credentials.current;
      const sameEndpoint = previous?.provider === input.provider && previous.baseUrl === input.baseUrl.trim().replace(/\/+$/, '');
      const candidate = validateCredentials({ ...input, apiKey: apiKey.trim() || (sameEndpoint ? previous?.apiKey ?? '' : '') });
      const raw = await createOnlineInference(candidate)([
        { role: 'system', content: 'Test the connection. Reply ONLY with JSON {"reply":"Connected.","tool":null}. Do not request any tool.' },
        { role: 'user', content: 'Test connection.' },
      ], controller.signal);
      const output = agentOutputSchema.parse(JSON.parse(raw));
      if (output.tool) throw new Error('The model did not follow the connection test. Choose another chat model.');
      if (controller.signal.aborted) throw new Error('Cancelled.');
      await saveCredentials(candidate);
      credentials.current = candidate; setSettings(publicSettings(candidate)); setHasKey(true);
      setHistory([]); setPending(null);
      return true;
    } catch (e) {
      report(e instanceof SyntaxError ? new Error('The model did not return valid JSON. Choose another chat model.') : e);
      return false;
    } finally { busy.current = false; abort.current = null; restoreStatus(); }
  };
  const disconnect = async () => {
    if (busy.current || pending) return;
    busy.current = true; setError(null); setStatus('loading');
    try {
      await clearCredentials(); credentials.current = null;
      setSettings(DEFAULT_ONLINE_SETTINGS); setHasKey(false); setHistory([]); setPending(null);
    } catch (e) { report(e); }
    finally { busy.current = false; restoreStatus(); }
  };
  const deleteModel = async () => {
    if (busy.current || !data?.modelPath) return;
    busy.current = true; setError(null); setStatus('loading');
    try { removeModel(data.modelPath); await repo.clearModel(); await refresh(); }
    catch (e) { report(e); }
    finally { busy.current = false; restoreStatus(); }
  };
  const send = async (text: string) => {
    if (busy.current || pending || !text.trim() || !credentials.current) return;
    busy.current = true; setError(null); setStatus('thinking'); append('user', text);
    const controller = new AbortController(); abort.current = controller;
    try {
      const result = await runAgent(repo, createOnlineInference(credentials.current), text,
        history.map(({ role, content }) => ({ role, content })), controller.signal);
      append('assistant', result.reply); setPending(result.proposal ?? null);
    } catch (e) { report(e); }
    finally { busy.current = false; abort.current = null; restoreStatus(); }
  };
  const confirm = async () => {
    if (!pending || busy.current) return;
    busy.current = true; setError(null);
    try { append('assistant', await apply(pending)); setPending(null); }
    catch (e) { report(e); setPending(null); }
    finally { busy.current = false; }
  };
  return <AiContext.Provider value={{ status, error, settings, hasKey, history, pending, connect, disconnect, deleteModel, send, confirm,
    dismiss: () => { if (!busy.current) { setPending(null); append('assistant', 'Change cancelled. Nothing was saved.'); } },
    cancel: () => abort.current?.abort(),
  }}>{children}</AiContext.Provider>;
}
export function useAi() { const value = useContext(AiContext); if (!value) throw new Error('AI provider is missing.'); return value; }
