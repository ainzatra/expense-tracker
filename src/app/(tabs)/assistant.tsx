import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Send, Sparkles, ShieldCheck } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorNote } from '@/components/screen';
import { useAi } from '@/lib/ai/provider';

const examples = ['Create a Cash wallet with 2000 pesos', 'Spent 250 on lunch from Cash', 'How much did I spend this month?'];
export default function Assistant() {
  const ai = useAi(), [text, setText] = useState('');
  const scroll = useRef<ScrollView>(null);
  const ready = ai.status === 'ready';
  useEffect(() => { scroll.current?.scrollToEnd({ animated: true }); }, [ai.history.length, ai.pending]);
  const send = () => {
    if (!ready || ai.pending || !text.trim()) return;
    const value = text.trim(); setText(''); void ai.send(value);
  };
  return <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-background"><KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <View className="gap-1 border-b border-border px-5 py-5"><Text className="text-xs font-semibold uppercase tracking-[2px] text-primary">YOUR EXPENSE ASSISTANT</Text><Text className="text-3xl font-bold">Your money, in words.</Text><View className="mt-2 flex-row items-center gap-2"><ShieldCheck color="#176b50" size={15} /><Text className="flex-1 text-xs text-muted-foreground">{ai.hasKey ? `${ai.settings.provider === 'openrouter' ? 'OpenRouter' : 'Online AI'} · ${ai.settings.model}` : 'Connect an online provider in Settings'}</Text></View></View>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 p-5" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
      {!ai.history.length && <View className="gap-4 py-3"><View className="h-12 w-12 items-center justify-center rounded-2xl bg-secondary"><Sparkles size={23} color="#176b50" /></View><Text className="text-xl font-semibold">Just tell me what happened.</Text><Text className="text-sm leading-6 text-muted-foreground">I can set up wallets, record spending, find expenses, and propose changes. You review each change before it is saved.</Text>{examples.map(example => <Button key={example} variant="outline" className="h-auto justify-start py-3" onPress={() => setText(example)}><Text className="flex-1 text-sm">{example}</Text></Button>)}</View>}
      {ai.status === 'unloaded' && <Card className="gap-0 py-4"><CardContent className="gap-3"><Text className="font-semibold">Connect your AI provider</Text><Text className="text-sm leading-6 text-muted-foreground">Use OpenRouter or an OpenAI-compatible provider. No model download is needed. Manual tracking works without a connection.</Text><Button variant="secondary" onPress={() => router.push('/settings')}><Text>Open AI settings</Text></Button></CardContent></Card>}
      {ai.history.map(message => <View key={message.id} className={message.role === 'user' ? 'ml-8 rounded-2xl rounded-tr-sm bg-primary p-4' : 'mr-4 rounded-2xl rounded-tl-sm bg-card p-4'}><Text className={message.role === 'user' ? 'text-white leading-6' : 'leading-6'} selectable>{message.content}</Text></View>)}
      {ai.status === 'thinking' && <View className="flex-row items-center justify-between"><Text className="text-sm text-muted-foreground">Waiting for your AI provider…</Text><Button variant="ghost" onPress={ai.cancel}><Text>Stop</Text></Button></View>}
      <ErrorNote message={ai.error} />
      {ai.pending && <Card className="gap-0 border-primary/30 py-5"><CardContent className="gap-3"><Text className="text-xs font-semibold uppercase tracking-widest text-primary">REVIEW CHANGE</Text><Text className="text-xl font-bold">{ai.pending.title}</Text>{ai.pending.details.map((line, i) => <Text key={i} className="text-sm leading-6">{line}</Text>)}<View className="mt-2 flex-row gap-2"><Button className="flex-1" variant={ai.pending.destructive ? 'destructive' : 'default'} onPress={() => { void ai.confirm(); }}><Text>{ai.pending.destructive ? 'Confirm deletion' : 'Apply change'}</Text></Button><Button variant="outline" onPress={ai.dismiss}><Text>Cancel</Text></Button></View></CardContent></Card>}
    </ScrollView>
    <View className="gap-2 border-t border-border bg-card p-4"><View className="flex-row items-end gap-2"><Input accessibilityLabel="Message your expense assistant" placeholder={ready ? 'Tell me about an expense…' : 'Connect a provider to start chatting'} value={text} onChangeText={setText} multiline maxLength={1000} editable={ready && !ai.pending} className="max-h-32 min-h-12 flex-1 py-3" /><Button size="icon" className="h-12 w-12" accessibilityLabel="Send message" disabled={!ready || !!ai.pending || !text.trim()} onPress={send}><Send color="white" size={19} /></Button></View><Text className="text-center text-[10px] text-muted-foreground">Messages and relevant expense details go to your provider. Review every change.</Text></View>
  </KeyboardAvoidingView></SafeAreaView>;
}
