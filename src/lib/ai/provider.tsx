import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useData } from '../../data/provider';
import { complete, loadModel, unloadModel } from './runtime';
import { pickModel, removeModel } from './model-file';
import { runAgent } from './agent';
import type { Proposal } from '../../data/repository';
import { userError } from '../errors';

export type Entry = { id: number; role: 'user' | 'assistant'; content: string };
type AiContextValue = {
  status: 'unloaded' | 'loading' | 'ready' | 'thinking'; error: string | null;
  history: Entry[]; pending: Proposal | null;
  importModel: () => Promise<void>; loadSaved: () => Promise<void>; unload: () => Promise<void>;
  send: (text: string) => Promise<void>; confirm: () => Promise<void>; dismiss: () => void; cancel: () => void;
};
const AiContext = createContext<AiContextValue | null>(null);

export function AiProvider({ children }: { children: React.ReactNode }) {
  const { repo, data, refresh, apply } = useData();
  const [status, setStatus] = useState<AiContextValue['status']>('unloaded');
  const [error, setError] = useState<string | null>(null), [history, setHistory] = useState<Entry[]>([]);
  const [pending, setPending] = useState<Proposal | null>(null);
  const busy = useRef(false), loaded = useRef(false), abort = useRef<AbortController | null>(null), sequence = useRef(0);
  const append = (role: Entry['role'], content: string) => {
    const entry = { id: ++sequence.current, role, content };
    setHistory(h => [...h, entry]);
  };
  const report = (e: unknown) => setError(userError(e, 'The local model could not complete this operation.'));

  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') abort.current?.abort(); });
    return () => { listener.remove(); abort.current?.abort(); void unloadModel(); };
  }, []);

  const load = async (importing: boolean) => {
    if (busy.current) return;
    busy.current = true; setError(null); setStatus('loading');
    let candidate: { path: string; name: string } | null = null, persisted = false;
    try {
      candidate = importing ? await pickModel() : data?.modelPath ? { path: data.modelPath, name: data.modelName ?? 'Local model' } : null;
      if (!candidate) { setStatus(loaded.current ? 'ready' : 'unloaded'); return; }
      loaded.current = false;
      await loadModel(candidate.path);
      if (importing) { await repo.saveModel(candidate.path, candidate.name); persisted = true; await refresh(); }
      loaded.current = true; setStatus('ready');
      if (importing && data?.modelPath && data.modelPath !== candidate.path) {
        try { removeModel(data.modelPath); } catch { /* old model cleanup is best effort */ }
      }
    } catch (e) {
      await unloadModel().catch(() => undefined); loaded.current = false;
      if (importing && candidate && !persisted) { try { removeModel(candidate.path); } catch {} }
      report(e); setStatus('unloaded');
    } finally { busy.current = false; }
  };
  const unload = async () => {
    if (busy.current) return;
    busy.current = true;
    try { await unloadModel(); loaded.current = false; setStatus('unloaded'); }
    catch (e) { report(e); }
    finally { busy.current = false; }
  };
  const send = async (text: string) => {
    if (busy.current || pending || !text.trim() || !loaded.current) return;
    busy.current = true; setError(null); setStatus('thinking'); append('user', text);
    const controller = new AbortController(); abort.current = controller;
    try {
      const result = await runAgent(repo, complete, text, history.map(({ role, content }) => ({ role, content })), controller.signal);
      append('assistant', result.reply); setPending(result.proposal ?? null);
    } catch (e) { report(e); }
    finally { busy.current = false; abort.current = null; setStatus(loaded.current ? 'ready' : 'unloaded'); }
  };
  const confirm = async () => {
    if (!pending || busy.current) return;
    busy.current = true; setError(null);
    try { append('assistant', await apply(pending)); setPending(null); }
    catch (e) { report(e); setPending(null); }
    finally { busy.current = false; }
  };
  return <AiContext.Provider value={{ status, error, history, pending, importModel: () => load(true), loadSaved: () => load(false), unload, send, confirm,
    dismiss: () => { if (!busy.current) { setPending(null); append('assistant', 'Change cancelled. Nothing was saved.'); } },
    cancel: () => abort.current?.abort(),
  }}>{children}</AiContext.Provider>;
}
export function useAi() { const value = useContext(AiContext); if (!value) throw new Error('AI provider is missing.'); return value; }
