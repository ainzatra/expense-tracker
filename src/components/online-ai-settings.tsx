import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Cloud } from 'lucide-react-native';
import { useAi } from '@/lib/ai/provider';
import { OPENROUTER_URL, type OnlineSettings } from '@/lib/ai/online';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Text } from './ui/text';
import { Card, CardContent } from './ui/card';

export function OnlineAiSettings() {
  const ai = useAi();
  const [provider, setProvider] = useState<OnlineSettings['provider']>(ai.settings.provider);
  const [baseUrl, setBaseUrl] = useState(ai.settings.baseUrl), [model, setModel] = useState(ai.settings.model);
  const [apiKey, setApiKey] = useState(''), [saved, setSaved] = useState(false);
  const busy = ai.status === 'loading' || ai.status === 'thinking';
  const disabled = busy || !!ai.pending;
  const choose = (value: OnlineSettings['provider']) => {
    setProvider(value); setApiKey(''); setSaved(false);
    setBaseUrl(value === 'openrouter' ? OPENROUTER_URL : 'https://api.openai.com/v1');
    setModel('');
  };
  const connect = async () => {
    setSaved(false);
    const success = await ai.connect({ provider, baseUrl, model }, apiKey);
    if (success) { setApiKey(''); setSaved(true); }
  };
  const reuseKey = ai.hasKey && provider === ai.settings.provider && baseUrl.trim().replace(/\/+$/, '') === ai.settings.baseUrl;
  return <Card className="gap-0 py-5"><CardContent className="gap-4">
    <View className="flex-row items-center gap-2"><Cloud color="#176b50" size={21} /><Text className="text-lg font-semibold">Online assistant</Text></View>
    <Text className="text-sm leading-6 text-muted-foreground">Use OpenRouter or another OpenAI-compatible provider. No model download is needed. You supply your own API key; provider pricing and limits apply.</Text>
    <View className="flex-row gap-2">
      <Button className="flex-1" variant={provider === 'openrouter' ? 'default' : 'outline'} disabled={disabled} onPress={() => choose('openrouter')}><Text>OpenRouter</Text></Button>
      <Button className="flex-1" variant={provider === 'compatible' ? 'default' : 'outline'} disabled={disabled} onPress={() => choose('compatible')}><Text>Other provider</Text></Button>
    </View>
    {provider === 'openrouter' ? <Text selectable className="text-xs text-muted-foreground">Get a key: openrouter.ai/keys · Choose a model: openrouter.ai/models</Text> : <View className="gap-2"><Text className="text-sm font-medium">HTTPS API base URL</Text><Input accessibilityLabel="AI API base URL" value={baseUrl} onChangeText={v => { setBaseUrl(v); setSaved(false); }} placeholder="https://api.example.com/v1" autoCapitalize="none" autoCorrect={false} editable={!disabled} maxLength={500} className="h-12" /><Text className="text-xs text-muted-foreground">The provider must support chat completions and JSON responses. Changing the endpoint requires its own key.</Text></View>}
    <View className="gap-2"><Text className="text-sm font-medium">Model ID</Text><Input accessibilityLabel="AI model ID" value={model} onChangeText={v => { setModel(v); setSaved(false); }} placeholder="Copy the exact model ID from your provider" autoCapitalize="none" autoCorrect={false} editable={!disabled} maxLength={150} className="h-12" /></View>
    <View className="gap-2"><Text className="text-sm font-medium">API key</Text><Input accessibilityLabel="AI provider API key" value={apiKey} onChangeText={v => { setApiKey(v); setSaved(false); }} placeholder={reuseKey ? 'Saved securely · leave blank to keep' : 'Paste your provider API key'} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" editable={!disabled} maxLength={1024} className="h-12" /></View>
    <Text className="text-xs leading-5 text-muted-foreground">{Platform.OS === 'web' ? 'Browser keys stay in this tab’s memory and are cleared on reload.' : 'Your key is encrypted in device secure storage. It is not stored in the expense database.'} Messages and relevant wallet, category, and expense details are sent to the selected provider. Every change still needs your review.</Text>
    {ai.hasKey && <View className="rounded-xl bg-muted p-3"><Text className="text-xs text-muted-foreground">SAVED CONNECTION</Text><Text className="mt-1 text-sm font-medium">{ai.settings.provider === 'openrouter' ? 'OpenRouter' : 'Online provider'} · {ai.settings.model}</Text><Text className="mt-2 text-xs text-primary">Ready to chat in Assistant</Text></View>}
    {saved && <Text accessibilityRole="alert" className="text-sm text-primary">Connection tested and saved. You can open Assistant.</Text>}
    {ai.pending && <Text className="text-sm text-muted-foreground">Review or cancel the pending change in Assistant before changing providers.</Text>}
    <Button disabled={disabled || !model.trim() || (!apiKey.trim() && !reuseKey)} onPress={() => { void connect(); }}><Text>{ai.status === 'loading' ? 'Connecting…' : 'Save and test connection'}</Text></Button>
    <Text className="text-xs text-muted-foreground">Testing sends one small request using the selected model.</Text>
    {ai.status === 'loading' && <Button variant="ghost" onPress={ai.cancel}><Text>Cancel connection test</Text></Button>}
    {ai.hasKey && <Button variant="outline" disabled={disabled} onPress={() => { setApiKey(''); setSaved(false); void ai.disconnect(); }}><Text>Remove saved key</Text></Button>}
  </CardContent></Card>;
}
