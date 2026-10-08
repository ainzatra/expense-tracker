import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Text } from './ui/text';
import { ErrorNote } from './screen';
import { useData } from '@/data/provider';
import type { Expense, Wallet } from '@/data/repository';
import { decimal, localDay } from '@/lib/money';
import { userError } from '@/lib/errors';

export function Sheet({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return <Modal visible animationType="slide" onRequestClose={close}>
    <SafeAreaView className="flex-1 bg-background"><KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 p-5">
        <View className="flex-row items-center justify-between"><Text className="text-2xl font-bold">{title}</Text><Button variant="ghost" size="icon" accessibilityLabel="Close form" onPress={close}><X size={22} color="#172923" /></Button></View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView></SafeAreaView>
  </Modal>;
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View className="gap-2"><Text className="text-sm font-semibold">{label}</Text>{children}</View>;
}
export function ExpenseForm({ expense, close }: { expense?: Expense; close: () => void }) {
  const { data, change } = useData();
  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState(expense ? decimal(expense.amount_cents) : '');
  const [date, setDate] = useState(expense?.date ?? localDay());
  const [walletId, setWalletId] = useState(expense?.wallet_id ?? data?.wallets[0]?.id ?? 0);
  const [categoryId, setCategoryId] = useState(expense?.category_id ?? data?.categories[0]?.id ?? 0);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [deleting, setDeleting] = useState(false);
  const save = async (remove = false) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const args = { description, amount, date, wallet_id: walletId, category_id: categoryId };
      await change(remove && expense ? { name: 'delete_expense', arguments: { id: expense.id } }
        : expense ? { name: 'update_expense', arguments: { ...args, id: expense.id } } : { name: 'create_expense', arguments: args });
      close();
    } catch (e) { setError(userError(e, 'Could not save expense.')); }
    finally { setBusy(false); }
  };
  return <Sheet title={expense ? 'Edit expense' : 'Add expense'} close={busy ? () => undefined : close}>
    <ErrorNote message={error} />
    <Field label={`Amount (${data?.currency})`}><Input accessibilityLabel="Expense amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="250.00" className="h-14 text-2xl" /></Field>
    <Field label="What was it for?"><Input accessibilityLabel="Expense description" value={description} onChangeText={setDescription} placeholder="Lunch with friends" maxLength={200} className="h-12" /></Field>
    <Field label="Wallet"><View className="flex-row flex-wrap gap-2">{data?.wallets.map(w => <Button key={w.id} variant={walletId === w.id ? 'default' : 'outline'} accessibilityState={{ selected: walletId === w.id }} onPress={() => setWalletId(w.id)}><Text>{w.name}</Text></Button>)}</View>{!data?.wallets.length && <Text className="text-sm text-destructive">Create a wallet first in the Wallets tab.</Text>}</Field>
    <Field label="Category"><View className="flex-row flex-wrap gap-2">{data?.categories.map(c => <Button key={c.id} variant={categoryId === c.id ? 'secondary' : 'outline'} accessibilityState={{ selected: categoryId === c.id }} onPress={() => setCategoryId(c.id)}><Text>{c.name}</Text></Button>)}</View></Field>
    <Field label="Date (YYYY-MM-DD)"><Input accessibilityLabel="Expense date" value={date} onChangeText={setDate} placeholder={localDay()} maxLength={10} className="h-12" /></Field>
    <Button size="lg" disabled={busy || !walletId} onPress={() => { void save(); }}><Text>{busy ? 'Saving…' : expense ? 'Save changes' : 'Add expense'}</Text></Button>
    {expense && <View className="gap-3">{deleting ? <><Text className="text-sm">Delete “{expense.description}”? Its amount will be returned to the wallet balance.</Text><Button variant="destructive" disabled={busy} onPress={() => { void save(true); }}><Text>Confirm deletion</Text></Button><Button variant="outline" onPress={() => setDeleting(false)}><Text>Keep expense</Text></Button></> : <Button variant="ghost" disabled={busy} onPress={() => setDeleting(true)}><Text className="text-destructive">Delete expense</Text></Button>}</View>}
  </Sheet>;
}
export function WalletForm({ wallet, close }: { wallet?: Wallet; close: () => void }) {
  const { data, change } = useData();
  const [name, setName] = useState(wallet?.name ?? ''), [balance, setBalance] = useState(wallet ? decimal(wallet.opening_cents) : '0');
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [deleting, setDeleting] = useState(false);
  const save = async (remove = false) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await change(remove && wallet ? { name: 'delete_wallet', arguments: { id: wallet.id } }
        : wallet ? { name: 'update_wallet', arguments: { id: wallet.id, name, opening_balance: balance } } : { name: 'create_wallet', arguments: { name, opening_balance: balance } });
      close();
    } catch (e) { setError(userError(e, 'Could not save wallet.')); }
    finally { setBusy(false); }
  };
  return <Sheet title={wallet ? 'Edit wallet' : 'Create wallet'} close={busy ? () => undefined : close}>
    <ErrorNote message={error} />
    <Field label="Wallet name"><Input accessibilityLabel="Wallet name" value={name} onChangeText={setName} placeholder="Cash, GCash, or bank" maxLength={60} className="h-12" /></Field>
    <Field label={`Opening balance (${data?.currency})`}><Input accessibilityLabel="Opening balance" value={balance} onChangeText={setBalance} keyboardType="decimal-pad" placeholder="1000.00" className="h-12" /><Text className="text-sm leading-6 text-muted-foreground">The amount you had when you started tracking. Use Add money for new salary, allowance, or deposits.</Text></Field>
    <Button size="lg" disabled={busy} onPress={() => { void save(); }}><Text>{busy ? 'Saving…' : wallet ? 'Save wallet' : 'Create wallet'}</Text></Button>
    {wallet && (deleting ? <View className="gap-3"><Text>Delete “{wallet.name}”? Wallets containing expenses cannot be deleted.</Text><Button variant="destructive" disabled={busy} onPress={() => { void save(true); }}><Text>Confirm deletion</Text></Button><Button variant="outline" onPress={() => setDeleting(false)}><Text>Keep wallet</Text></Button></View> : <Button variant="ghost" onPress={() => setDeleting(true)}><Text className="text-destructive">Delete wallet</Text></Button>)}
  </Sheet>;
}
