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
  const [draft, setDraft] = useState({
    saved: ai.settings,
    value: ai.settings,
  });
  const { provider, baseUrl, model } =
    draft.saved === ai.settings ? draft.value : ai.settings;
  const updateDraft = (patch: Partial<OnlineSettings>) =>
    setDraft((previous) => ({
      saved: ai.settings,
      value: {
        ...(previous.saved === ai.settings ? previous.value : ai.settings),
        ...patch,
      },
    }));
  const [apiKey, setApiKey] = useState(''),
    [notice, setNotice] = useState('');
  const disabled =
    ai.status === 'loading' || ai.status === 'thinking' || !!ai.pending;
  const choose = (value: OnlineSettings['provider']) => {
    setApiKey('');
    setNotice('');
    updateDraft({
      provider: value,
      baseUrl:
        value === 'openrouter' ? OPENROUTER_URL : 'https://api.openai.com/v1',
      model: '',
    });
  };
  const saveKey = async () => {
    setNotice('');
    if (await ai.saveKey({ provider, baseUrl, apiKey })) {
      setApiKey('');
      setNotice('API key saved. Model selection is separate.');
    }
  };
  const saveModel = async () => {
    setNotice('');
    if (await ai.saveModel({ provider, baseUrl, model }))
      setNotice('Model saved. Your API key was kept.');
  };
  return (
    <Card className="gap-0 py-5">
      <CardContent className="gap-4">
        <View className="flex-row items-center gap-2">
          <Cloud
            color="#176b50"
            size={21}
          />
          <Text className="text-lg font-semibold">Online assistant</Text>
        </View>
        <Text className="text-sm leading-6 text-muted-foreground">
          Use OpenRouter or another OpenAI-compatible provider with tool
          calling. No download is needed. Provider pricing and limits apply.
        </Text>
        <View className="flex-row gap-2">
          <Button
            className="flex-1"
            variant={provider === 'openrouter' ? 'default' : 'outline'}
            disabled={disabled}
            onPress={() => choose('openrouter')}
          >
            <Text>OpenRouter</Text>
          </Button>
          <Button
            className="flex-1"
            variant={provider === 'compatible' ? 'default' : 'outline'}
            disabled={disabled}
            onPress={() => choose('compatible')}
          >
            <Text>Other provider</Text>
          </Button>
        </View>
        {provider === 'openrouter' ? (
          <Text
            selectable
            className="text-xs text-muted-foreground"
          >
            Get a key: openrouter.ai/keys · Choose a tool-capable model:
            openrouter.ai/models
          </Text>
        ) : (
          <View className="gap-2">
            <Text className="text-sm font-medium">HTTPS API base URL</Text>
            <Input
              accessibilityLabel="AI API base URL"
              value={baseUrl}
              onChangeText={(v) => {
                updateDraft({ baseUrl: v });
                setNotice('');
              }}
              placeholder="https://api.example.com/v1"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!disabled}
              maxLength={500}
              className="h-12"
            />
            <Text className="text-xs text-muted-foreground">
              The key and model must belong to this endpoint.
            </Text>
          </View>
        )}
        <View className="gap-3 rounded-xl bg-muted p-4">
          <Text className="font-semibold">API key</Text>
          <Input
            accessibilityLabel="AI provider API key"
            value={apiKey}
            onChangeText={(v) => {
              setApiKey(v);
              setNotice('');
            }}
            placeholder={
              ai.hasKey
                ? 'A key is saved · paste to replace'
                : 'Paste your provider API key'
            }
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            editable={!disabled}
            maxLength={1024}
            className="h-12"
          />
          <Button
            disabled={disabled || !apiKey.trim()}
            onPress={() => {
              void saveKey();
            }}
          >
            <Text>Save API key</Text>
          </Button>
          <Text className="text-xs leading-5 text-muted-foreground">
            {Platform.OS === 'web'
              ? 'Browser keys stay in this tab’s memory and clear on reload.'
              : 'Your key is encrypted in device secure storage, separate from the expense database.'}{' '}
            Saving a key does not make an API request.
          </Text>
          {ai.hasKey && (
            <Button
              variant="outline"
              disabled={disabled}
              onPress={() => {
                setApiKey('');
                setNotice('');
                void ai.disconnect();
              }}
            >
              <Text>Remove saved key</Text>
            </Button>
          )}
        </View>
        <View className="gap-3 rounded-xl bg-muted p-4">
          <Text className="font-semibold">Model</Text>
          <Input
            accessibilityLabel="AI model ID"
            value={model}
            onChangeText={(v) => {
              updateDraft({ model: v });
              setNotice('');
            }}
            placeholder="Exact model ID from your provider"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
            maxLength={150}
            className="h-12"
          />
          <Button
            disabled={disabled || !model.trim()}
            onPress={() => {
              void saveModel();
            }}
          >
            <Text>Save model</Text>
          </Button>
          <Text className="text-xs leading-5 text-muted-foreground">
            Change models without entering your key again. The selected model
            stays saved when you remove the key.
          </Text>
        </View>
        <Text className="text-xs leading-5 text-muted-foreground">
          Messages and relevant wallet, income, expense, and schedule details go
          to this provider. Every change needs your review.
        </Text>
        <Text className="text-sm text-muted-foreground">
          Selected: {ai.settings.model || 'Choose a model'} ·{' '}
          {ai.status === 'ready'
            ? 'Ready to chat'
            : ai.status === 'loading'
              ? 'Working…'
              : ai.status === 'thinking'
                ? 'Thinking…'
                : 'Save a matching key and model'}
        </Text>
        <Button
          variant="outline"
          disabled={disabled || ai.status !== 'ready'}
          onPress={() => {
            setNotice('');
            void ai.testModel().then((ok) => {
              if (ok) setNotice('Connection tested successfully.');
            });
          }}
        >
          <Text>Test saved model</Text>
        </Button>
        <Text className="text-xs text-muted-foreground">
          Testing sends one small request. Saving settings does not.
        </Text>
        {ai.status === 'loading' && (
          <Button
            variant="ghost"
            onPress={ai.cancel}
          >
            <Text>Cancel connection test</Text>
          </Button>
        )}
        {!!notice && (
          <Text
            accessibilityRole="alert"
            className="text-sm text-primary"
          >
            {notice}
          </Text>
        )}
        {ai.pending && (
          <Text className="text-sm text-muted-foreground">
            Review or cancel the pending change in Assistant before changing
            settings.
          </Text>
        )}
      </CardContent>
    </Card>
  );
}
