import { useState } from 'react';
import { View } from 'react-native';
import { useData } from '@/data/provider';
import type { Recurring } from '@/data/repository';
import { decimal, localDay } from '@/lib/money';
import { FREQUENCIES, type Frequency } from '@/lib/recurrence';
import { userError } from '@/lib/errors';
import { Sheet, Field } from './forms';
import { ErrorNote } from './screen';
import { Text } from './ui/text';
import { Input } from './ui/input';
import { Button } from './ui/button';

export function RecurringForm({
  rule,
  close,
}: {
  rule?: Recurring;
  close: () => void;
}) {
  const { data, change } = useData();
  const [kind, setKind] = useState<'income' | 'expense'>(
    rule?.kind ?? 'income',
  );
  const [amount, setAmount] = useState(rule ? decimal(rule.amount_cents) : ''),
    [description, setDescription] = useState(rule?.description ?? '');
  const [source, setSource] = useState(rule?.source ?? 'Salary'),
    [categoryId, setCategoryId] = useState(
      rule?.category_id ??
        data?.categories.find((c) => c.name === 'Bills')?.id ??
        0,
    );
  const [walletId, setWalletId] = useState(
    rule?.wallet_id ?? data?.wallets[0]?.id ?? 0,
  );
  const [start, setStart] = useState(rule?.start_date ?? localDay()),
    [end, setEnd] = useState(rule?.end_date ?? '');
  const [frequency, setFrequency] = useState<Frequency>(
    rule?.frequency ?? 'monthly',
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const anchored = !!rule?.next_index;
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const args = {
        kind,
        wallet_id: walletId,
        category_id: kind === 'expense' ? categoryId : null,
        source: kind === 'income' ? source : null,
        amount,
        description,
        start_date: start,
        end_date: end.trim() || null,
        frequency,
      };
      await change(
        rule
          ? { name: 'update_recurring', arguments: { ...args, id: rule.id } }
          : { name: 'create_recurring', arguments: args },
      );
      close();
    } catch (e) {
      setError(userError(e, 'Could not save schedule.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={rule ? 'Edit schedule' : 'Recurring deposit or bill'}
      close={busy ? () => undefined : close}
    >
      <ErrorNote message={error} />
      <View className="flex-row gap-2">
        <Button
          className="flex-1"
          disabled={anchored}
          variant={kind === 'income' ? 'default' : 'outline'}
          onPress={() => setKind('income')}
        >
          <Text>Deposit</Text>
        </Button>
        <Button
          className="flex-1"
          disabled={anchored}
          variant={kind === 'expense' ? 'default' : 'outline'}
          onPress={() => setKind('expense')}
        >
          <Text>Bill</Text>
        </Button>
      </View>
      <Field label="Description">
        <Input
          accessibilityLabel="Schedule description"
          value={description}
          onChangeText={setDescription}
          maxLength={200}
          placeholder={kind === 'income' ? 'Monthly salary' : 'Internet bill'}
          className="h-12"
        />
      </Field>
      <Field label={`Amount (${data?.currency})`}>
        <Input
          accessibilityLabel="Schedule amount"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="1500.00"
          className="h-12"
        />
      </Field>
      <Field label="Wallet">
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
      {kind === 'income' ? (
        <Field label="Income source">
          <Input
            accessibilityLabel="Schedule income source"
            value={source}
            onChangeText={setSource}
            maxLength={60}
            className="h-12"
          />
        </Field>
      ) : (
        <Field label="Category">
          <View className="flex-row flex-wrap gap-2">
            {data?.categories.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={categoryId === c.id ? 'default' : 'outline'}
                onPress={() => setCategoryId(c.id)}
              >
                <Text>{c.name}</Text>
              </Button>
            ))}
          </View>
        </Field>
      )}
      <Field label="Repeats">
        <View className="flex-row flex-wrap gap-2">
          {FREQUENCIES.map((f) => (
            <Button
              key={f}
              size="sm"
              disabled={anchored}
              variant={frequency === f ? 'default' : 'outline'}
              onPress={() => setFrequency(f)}
            >
              <Text>{f[0].toUpperCase() + f.slice(1)}</Text>
            </Button>
          ))}
        </View>
      </Field>
      <Field label="First due date (YYYY-MM-DD)">
        <Input
          accessibilityLabel="Schedule start date"
          value={start}
          onChangeText={setStart}
          editable={!anchored}
          maxLength={10}
          className="h-12"
        />
      </Field>
      <Field label="End date (optional)">
        <Input
          accessibilityLabel="Schedule end date"
          value={end}
          onChangeText={setEnd}
          maxLength={10}
          placeholder="No end date"
          className="h-12"
        />
      </Field>
      <Text className="text-sm leading-6 text-muted-foreground">
        Due entries appear for confirmation. Record a deposit after receiving it
        or a bill after paying it. This schedule does not move money or
        automatically change balances. Monthly dates near month end use the last
        available day.
      </Text>
      {anchored && (
        <Text className="text-xs text-muted-foreground">
          This schedule has handled entries. To change its type, start date, or
          frequency, create a new schedule.
        </Text>
      )}
      <Button
        disabled={busy || !walletId || !description.trim()}
        onPress={() => {
          void save();
        }}
      >
        <Text>{busy ? 'Saving…' : 'Save schedule'}</Text>
      </Button>
    </Sheet>
  );
}
