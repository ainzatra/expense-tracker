import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { Screen, Empty, ErrorNote } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { ExpenseForm } from '@/components/forms';
import { ExpenseRow } from '@/components/expense-row';
import { useData } from '@/data/provider';
import type { Expense } from '@/data/repository';

export default function Expenses() {
  const { data } = useData();
  const [walletId, setWalletId] = useState<number | undefined>();
  return <ExpenseList key={`${walletId ?? 'all'}:${data?.revision ?? 0}`} walletId={walletId} setWalletId={setWalletId} />;
}
function ExpenseList({ walletId, setWalletId }: { walletId: number | undefined; setWalletId: (id: number | undefined) => void }) {
  const { data, repo } = useData();
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [page, setPage] = useState(0), [result, setResult] = useState<{ page: number; rows: Expense[]; count: number; error: string | null }>({ page: -1, rows: [], count: 0, error: null });
  const loading = result.page !== page, { rows, count, error } = result;
  useEffect(() => {
    let active = true;
    void repo.read({ name: 'list_expenses', arguments: { wallet_id: walletId, limit: 25, offset: page * 25 } }).then(result => {
      if (!active) return;
      const value = result as { expenses: Expense[]; count: number };
      setResult({ page, rows: value.expenses, count: value.count, error: null });
    }, e => { if (active) setResult({ page, rows: [], count: 0, error: e.message }); });
    return () => { active = false; };
  }, [repo, walletId, page, data?.revision]);
  return <><Screen title="Expenses" subtitle="Every small thing, accounted for." action={<Button size="icon" accessibilityLabel="Add expense" onPress={() => setEditing('new')}><Plus size={20} color="white" /></Button>}>
    <View className="flex-row flex-wrap gap-2"><Button size="sm" variant={walletId === undefined ? 'default' : 'outline'} onPress={() => setWalletId(undefined)}><Text>All wallets</Text></Button>{data?.wallets.map(w => <Button key={w.id} size="sm" variant={walletId === w.id ? 'default' : 'outline'} onPress={() => setWalletId(w.id)}><Text>{w.name}</Text></Button>)}</View>
    <ErrorNote message={error} />
    {loading && <Text className="text-sm text-muted-foreground">Loading expenses…</Text>}
    {!loading && !rows.length && <Empty title="No expenses here yet" detail="Add an expense and choose the wallet you paid from." action={<Button onPress={() => setEditing('new')}><Text>Add expense</Text></Button>} />}
    <View>{rows.map(e => <ExpenseRow key={e.id} expense={e} currency={data?.currency ?? 'PHP'} onPress={() => setEditing(e)} />)}</View>
    {!!count && <View className="gap-3"><Text className="text-center text-xs text-muted-foreground">{page * 25 + 1}–{Math.min((page + 1) * 25, count)} of {count} expenses</Text><View className="flex-row justify-between"><Button variant="outline" disabled={page === 0 || loading} onPress={() => setPage(p => p - 1)}><Text>Previous</Text></Button><Button variant="outline" disabled={(page + 1) * 25 >= count || loading} onPress={() => setPage(p => p + 1)}><Text>Next</Text></Button></View></View>}
  </Screen>{editing && <ExpenseForm expense={editing === 'new' ? undefined : editing} close={() => setEditing(null)} />}</>;
}
