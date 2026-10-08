import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import { Repository, type Proposal, type Snapshot } from './repository';
import type { WriteCall } from './tools';

type DataContextValue = {
  repo: Repository; data: Snapshot | null; error: string | null;
  refresh: () => Promise<void>; change: (call: WriteCall) => Promise<string>; apply: (proposal: Proposal) => Promise<string>;
};
const DataContext = createContext<DataContextValue | null>(null);
export function DataProvider({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext(), repo = useMemo(() => new Repository(db), [db]);
  const [data, setData] = useState<Snapshot | null>(null), [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setData(await repo.snapshot()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read local data.'); throw e; }
  }, [repo]);
  useEffect(() => {
    let active = true;
    void repo.snapshot().then(value => { if (active) { setData(value); setError(null); } }, e => { if (active) setError(e instanceof Error ? e.message : 'Could not read local data.'); });
    return () => { active = false; };
  }, [repo]);
  const apply = useCallback(async (proposal: Proposal) => { const result = await repo.apply(proposal); await refresh(); return result; }, [repo, refresh]);
  const change = useCallback(async (call: WriteCall) => apply(await repo.propose(call)), [repo, apply]);
  return <DataContext.Provider value={{ repo, data, error, refresh, change, apply }}>{children}</DataContext.Provider>;
}
export function useData() {
  const value = useContext(DataContext);
  if (!value) throw new Error('Data provider is missing.');
  return value;
}
