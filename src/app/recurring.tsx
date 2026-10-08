import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useData } from '@/data/provider';
import type { Proposal, Recurring } from '@/data/repository';
import type { WriteCall } from '@/data/tools';
import { money } from '@/lib/money';
import { userError } from '@/lib/errors';
import { Screen, Empty, ErrorNote } from '@/components/screen';
import { RecurringForm } from '@/components/recurring-form';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function RecurringScreen() {
  const { data, repo, apply, change } = useData();
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null), [pending, setPending] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const review = async (call: WriteCall) => {
    setError(null); setBusy(true);
    try { setPending(await repo.propose(call)); } catch (e) { setError(userError(e, 'Could not review this entry.')); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true); setError(null);
    try { await apply(pending); setPending(null); } catch (e) { setError(userError(e, 'Could not record this entry.')); setPending(null); }
    finally { setBusy(false); }
  };
  const toggle = async (r: Recurring) => {
    setBusy(true); setError(null);
    try { await change({ name: 'set_recurring_enabled', arguments: { id: r.id, enabled: !r.enabled } }); } catch (e) { setError(userError(e, 'Could not update schedule.')); }
    finally { setBusy(false); }
  };
  const rules = [...data?.recurring ?? []].sort((a, b) => Number(b.due) - Number(a.due) || (a.next_date ?? '9999').localeCompare(b.next_date ?? '9999'));
  return <><Screen title="Deposits & bills" subtitle="Repeat the plan. Confirm what happened.">
    <View className="flex-row gap-2"><Button variant="outline" onPress={() => router.back()}><Text>Back</Text></Button><Button className="flex-1" disabled={busy || !!pending} onPress={() => setEditing('new')}><Text>Add recurring entry</Text></Button></View>
    <ErrorNote message={error} />
    {pending && <Card className="border-primary/30"><CardContent className="gap-3"><Text className="text-lg font-semibold">{pending.title}</Text>{pending.details.map((d, i) => <Text key={i} className="text-sm">{d}</Text>)}<View className="flex-row gap-2"><Button disabled={busy} variant={pending.destructive ? 'destructive' : 'default'} onPress={() => { void confirm(); }}><Text>Confirm</Text></Button><Button variant="outline" disabled={busy} onPress={() => setPending(null)}><Text>Cancel</Text></Button></View></CardContent></Card>}
    {!rules.length && <Empty title="Make regular money easier to track" detail="Schedule a salary, allowance, rent, subscription, or another regular deposit or bill. Due entries wait for your confirmation." />}
    {rules.map(r => <Card key={r.id} className="gap-0 py-5"><CardContent className="gap-3"><View className="flex-row justify-between"><Text className="flex-1 text-lg font-semibold">{r.description}</Text><Text className={r.due ? 'font-semibold text-primary' : 'text-muted-foreground'}>{!r.enabled ? 'Paused' : !r.next_date ? 'Complete' : r.due ? 'Due' : 'Upcoming'}</Text></View><Text className={r.kind === 'income' ? 'text-2xl font-bold text-primary' : 'text-2xl font-bold'}>{r.kind === 'income' ? '+' : '-'}{money(r.amount_cents, data?.currency ?? 'PHP')}</Text><Text className="text-sm text-muted-foreground">{r.wallet_name} · {r.source ?? r.category_name} · {r.frequency}</Text><Text className="text-sm">{r.next_date ? `${r.due ? 'Due since' : 'Next due'} ${r.next_date}` : `Ended ${r.end_date}`}</Text>
      {r.due && r.next_date && <View className="flex-row gap-2"><Button className="flex-1" disabled={busy || !!pending} onPress={() => { void review({ name: 'post_recurring', arguments: { id: r.id, date: r.next_date! } }); }}><Text>{r.kind === 'income' ? 'Record received' : 'Record paid'}</Text></Button><Button variant="outline" disabled={busy || !!pending} onPress={() => { void review({ name: 'skip_recurring', arguments: { id: r.id, date: r.next_date! } }); }}><Text>Skip</Text></Button></View>}
      <View className="flex-row flex-wrap gap-1"><Button size="sm" variant="ghost" disabled={busy || !!pending} onPress={() => setEditing(r)}><Text>Edit</Text></Button><Button size="sm" variant="ghost" disabled={busy || !!pending} onPress={() => { void toggle(r); }}><Text>{r.enabled ? 'Pause' : 'Resume'}</Text></Button><Button size="sm" variant="ghost" disabled={busy || !!pending} onPress={() => { void review({ name: 'delete_recurring', arguments: { id: r.id } }); }}><Text className="text-destructive">Delete schedule</Text></Button></View>
    </CardContent></Card>)}
  </Screen>{editing && <RecurringForm rule={editing === 'new' ? undefined : editing} close={() => setEditing(null)} />}</>;
}
