import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from './ui/text';
import { Button } from './ui/button';
import { useData } from '@/data/provider';

export function Screen({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { data, error, refresh } = useData();
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      className="flex-1 bg-background"
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-5 px-5 pb-8 pt-5"
      >
        <View className="mb-1 flex-row items-center justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-xs font-semibold uppercase tracking-[2px] text-primary">
              POCKET LEDGER
            </Text>
            <Text className="text-3xl font-bold tracking-tight">{title}</Text>
            {subtitle && (
              <Text className="text-sm text-muted-foreground">{subtitle}</Text>
            )}
          </View>
          {action}
        </View>
        {error ? (
          <View className="gap-3">
            <ErrorNote message={error} />
            <Button
              onPress={() => {
                void refresh().catch(() => undefined);
              }}
            >
              <Text>Retry</Text>
            </Button>
          </View>
        ) : !data ? (
          <ActivityIndicator color="#176b50" />
        ) : (
          children
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
export function ErrorNote({ message }: { message: string | null }) {
  return message ? (
    <View
      accessibilityRole="alert"
      className="rounded-xl border border-destructive/20 bg-destructive/5 p-3"
    >
      <Text className="text-sm text-destructive">{message}</Text>
    </View>
  ) : null;
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <View className="items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-10">
      <Text className="text-center text-lg font-semibold">{title}</Text>
      <Text className="text-center text-sm leading-6 text-muted-foreground">
        {detail}
      </Text>
      {action}
    </View>
  );
}
