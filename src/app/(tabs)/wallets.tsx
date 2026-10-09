import { useState } from 'react';
import { View } from 'react-native';
import { Plus, Wallet as WalletIcon } from 'lucide-react-native';
import { Screen, Empty } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Card, CardContent } from '@/components/ui/card';
import { WalletForm } from '@/components/forms';
import { useData } from '@/data/provider';
import type { Wallet } from '@/data/repository';
import { money } from '@/lib/money';

export default function Wallets() {
  const { data } = useData();
  const [editing, setEditing] = useState<Wallet | 'new' | null>(null);
  return (
    <>
      <Screen
        title="Your wallets"
        subtitle="Know where your money is."
        action={
          <Button
            size="icon"
            accessibilityLabel="Create wallet"
            onPress={() => setEditing('new')}
          >
            <Plus
              color="white"
              size={20}
            />
          </Button>
        }
      >
        {!data?.wallets.length && (
          <Empty
            title="Give your money a home"
            detail="Add Cash, GCash, or a bank wallet with its current opening balance."
            action={
              <Button onPress={() => setEditing('new')}>
                <Text>Create first wallet</Text>
              </Button>
            }
          />
        )}
        {data?.wallets.map((w) => (
          <Card
            key={w.id}
            className="gap-0 py-5"
          >
            <CardContent className="gap-4">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <WalletIcon
                    size={20}
                    color="#176b50"
                  />
                  <Text className="text-lg font-semibold">{w.name}</Text>
                </View>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => setEditing(w)}
                >
                  <Text>Edit</Text>
                </Button>
              </View>
              <Text className="text-3xl font-bold">
                {money(w.balance_cents, data.currency)}
              </Text>
              <View className="gap-1">
                <Text className="text-xs text-muted-foreground">
                  Opening {money(w.opening_cents, data.currency)}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  Received {money(w.income_cents, data.currency)}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  Spent {money(w.spent_cents, data.currency)}
                </Text>
              </View>
              {w.balance_cents < 0 && (
                <Text className="text-xs text-destructive">
                  Recorded spending exceeds the money available.
                </Text>
              )}
            </CardContent>
          </Card>
        ))}
      </Screen>
      {editing && (
        <WalletForm
          wallet={editing === 'new' ? undefined : editing}
          close={() => setEditing(null)}
        />
      )}
    </>
  );
}
