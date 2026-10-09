import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { useData } from '../../data/provider';
import { removeModel } from './model-file';
import {
  agentOptions,
  createExpenseAgent,
  replyText,
  REVIEW_REPLY,
} from './agent';
import { Command } from '@langchain/langgraph';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { Proposal } from '../../data/repository';
import { userError } from '../errors';
import {
  clearCredentials,
  readCredentials,
  saveCredentials,
} from './credentials';
import {
  createOnlineModel,
  providerError,
  DEFAULT_ONLINE_SETTINGS,
  publicSettings,
  validateAuth,
  validateCredentials,
  type OnlineAuth,
  type OnlineCredentials,
  type OnlineSettings,
} from './online';

export type Entry = { id: number; role: 'user' | 'assistant'; content: string };
type AiContextValue = {
  status: 'unloaded' | 'loading' | 'ready' | 'thinking';
  error: string | null;
  settings: OnlineSettings;
  hasKey: boolean;
  history: Entry[];
  pending: Proposal | null;
  saveKey: (input: OnlineAuth) => Promise<boolean>;
  saveModel: (input: OnlineSettings) => Promise<boolean>;
  testModel: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  deleteModel: () => Promise<void>;
  send: (text: string) => Promise<void>;
  confirm: () => Promise<void>;
  dismiss: () => Promise<void>;
  cancel: () => void;
};
const AiContext = createContext<AiContextValue | null>(null);

export function AiProvider({ children }: { children: React.ReactNode }) {
  const { repo, data, refresh } = useData();
  const [status, setStatus] = useState<AiContextValue['status']>('loading');
  const [settings, setSettings] = useState(DEFAULT_ONLINE_SETTINGS),
    [hasKey, setHasKey] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [history, setHistory] = useState<Entry[]>([]);
  const [pending, setPending] = useState<Proposal | null>(null);
  const busy = useRef(true),
    auth = useRef<OnlineAuth | null>(null),
    selected = useRef(DEFAULT_ONLINE_SETTINGS);
  const review = useRef<ReturnType<typeof createExpenseAgent> | null>(null);
  const abort = useRef<AbortController | null>(null),
    sequence = useRef(0);
  const append = (role: Entry['role'], content: string) => {
    const entry = { id: ++sequence.current, role, content };
    setHistory((h) => [...h, entry]);
  };
  const report = (e: unknown) =>
    setError(userError(e, 'The assistant could not complete this operation.'));
  const currentCredentials = (): OnlineCredentials | null => {
    const key = auth.current,
      choice = selected.current;
    return key &&
      key.provider === choice.provider &&
      key.baseUrl === choice.baseUrl &&
      choice.model
      ? { ...key, model: choice.model }
      : null;
  };
  const restoreStatus = () =>
    setStatus(currentCredentials() ? 'ready' : 'unloaded');
  const select = (value: OnlineSettings) => {
    selected.current = value;
    setSettings(value);
    setHistory([]);
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      const [value, saved] = await Promise.all([
        readCredentials(),
        repo.getAiSettings(),
      ]);
      // Preserve the old model before replacing legacy combined credentials with a key-only record.
      const choice =
        saved ??
        (value?.model
          ? publicSettings(value)
          : {
              ...DEFAULT_ONLINE_SETTINGS,
              ...(value
                ? { provider: value.provider, baseUrl: value.baseUrl }
                : {}),
            });
      if (value?.model) {
        if (!saved) await repo.saveAiSettings(choice);
        await saveCredentials(value);
      }
      if (!active) return;
      auth.current = value ? validateAuth(value) : null;
      selected.current = choice;
      setSettings(choice);
      setHasKey(!!value);
      restoreStatus();
    })()
      .catch(() => {
        if (active) {
          setError(
            'Could not read saved AI settings. Save your provider key and model in Settings.',
          );
          setStatus('unloaded');
        }
      })
      .finally(() => {
        if (active) busy.current = false;
      });
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') abort.current?.abort();
    });
    return () => {
      active = false;
      listener.remove();
      abort.current?.abort();
    };
    // repo is stable for the lifetime of the SQLite provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  const saveKey = async (input: OnlineAuth) => {
    if (busy.current || pending) return false;
    busy.current = true;
    setError(null);
    setStatus('loading');
    try {
      const candidate = validateAuth(input);
      await saveCredentials({ ...candidate, model: '' });
      auth.current = candidate;
      setHasKey(true);
      setHistory([]);
      return true;
    } catch (e) {
      report(e);
      return false;
    } finally {
      busy.current = false;
      restoreStatus();
    }
  };
  const saveModel = async (input: OnlineSettings) => {
    if (busy.current || pending) return false;
    busy.current = true;
    setError(null);
    setStatus('loading');
    try {
      // Validates the endpoint and model without reading or requiring a saved API key.
      const candidate = publicSettings(
        validateCredentials({ ...input, apiKey: 'validation-only' }),
      );
      await repo.saveAiSettings(candidate);
      select(candidate);
      return true;
    } catch (e) {
      report(e);
      return false;
    } finally {
      busy.current = false;
      restoreStatus();
    }
  };
  const testModel = async () => {
    const candidate = currentCredentials();
    if (busy.current || pending || !candidate) return false;
    busy.current = true;
    setError(null);
    setStatus('loading');
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await createOnlineModel(candidate).invoke(
        [
          new HumanMessage(
            'Connection test only. Reply "Connected" and do not call any tools.',
          ),
        ],
        { signal: controller.signal },
      );
      if (controller.signal.aborted) throw new Error('Cancelled.');
      if (
        result.tool_calls?.length ||
        result.invalid_tool_calls?.length ||
        !result.content ||
        result.response_metadata.finish_reason === 'length'
      )
        throw new Error(
          'The model did not follow the connection test. Choose another model with tool calling.',
        );
      return true;
    } catch (e) {
      report(providerError(e, controller.signal));
      return false;
    } finally {
      busy.current = false;
      abort.current = null;
      restoreStatus();
    }
  };
  const disconnect = async () => {
    if (busy.current || pending) return;
    busy.current = true;
    setError(null);
    setStatus('loading');
    try {
      await clearCredentials();
      auth.current = null;
      setHasKey(false);
      setHistory([]);
      setPending(null);
    } catch (e) {
      report(e);
    } finally {
      busy.current = false;
      restoreStatus();
    }
  };
  const deleteModel = async () => {
    if (busy.current || !data?.modelPath) return;
    busy.current = true;
    setError(null);
    setStatus('loading');
    try {
      removeModel(data.modelPath);
      await repo.clearModel();
      await refresh();
    } catch (e) {
      report(e);
    } finally {
      busy.current = false;
      restoreStatus();
    }
  };
  const send = async (text: string) => {
    const candidate = currentCredentials();
    if (busy.current || pending || !text.trim() || !candidate) return;
    busy.current = true;
    setError(null);
    setStatus('thinking');
    append('user', text);
    const controller = new AbortController();
    abort.current = controller;
    try {
      if (text.length > 1000)
        throw new Error('Use a message between 1 and 1,000 characters.');
      const turn = createExpenseAgent(
        repo,
        createOnlineModel(candidate),
        await repo.snapshot(),
      );
      const messages = [
        ...history
          .slice(-8)
          .map(({ role, content }) =>
            role === 'user'
              ? new HumanMessage(content)
              : new AIMessage(content),
          ),
        new HumanMessage(text),
      ];
      const result = await turn.agent.invoke(
        { messages },
        agentOptions(controller.signal),
      );
      if (controller.signal.aborted) throw new Error('Cancelled.');
      if (result.__interrupt__?.length) {
        const proposal = turn.getProposal();
        if (!proposal)
          throw new Error(
            'The change could not be reviewed. Please try again.',
          );
        review.current = turn;
        setPending(proposal);
        append('assistant', REVIEW_REPLY);
      } else append('assistant', replyText(result.messages));
    } catch (e) {
      report(e);
    } finally {
      busy.current = false;
      abort.current = null;
      restoreStatus();
    }
  };
  const finishReview = async (decision: 'approve' | 'reject') => {
    const turn = review.current;
    if (!pending || !turn || busy.current) return;
    busy.current = true;
    setError(null);
    setStatus('thinking');
    const controller = new AbortController();
    abort.current = controller;
    // Consume the review before resuming. A failed or cancelled resume cannot
    // be retried implicitly; the user must request and review a fresh change.
    review.current = null;
    setPending(null);
    try {
      turn.decide(decision);
      const result = await turn.agent.invoke(
        new Command({ resume: { decisions: [{ type: decision }] } }),
        agentOptions(controller.signal),
      );
      append('assistant', replyText(result.messages));
    } catch (e) {
      report(e);
    } finally {
      // A write may have committed just before cancellation; always refresh.
      try {
        await refresh();
      } catch (e) {
        report(e);
      }
      busy.current = false;
      abort.current = null;
      restoreStatus();
    }
  };
  const confirm = () => finishReview('approve');
  const dismiss = () => finishReview('reject');
  return (
    <AiContext.Provider
      value={{
        status,
        error,
        settings,
        hasKey,
        history,
        pending,
        saveKey,
        saveModel,
        testModel,
        disconnect,
        deleteModel,
        send,
        confirm,
        dismiss,
        cancel: () => abort.current?.abort(),
      }}
    >
      {children}
    </AiContext.Provider>
  );
}
export function useAi() {
  const value = useContext(AiContext);
  if (!value) throw new Error('AI provider is missing.');
  return value;
}
