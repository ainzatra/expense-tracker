import { validateCredentials, type OnlineCredentials } from './online';

// Browser keys stay in memory; do not persist them in localStorage or SQLite.
let credentials: OnlineCredentials | null = null;
export async function readCredentials() { return credentials; }
export async function saveCredentials(value: OnlineCredentials) { credentials = validateCredentials(value); }
export async function clearCredentials() { credentials = null; }
