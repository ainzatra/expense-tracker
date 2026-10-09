import { Pressable, View } from 'react-native';
import { ArrowUpRight } from 'lucide-react-native';
import { Text } from './ui/text';
import { money } from '@/lib/money';
import type { Expense } from '@/data/repository';
export function ExpenseRow({
  expense: e,
  currency,
  onPress,
}: {
  expense: Expense;
  currency: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Edit ${e.description}, ${money(e.amount_cents, currency)}`}
      onPress={onPress}
      className="flex-row items-center gap-3 border-b border-border/50 py-4"
    >
      <View className="h-10 w-10 items-center justify-center rounded-xl bg-secondary">
        <ArrowUpRight
          color="#176b50"
          size={20}
        />
      </View>
      <View className="flex-1 gap-1">
        <Text
          numberOfLines={1}
          className="font-semibold"
        >
          {e.description}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {e.wallet_name} · {e.category_name}
        </Text>
        <Text className="text-xs text-muted-foreground">{e.date}</Text>
      </View>
      <Text className="font-semibold">−{money(e.amount_cents, currency)}</Text>
    </Pressable>
  );
}
