import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Screen, Empty, ErrorNote } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { ExpenseForm } from '@/components/forms';
import { ExpenseRow } from '@/components/expense-row';
import { IncomeForm } from '@/components/income-form';
import { money } from '@/lib/money';
import { useData } from '@/data/provider';
import type { Expense, Income } from '@/data/repository';

export default function Expenses() {
  const { data } = useData();
  const [walletId, setWalletId] = useState<number | undefined>();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  return <ExpenseList key={`${kind}:${walletId ?? 'all'}:${data?.revision ?? 0}`} walletId={walletId} setWalletId={setWalletId} kind={kind} setKind={setKind} />;
}
function ExpenseList({ walletId, setWalletId, kind, setKind }: { walletId: number | undefined; setWalletId: (id: number | undefined) => void; kind: 'income' | 'expense'; setKind: (kind: 'income' | 'expense') => void }) {
  const { data, repo } = useData();
  const [editing, setEditing] = useState<Expense | Income | 'new' | null>(null);
  const [page, setPage] = useState(0), [result, setResult] = useState<{ page: number; rows: (Expense | Income)[]; count: number; error: string | null }>({ page: -1, rows: [], count: 0, error: null });
  const loading = result.page !== page, { rows, count, error } = result;
  useEffect(() => {
    let active = true;
    void repo.read({ name: kind === 'income' ? 'list_incomes' : 'list_expenses', arguments: { wallet_id: walletId, limit: 25, offset: page * 25 } }).then(result => {
      if (!active) return;
      const value = result as { expenses?: Expense[]; incomes?: Income[]; count: number };
      setResult({ page, rows: value.incomes ?? value.expenses ?? [], count: value.count, error: null });
    }, e => { if (active) setResult({ page, rows: [], count: 0, error: e.message }); });
    return () => { active = false; };
  }, [repo, walletId, page, kind, data?.revision]);
  return <><Screen title="Money activity" subtitle="Money received and money spent." action={<Button size="icon" accessibilityLabel={kind === 'income' ? 'Add money' : 'Add expense'} onPress={() => setEditing('new')}><Plus size={20} color="white" /></Button>}>
    <View className="flex-row gap-2"><Button className="flex-1" variant={kind === 'expense' ? 'default' : 'outline'} onPress={() => setKind('expense')}><Text>Expenses</Text></Button><Button className="flex-1" variant={kind === 'income' ? 'default' : 'outline'} onPress={() => setKind('income')}><Text>Income</Text></Button></View>
    <Button variant="outline" onPress={() => router.push('/recurring')}><Text>Recurring deposits & bills</Text></Button>
    <View className="flex-row flex-wrap gap-2"><Button size="sm" variant={walletId === undefined ? 'default' : 'outline'} onPress={() => setWalletId(undefined)}><Text>All wallets</Text></Button>{data?.wallets.map(w => <Button key={w.id} size="sm" variant={walletId === w.id ? 'default' : 'outline'} onPress={() => setWalletId(w.id)}><Text>{w.name}</Text></Button>)}</View>
    <ErrorNote message={error} />
    {loading && <Text className="text-sm text-muted-foreground">Loading activity…</Text>}
    {!loading && !rows.length && <Empty title={kind === 'income' ? 'No income here yet' : 'No expenses here yet'} detail={kind === 'income' ? 'Record salary, allowance, or another deposit into a wallet.' : 'Add an expense and choose the wallet you paid from.'} action={<Button onPress={() => setEditing('new')}><Text>{kind === 'income' ? 'Add money' : 'Add expense'}</Text></Button>} />}
    <View>{rows.map(e => kind === 'expense' ? <ExpenseRow key={e.id} expense={e as Expense} currency={data?.currency ?? 'PHP'} onPress={() => setEditing(e)} /> : <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`Edit income ${e.description}`} onPress={() => setEditing(e)} className="flex-row items-center justify-between border-b border-border py-4"><View className="flex-1 gap-1"><Text className="font-semibold">{e.description}</Text><Text className="text-xs text-muted-foreground">{(e as Income).source} · {e.wallet_name} · {e.date}</Text></View><Text className="font-semibold text-primary">+{money(e.amount_cents, data?.currency ?? 'PHP')}</Text></Pressable>)}</View>
    {!!count && <View className="gap-3"><Text className="text-center text-xs text-muted-foreground">{page * 25 + 1}–{Math.min((page + 1) * 25, count)} of {count} {kind === 'income' ? 'income entries' : 'expenses'}</Text><View className="flex-row justify-between"><Button variant="outline" disabled={page === 0 || loading} onPress={() => setPage(p => p - 1)}><Text>Previous</Text></Button><Button variant="outline" disabled={(page + 1) * 25 >= count || loading} onPress={() => setPage(p => p + 1)}><Text>Next</Text></Button></View></View>}
  </Screen>{editing && (kind === 'income' ? <IncomeForm income={editing === 'new' ? undefined : editing as Income} close={() => setEditing(null)} /> : <ExpenseForm expense={editing === 'new' ? undefined : editing as Expense} close={() => setEditing(null)} />)}</>;
}
