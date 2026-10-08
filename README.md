# Pocket Ledger

An Android-first, personal expense tracker with an on-device AI assistant. Built for a Vivo V40 (Snapdragon 7 Gen 3, 12 GB RAM). Typed messages are supported; voice input is not included.

## Stack

- Expo SDK 57, React Native 0.86, TypeScript, and Expo Router.
- NativeWind 4 with Tailwind CSS 3.
- React Native Reusables: shadcn-style Button, Text, Card, and Input components adapted for React Native. Upstream attribution is in `THIRD_PARTY_NOTICES.md`.
- `expo-sqlite`: local wallets, categories, expenses, and model preferences.
- `llama.rn` 0.12.9: local llama.cpp inference with a user-imported GGUF instruction model.

## Features

Create and edit wallets with opening balances; add, edit, and delete expenses; create categories; view monthly spending, category totals, and wallet balances. Expense history is paginated. Amounts are stored as integer minor units to avoid floating-point money errors. The default currency is PHP; change it before creating wallets. All wallets use one currency.

The assistant has tools to configure tracking, create/update/delete wallets, create categories, create/update/delete expenses, list wallets, query expenses, and summarize spending. Example messages:

- “Create a Cash wallet with 2000 pesos.”
- “Spent 250 on lunch from Cash.”
- “How much did I spend this month?”
- “Change my lunch expense from today to 300 pesos.”

Model output is constrained to JSON and validated with Zod. Every assistant write is shown as a proposal with the actual amount, wallet, and date. Applying it rechecks the data revision and performs a parameterized SQLite transaction. Invalid actions do not change data. Wallet deletion is blocked while it has expenses. The assistant handles one proposed change at a time and is instructed to ask for clarification; small-model understanding still needs device evaluation.

## Develop

Use Node.js 24 and npm:

```sh
# Node 24's proxy support is needed for llama.rn's verified native artifact downloader
# in proxy-based cloud environments. It is harmless on an ordinary local machine.
NODE_USE_ENV_PROXY=1 npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run build` exports JavaScript and assets for Android, iOS, and web; it does not produce an APK. The tests exercise real SQLite through Node's `node:sqlite`, including migrations, wallet/expense CRUD, balances, validation, stale proposals, and the agent tool loop with injected inference. They do not test an actual model or Android runtime.

### Android development build

`llama.rn` is a native module, so **Expo Go cannot run the AI assistant**. With Android Studio/SDK, Java, and an emulator or USB-connected device installed:

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

The included `eas.json` defines these profiles. No EAS build has been submitted and no APK is included. An Expo account is needed for cloud builds, but app use and local inference require no account or API key.

### Load the local model

1. Start with **Qwen2.5-1.5B-Instruct, Q4_K_M, GGUF** from a trusted model distributor, such as the official [Qwen GGUF repository](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF). Download the complete, single-file GGUF model to the phone. This app does not merge split GGUF files. A compatible 0.5B instruction model is a lighter alternative with weaker reasoning.
2. In the Android app, open **Settings → Import GGUF model**. The app verifies the GGUF header and copies the file into its private storage. Allow disk space for the original download, picker cache, persistent model, and working memory.
3. Once the model is loaded, open **Assistant**. After restarting the app, use **Load saved model**; model weights persist, native inference contexts do not.
4. Use **Unload to free memory** when finished. Generation can be stopped and is cancelled when the app goes into the background.

The initial inference configuration is CPU-only with four threads, a 4096-token context, and JSON-schema constrained output. GPU/NPU acceleration is disabled until tested on the Vivo V40; CPU inference already uses the phone's hardware. Neither inference speed, battery use, nor model accuracy has been measured on that device. If a model returns invalid or truncated output, the app reports it and makes no change.

## Data and limitations

SQLite and model files are local to the app. No cloud inference or app backend is configured. Android automatic backup is disabled. Chat history lasts only for the current app session. SQLite is not encrypted at the application layer. Uninstalling the app removes its local data; data export, backup, income tracking, transfers, recurring expenses, and multi-currency conversion are not implemented.

The web app supports manual tracking through SQLite WASM/OPFS. Its server must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`; Metro is configured to do so. Browser AI/model import is unavailable. A browser test verified wallet creation, expense creation/edit/deletion, balances after reload, and applied NativeWind styling.

## Cloud environment

Use the existing `/workspace/expense-tracker` checkout; do not create a worktree. The Expo user-state directory is linked from `~/.expo` to `/workspace/expo-user-state` because the home directory is read-only. Use `XDG_CACHE_HOME=/workspace/expo-cache` and `npm_config_cache=/tmp/npm-cache` for writable caches.

```sh
EXPO_OFFLINE=1 XDG_CACHE_HOME=/workspace/expo-cache npx expo start --web --localhost --port 8081
```

Add `CI=1` for noninteractive validation; omit it for live reload. The current policy blocks Expo's online compatibility service, so offline mode uses the SDK's bundled version data. Native artifacts use Node's supported proxy route with SHA-256 verification retained. Android SDK 36, build tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1, and Gradle 9.3.1 have been installed in workspace storage. Native prebuild and JavaScript export pass. The APK build currently needs Java 17 (the default Java 21 does not satisfy the React Native Gradle plugin's toolchain requirement); no APK or device inference has been verified yet.
