import { useState } from 'react';
import { View } from 'react-native';
import { useData } from '@/data/provider';
import type { Income } from '@/data/repository';
import { decimal, localDay } from '@/lib/money';
import { userError } from '@/lib/errors';
import { Sheet, Field } from './forms';
import { ErrorNote } from './screen';
import { Text } from './ui/text';
import { Input } from './ui/input';
import { Button } from './ui/button';

export const INCOME_SOURCES = [
  'Salary',
  'Allowance',
  'Business',
  'Gift',
  'Other',
];
export function IncomeForm({
  income,
  close,
}: {
  income?: Income;
  close: () => void;
}) {
  const { data, change } = useData();
  const [amount, setAmount] = useState(
      income ? decimal(income.amount_cents) : '',
    ),
    [source, setSource] = useState(income?.source ?? 'Salary');
  const [description, setDescription] = useState(income?.description ?? ''),
    [date, setDate] = useState(income?.date ?? localDay());
  const [walletId, setWalletId] = useState(
    income?.wallet_id ?? data?.wallets[0]?.id ?? 0,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [deleting, setDeleting] = useState(false);
  const save = async (remove = false) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const args = {
        wallet_id: walletId,
        amount,
        source,
        description: description.trim() || source,
        date,
      };
      await change(
        remove && income
          ? { name: 'delete_income', arguments: { id: income.id } }
          : income
            ? { name: 'update_income', arguments: { ...args, id: income.id } }
            : { name: 'create_income', arguments: args },
      );
      close();
    } catch (e) {
      setError(userError(e, 'Could not save income.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={income ? 'Edit income' : 'Add money'}
      close={busy ? () => undefined : close}
    >
      <ErrorNote message={error} />
      <Field label={`Amount received (${data?.currency})`}>
        <Input
          accessibilityLabel="Income amount"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="5000.00"
          className="h-14 text-2xl"
        />
      </Field>
      <Field label="Income source">
        <View className="flex-row flex-wrap gap-2">
          {INCOME_SOURCES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={source === s ? 'default' : 'outline'}
              onPress={() => setSource(s)}
            >
              <Text>{s}</Text>
            </Button>
          ))}
        </View>
        <Input
          accessibilityLabel="Income source"
          value={source}
          onChangeText={setSource}
          maxLength={60}
          placeholder="Salary, allowance, or another source"
          className="h-12"
        />
      </Field>
      <Field label="Description (optional)">
        <Input
          accessibilityLabel="Income description"
          value={description}
          onChangeText={setDescription}
          maxLength={200}
          placeholder="October salary"
          className="h-12"
        />
      </Field>
      <Field label="Received into">
        <View className="flex-row flex-wrap gap-2">
          {data?.wallets.map((w) => (
            <Button
              key={w.id}
              variant={walletId === w.id ? 'default' : 'outline'}
              onPress={() => setWalletId(w.id)}
            >
              <Text>{w.name}</Text>
            </Button>
          ))}
        </View>
        {!data?.wallets.length && <Text>Create a wallet first.</Text>}
      </Field>
      <Field label="Date received (YYYY-MM-DD)">
        <Input
          accessibilityLabel="Income date"
          value={date}
          onChangeText={setDate}
          maxLength={10}
          className="h-12"
        />
      </Field>
      <Button
        size="lg"
        disabled={busy || !walletId}
        onPress={() => {
          void save();
        }}
      >
        <Text>{busy ? 'Saving…' : income ? 'Save income' : 'Add money'}</Text>
      </Button>
      {income &&
        (deleting ? (
          <View className="gap-2">
            <Text>
              Delete this income? Its amount will be removed from the wallet
              balance.
            </Text>
            <Button
              variant="destructive"
              disabled={busy}
              onPress={() => {
                void save(true);
              }}
            >
              <Text>Confirm income deletion</Text>
            </Button>
            <Button
              variant="outline"
              onPress={() => setDeleting(false)}
            >
              <Text>Keep income</Text>
            </Button>
          </View>
        ) : (
          <Button
            variant="ghost"
            onPress={() => setDeleting(true)}
          >
            <Text className="text-destructive">Delete income</Text>
          </Button>
        ))}
    </Sheet>
  );
}
