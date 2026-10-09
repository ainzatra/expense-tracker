import { useState } from 'react';
import { Platform, View } from 'react-native';
import { HardDrive, LockKeyhole } from 'lucide-react-native';
import { Screen, ErrorNote } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useData } from '@/data/provider';
import { useAi } from '@/lib/ai/provider';
import { CURRENCIES } from '@/lib/money';
import { userError } from '@/lib/errors';
import { OnlineAiSettings } from '@/components/online-ai-settings';

export default function Settings() {
  const { data, change } = useData(),
    ai = useAi();
  const [category, setCategory] = useState(''),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [deletingModel, setDeletingModel] = useState(false);
  const changeCurrency = async (currency: (typeof CURRENCIES)[number]) => {
    setError(null);
    setBusy(true);
    try {
      await change({ name: 'configure_tracking', arguments: { currency } });
    } catch (e) {
      setError(userError(e, 'Could not change currency.'));
    } finally {
      setBusy(false);
    }
  };
  const addCategory = async () => {
    setError(null);
    setBusy(true);
    try {
      await change({ name: 'create_category', arguments: { name: category } });
      setCategory('');
    } catch (e) {
      setError(userError(e, 'Could not add category.'));
    } finally {
      setBusy(false);
    }
  };
  const modelBusy = ai.status === 'loading' || ai.status === 'thinking';
  return (
    <Screen
      title="Make it yours"
      subtitle="Your data on your phone. Your choice of AI."
    >
      <ErrorNote message={error} />
      <ErrorNote message={ai.error} />
      <OnlineAiSettings />
      {data?.modelPath && (
        <Card className="gap-0 py-5">
          <CardContent className="gap-3">
            <Text className="text-lg font-semibold">
              Previously imported model
            </Text>
            <Text className="text-sm font-medium">{data.modelName}</Text>
            <Text className="text-sm leading-6 text-muted-foreground">
              This copy lives in the app’s private documents/models folder.
              Online AI does not need it. Your original download remains in
              Downloads.
            </Text>
            {Platform.OS === 'web' ? (
              <Text className="text-sm text-muted-foreground">
                Remove this copy from the Android app.
              </Text>
            ) : deletingModel ? (
              <View className="gap-2">
                <Text className="text-sm">
                  Delete the saved model file to free disk space? Expenses and
                  wallets will stay.
                </Text>
                <Button
                  variant="destructive"
                  disabled={modelBusy}
                  onPress={() => {
                    void ai.deleteModel().then(() => setDeletingModel(false));
                  }}
                >
                  <Text>Confirm model deletion</Text>
                </Button>
                <Button
                  variant="outline"
                  disabled={modelBusy}
                  onPress={() => setDeletingModel(false)}
                >
                  <Text>Keep model</Text>
                </Button>
              </View>
            ) : (
              <Button
                variant="outline"
                disabled={modelBusy}
                onPress={() => setDeletingModel(true)}
              >
                <Text>Delete saved model</Text>
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      <Card className="gap-0 py-5">
        <CardContent className="gap-3">
          <Text className="text-lg font-semibold">Currency</Text>
          <Text className="text-sm leading-6 text-muted-foreground">
            All wallets use {data?.currency}. Choose before creating your first
            wallet to avoid reinterpreting existing amounts.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {CURRENCIES.map((c) => (
              <Button
                key={c}
                size="sm"
                disabled={busy || !!data?.wallets.length}
                variant={data?.currency === c ? 'default' : 'outline'}
                onPress={() => {
                  void changeCurrency(c);
                }}
              >
                <Text>{c}</Text>
              </Button>
            ))}
          </View>
        </CardContent>
      </Card>
      <Card className="gap-0 py-5">
        <CardContent className="gap-3">
          <Text className="text-lg font-semibold">Spending categories</Text>
          <Text className="text-sm leading-6 text-muted-foreground">
            {data?.categories.map((c) => c.name).join(' · ')}
          </Text>
          <Input
            accessibilityLabel="New category name"
            value={category}
            onChangeText={setCategory}
            placeholder="Add a category, e.g. Travel"
            maxLength={60}
            className="h-12"
          />
          <Button
            variant="outline"
            disabled={busy || !category.trim()}
            onPress={() => {
              void addCategory();
            }}
          >
            <Text>Add category</Text>
          </Button>
        </CardContent>
      </Card>
      <View className="gap-3 px-1">
        <View className="flex-row items-center gap-2">
          <HardDrive
            color="#66736d"
            size={17}
          />
          <Text className="text-sm text-muted-foreground">
            Expenses live in SQLite on this device.
          </Text>
        </View>
        <View className="flex-row items-start gap-2">
          <LockKeyhole
            color="#66736d"
            size={17}
          />
          <Text className="flex-1 text-sm leading-6 text-muted-foreground">
            Manual tracking works offline. AI needs internet and a provider key.
            Chat history lasts for this app session; providers may retain
            requests under their own policies. Uninstalling removes local data;
            backup/export is not implemented yet.
          </Text>
        </View>
      </View>
    </Screen>
  );
}
