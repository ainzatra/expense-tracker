# Pocket Ledger

An Android-first personal expense tracker with an online AI assistant using OpenRouter or an OpenAI-compatible provider. Typed messages are supported; voice input is not included. No local model download, Codex service, or app backend is required.

## Stack

- Expo SDK 57, React Native 0.86, TypeScript, and Expo Router.
- NativeWind 4 with Tailwind CSS 3.
- React Native Reusables: shadcn-style Button, Text, Card, and Input components adapted for React Native. Upstream attribution is in `THIRD_PARTY_NOTICES.md`.
- `expo-sqlite`: local wallets, categories, expenses, income, and recurring schedules.
- LangChain (`@langchain/core` and `@langchain/openai`) native function calling through OpenRouter or a configurable OpenAI-compatible provider.
- `expo-secure-store`: encrypted provider credentials on Android/iOS; browser credentials are kept only in memory.

## Features

Create and edit wallets with opening balances; add, edit, and delete expenses; create categories; view monthly spending, category totals, and wallet balances. Income sources include salary, allowance, business, gifts, and custom sources. Received money increases the selected wallet balance without changing its opening balance. Income and expense history are paginated. Monthly summaries show spending, received income, and net change. Recurring deposits and bills support daily, weekly, monthly, and yearly schedules, optional end dates, edit, pause/resume, and deletion. Due entries wait for confirmation; nothing posts automatically or makes bank payments. Missed entries are handled oldest first, one at a time. Monthly dates clamp to month end without drifting from the original day. Deleting a schedule keeps previously recorded transactions. Amounts are stored as integer minor units to avoid floating-point money errors. The default currency is PHP; change it before creating wallets. All wallets use one currency.

The assistant has tools to configure tracking, create/update/delete wallets, create categories, create/update/delete expenses, create/update/delete income, manage recurring schedules, propose recording or skipping due occurrences, query wallet/expense/income/schedule data, and summarize spending and income. Example messages:

- “Create a Cash wallet with 2000 pesos.”
- “Spent 250 on lunch from Cash.”
- “Received 5000 salary in Cash.”
- “Schedule a monthly internet bill of 1500 from Cash starting 2026-10-08.”
- “I paid the due internet bill.”
- “How much did I receive and spend this month?”
- “Change my lunch expense from today to 300 pesos.”

Native function arguments are validated with Zod. LangChain preserves tool-call IDs and returns local read results to the model. Unknown or malformed actions, truncated responses, and batches containing writes are rejected. Every assistant write is shown as a proposal with the actual amount, wallet, and date. Applying it rechecks the data revision and performs a parameterized SQLite transaction. Invalid actions do not change data. Wallet deletion is blocked while it has expenses, income, or recurring schedules. The assistant handles one proposed change at a time and is instructed to ask for clarification; model accuracy depends on the selected provider/model.

## Develop

Use Node.js 24 and npm:

```sh
# Supported Node proxy routing for restricted cloud environments.
NODE_USE_ENV_PROXY=1 npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run build` exports JavaScript and assets for Android, iOS, and web; it does not produce an APK. The tests exercise real SQLite through Node's `node:sqlite`, including preserved v1 migration, wallet/expense/income CRUD, exact balances, date-clamped recurrence, confirmation and duplicate protection, pause/skip/end dates, validation, stale proposals, separate model/key storage, native LangChain requests and matching tool-call IDs, provider failures, and cancellation. Provider tests use injected HTTP responses; they do not claim a live model or physical Android runtime was tested.

### Android development build

Online AI uses standard Expo modules and works with a matching SDK 57 Expo Go installation. Start with `npx expo start` and reload the updated project; the old model-download screen belonged to version 1.0. For a native development build, use Android SDK, Java 17, and an emulator or USB-connected device:

```sh
npm run android
# For subsequent sessions with the development build installed:
npx expo start --dev-client
```

Expo prebuild generates ignored native directories from `app.json`; do not hand-edit them. The Android application ID is `com.ainzatra.expensetracker`.

Alternatively, build an installable APK with EAS after connecting your Expo account/project:

```sh
npx eas-cli@latest build --platform android --profile development
# Self-contained APK for personal use (does not need Metro):
npx eas-cli@latest build --platform android --profile preview
```

The included `eas.json` defines these profiles. EAS is optional; a local standalone APK can be built without an Expo account:

```sh
npx expo prebuild --platform android --no-install
cd android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The result is `android/app/build/outputs/apk/release/app-release.apk`. The generated release variant uses a development signing key for personal testing. Keep the same signing key for in-place updates; production/store releases need private signing. Generated native directories and APKs are not committed. Version 1.2 uses Android versionCode 3 and migrates the existing SQLite database without resetting wallets or expense history. Update the existing app with the same signing key; do not uninstall if you want to keep local data.

### Connect online AI

1. Create your own [OpenRouter API key](https://openrouter.ai/keys). Choose an exact model ID from [OpenRouter's model catalog](https://openrouter.ai/models), including a free model if available to your account. The model must support chat completions with function/tool calling; pricing and availability are controlled by the provider.
2. Open **Settings → Online assistant → OpenRouter**, enter the key, then choose **Save API key**. Independently enter the model ID and choose **Save model**. Either may be saved first. Neither makes an API request. Change models without re-entering the key. **Test saved model** optionally sends one small request using the saved selection; a failed test does not erase saved settings.
3. Open **Assistant** and describe your income, expense, or recurring schedule. Every write requires **Apply change** or **Confirm deletion** before SQLite changes.
4. For another provider, select **Other provider**, set its HTTPS API base URL (for example, `https://api.openai.com/v1`), model ID, and that provider's key. The app appends `/chat/completions`; changing the endpoint requires entering its own key.
5. **Remove saved key** deletes the app's credentials and clears the in-memory conversation, keeping the separately saved model selection. It does not revoke the key at the provider; revoke it in your provider account if needed.

The key is supplied in the app, never bundled in the APK, stored in SQLite, or included in prompts. Native API keys and provider endpoints are encrypted with Expo SecureStore; model preferences are stored separately in SQLite. Existing combined credentials migrate without losing their model choice. Browser keys stay only in memory and disappear on reload. Requests go directly over HTTPS to the selected provider; no app backend is used. Requests contain chat messages, wallet/category information, small recent expense/income snapshots and schedule details, and any query results needed by the agent. The API key is sent only as an authentication header. Provider privacy, retention, pricing, and usage limits apply. ChatGPT/Codex subscriptions do not pay for these requests.

The app supplies native tool schemas through LangChain and validates each returned action with Zod. Models returning malformed actions cannot alter the database. Requests can be stopped, time out after 60 seconds, and are cancelled when the app goes into the background. There are no automatic paid retries; a chat request can use up to six model calls when it needs read tools.

### Remove an old downloaded model

Version 1.1 no longer imports or runs local models. If version 1.0 imported one, **Settings → Previously imported model → Delete saved model** deletes only the private app copy at `documents/models/model-<timestamp>.gguf`, after confirmation. Wallets and expenses are retained. The original downloaded file remains in Downloads and can be removed separately in the phone's file manager. If you only downloaded a model without importing it, there is no app copy to delete. Expo Go keeps its project data in its own sandbox; use the same installation/project to access an old copy.

## Data and limitations

SQLite is local to the app; AI requests are sent to your chosen online provider. Android automatic backup is disabled. Chat history lasts only for the current app session. SQLite is not encrypted at the application layer. Uninstalling the app removes its local data; data export, backup, wallet transfers, background reminders, and multi-currency conversion are not implemented. Due schedules refresh on app foregrounding and while the app is open; there is no background posting.

The web app supports manual tracking through SQLite WASM/OPFS. Its server must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`; Metro is configured to do so. Online AI is available in the browser when the provider allows browser CORS requests; its key is not persisted. Browser checks verified wallet/expense CRUD and NativeWind styling, then the 1.2 flows for separate key/model saving without requests, LangChain-reviewed salary entry, manual allowance, bills awaiting confirmation, pause/resume, model changes without a new key, and SQLite balances after reload. Provider responses were intercepted test data. Lint, typecheck, 33 tests, all-platform exports, and the local ARM64 APK build passed. The APK uses versionCode 3 and the same development certificate as prior local releases.

## Cloud environment

Use the existing `/workspace/expense-tracker` checkout; do not create a worktree. The Expo user-state directory is linked from `~/.expo` to `/workspace/expo-user-state` because the home directory is read-only. Use `XDG_CACHE_HOME=/workspace/expo-cache` and `npm_config_cache=/tmp/npm-cache` for writable caches.

```sh
EXPO_NO_TYPESCRIPT_SETUP=1 EXPO_OFFLINE=1 XDG_CACHE_HOME=/workspace/expo-cache npx expo start --web --localhost --port 8081
```

Add `CI=1` for noninteractive validation; omit it for live reload. Offline Expo CLI mode uses the SDK's bundled compatibility data; it does not disable the app's provider requests. The workspace has Java 17, Android SDK 36/build-tools 36, NDK 27.1.12297006, CMake 3.22.1, and Gradle 9.3.1. Source `/workspace/toolchains/activate-android.sh` before local APK builds. No environment API key is needed: enter the personal provider key securely in the running app. Live provider inference and phone testing require your account/device and have not been verified here.
