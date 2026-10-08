import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Cpu, HardDrive, LockKeyhole } from 'lucide-react-native';
import { Screen, ErrorNote } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useData } from '@/data/provider';
import { useAi } from '@/lib/ai/provider';
import { CURRENCIES } from '@/lib/money';
import { userError } from '@/lib/errors';

export default function Settings() {
  const { data, change } = useData(), ai = useAi();
  const [category, setCategory] = useState(''), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const changeCurrency = async (currency: typeof CURRENCIES[number]) => {
    setError(null); setBusy(true);
    try { await change({ name: 'configure_tracking', arguments: { currency } }); } catch (e) { setError(userError(e, 'Could not change currency.')); }
    finally { setBusy(false); }
  };
  const addCategory = async () => {
    setError(null); setBusy(true);
    try { await change({ name: 'create_category', arguments: { name: category } }); setCategory(''); }
    catch (e) { setError(userError(e, 'Could not add category.')); }
    finally { setBusy(false); }
  };
  const modelBusy = ai.status === 'loading' || ai.status === 'thinking';
  return <Screen title="Make it yours" subtitle="Local by design. Simple by choice.">
    <ErrorNote message={error} /><ErrorNote message={ai.error} />
    <Card className="gap-0 py-5"><CardContent className="gap-4"><View className="flex-row items-center gap-2"><Cpu color="#176b50" size={21} /><Text className="text-lg font-semibold">On-device assistant</Text></View>
      <Text className="text-sm leading-6 text-muted-foreground">For your Vivo V40 (12 GB RAM), start with Qwen2.5-1.5B-Instruct Q4_K_M in GGUF format. Download it separately and import the file here. Inference uses your phone’s CPU; no API key is needed.</Text>
      <View className="rounded-xl bg-muted p-3"><Text className="text-xs text-muted-foreground">MODEL</Text><Text className="mt-1 text-sm font-medium" numberOfLines={2}>{data?.modelName ?? 'No model imported'}</Text><Text className="mt-2 text-xs text-primary">{ai.status === 'ready' ? 'Loaded · Ready to chat' : ai.status === 'thinking' ? 'Processing your message' : ai.status === 'loading' ? 'Loading model…' : 'Not loaded'}</Text></View>
      {Platform.OS === 'web' ? <Text className="text-sm leading-6 text-muted-foreground">Local inference and model import require the Android development build.</Text> : <View className="gap-2"><Button disabled={modelBusy} onPress={() => { void ai.importModel(); }}><Text>{ai.status === 'loading' ? 'Loading…' : data?.modelPath ? 'Replace model file' : 'Import GGUF model'}</Text></Button>{data?.modelPath && (ai.status === 'ready' ? <Button variant="outline" disabled={modelBusy} onPress={() => { void ai.unload(); }}><Text>Unload to free memory</Text></Button> : <Button variant="outline" disabled={modelBusy} onPress={() => { void ai.loadSaved(); }}><Text>Load saved model</Text></Button>)}</View>}
      <Text className="text-xs leading-5 text-muted-foreground">A 1.5B 4-bit model is about 1 GB on disk and needs additional working memory. Speed and battery use must be measured on the phone. Load once per app session; unload when you’re done.</Text>
    </CardContent></Card>
    <Card className="gap-0 py-5"><CardContent className="gap-3"><Text className="text-lg font-semibold">Currency</Text><Text className="text-sm leading-6 text-muted-foreground">All wallets use {data?.currency}. Choose before creating your first wallet to avoid reinterpreting existing amounts.</Text><View className="flex-row flex-wrap gap-2">{CURRENCIES.map(c => <Button key={c} size="sm" disabled={busy || !!data?.wallets.length} variant={data?.currency === c ? 'default' : 'outline'} onPress={() => { void changeCurrency(c); }}><Text>{c}</Text></Button>)}</View></CardContent></Card>
    <Card className="gap-0 py-5"><CardContent className="gap-3"><Text className="text-lg font-semibold">Spending categories</Text><Text className="text-sm leading-6 text-muted-foreground">{data?.categories.map(c => c.name).join(' · ')}</Text><Input accessibilityLabel="New category name" value={category} onChangeText={setCategory} placeholder="Add a category, e.g. Travel" maxLength={60} className="h-12" /><Button variant="outline" disabled={busy || !category.trim()} onPress={() => { void addCategory(); }}><Text>Add category</Text></Button></CardContent></Card>
    <View className="gap-3 px-1"><View className="flex-row items-center gap-2"><HardDrive color="#66736d" size={17} /><Text className="text-sm text-muted-foreground">Expenses live in SQLite on this device.</Text></View><View className="flex-row items-start gap-2"><LockKeyhole color="#66736d" size={17} /><Text className="flex-1 text-sm leading-6 text-muted-foreground">No account, server, or cloud AI. Chat history lasts for this app session. Uninstalling removes local data; backup/export is not implemented yet.</Text></View></View>
  </Screen>;
}
