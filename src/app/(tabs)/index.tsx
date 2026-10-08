import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Plus, Sparkles, ArrowRight } from 'lucide-react-native';
import { Screen, Empty, ErrorNote } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Card, CardContent } from '@/components/ui/card';
import { ExpenseForm } from '@/components/forms';
import { IncomeForm } from '@/components/income-form';
import { ExpenseRow } from '@/components/expense-row';
import { useData } from '@/data/provider';
import type { Expense } from '@/data/repository';
import { localDay, money } from '@/lib/money';

type Summary = { total_cents: number; count: number; income_cents: number; income_count: number; net_cents: number; categories: { name: string; total_cents: number }[] };
export default function Overview() {
  const { data, repo } = useData();
  const [editing, setEditing] = useState<Expense | 'new' | null>(null), [summary, setSummary] = useState<Summary | null>(null), [error, setError] = useState<string | null>(null);
  const [addingMoney, setAddingMoney] = useState(false);
  const today = localDay(), start = `${today.slice(0, 7)}-01`;
  useEffect(() => {
    let active = true;
    void repo.read({ name: 'get_summary', arguments: { start, end: today } }).then(value => { if (active) { setSummary(value as Summary); setError(null); } }, e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [repo, data?.revision, start, today]);
  const balance = data?.wallets.reduce((sum, w) => sum + w.balance_cents, 0) ?? 0;
  return <><Screen title="A little more clarity." subtitle={new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}>
    <Card className="border-primary bg-primary py-6"><CardContent className="gap-4"><Text className="text-sm text-white/70">TOTAL WALLET BALANCE</Text><Text className="text-4xl font-bold text-white">{money(balance, data?.currency ?? 'PHP')}</Text><View className="flex-row justify-between"><Text className="text-sm text-white/70">Across {data?.wallets.length ?? 0} wallets</Text><Text className="text-sm text-white/70">Stored on your phone</Text></View></CardContent></Card>
    <View className="flex-row gap-3"><Button className="flex-1" size="lg" onPress={() => setEditing('new')}><Plus color="white" size={18} /><Text>Add expense</Text></Button><Button className="flex-1" variant="outline" size="lg" onPress={() => router.push('/assistant')}><Sparkles color="#176b50" size={18} /><Text>Ask assistant</Text></Button></View>
    <View className="flex-row gap-3"><Button className="flex-1" variant="secondary" onPress={() => setAddingMoney(true)}><Plus color="#176b50" size={18} /><Text>Add money</Text></Button><Button className="flex-1" variant="outline" onPress={() => router.push('/recurring')}><Text>{data?.recurring.filter(r => r.due).length ? `${data.recurring.filter(r => r.due).length} recurring due` : 'Deposits & bills'}</Text></Button></View>
    {!data?.wallets.length && <Empty title="Start with your first wallet" detail="Set an opening balance so every expense has somewhere to come from." action={<Button onPress={() => router.push('/wallets')}><Text>Set up wallets</Text><ArrowRight size={16} color="white" /></Button>} />}
    <ErrorNote message={error} />
    <Card className="gap-0 py-5"><CardContent className="gap-2"><Text className="text-sm text-muted-foreground">Spent this month through today</Text><Text className="text-3xl font-bold">{summary ? money(summary.total_cents, data?.currency ?? 'PHP') : '…'}</Text><Text className="text-xs text-muted-foreground">{summary?.count ?? 0} expenses · {start} to {today}</Text></CardContent></Card>
    <Card className="gap-0 py-5"><CardContent className="gap-2"><Text className="text-sm text-muted-foreground">Received this month through today</Text><Text className="text-3xl font-bold text-primary">{summary ? money(summary.income_cents, data?.currency ?? 'PHP') : '…'}</Text><Text className="text-xs text-muted-foreground">{summary?.income_count ?? 0} income entries · Net change {summary ? money(summary.net_cents, data?.currency ?? 'PHP') : '…'}</Text></CardContent></Card>
    {!!summary?.categories.length && <View className="gap-3"><Text className="text-lg font-semibold">Where it went</Text>{summary.categories.slice(0, 4).map(c => <View key={c.name} className="gap-2"><View className="flex-row justify-between"><Text className="text-sm">{c.name}</Text><Text className="text-sm font-medium">{money(c.total_cents, data?.currency ?? 'PHP')}</Text></View><View className="h-2 overflow-hidden rounded-full bg-muted"><View className="h-2 rounded-full bg-primary" style={{ width: `${Math.round(c.total_cents / summary.total_cents * 100)}%` }} /></View></View>)}</View>}
    <View className="gap-2"><View className="flex-row items-center justify-between"><Text className="text-lg font-semibold">Recent expenses</Text><Button variant="ghost" size="sm" onPress={() => router.push('/expenses')}><Text>View all</Text></Button></View>
      {data?.expenses.slice(0, 5).map(e => <ExpenseRow key={e.id} expense={e} currency={data.currency} onPress={() => setEditing(e)} />)}
      {!data?.expenses.length && <Text className="py-4 text-sm text-muted-foreground">Your next expense is the first step. Add one manually or tell your assistant.</Text>}
    </View>
  </Screen>{editing && <ExpenseForm expense={editing === 'new' ? undefined : editing} close={() => setEditing(null)} />}{addingMoney && <IncomeForm close={() => setAddingMoney(false)} />}</>;
}
