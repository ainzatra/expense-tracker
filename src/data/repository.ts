import type { SqlClient } from './schema';
import { isWrite, toolSchema, type ToolCall, type WriteCall } from './tools';
import { decimal, localDay, money, toCents } from '../lib/money';
import { occurrenceDate, type Frequency } from '../lib/recurrence';
import type { OnlineSettings } from '../lib/ai/online';

export type Wallet = { id: number; name: string; opening_cents: number; spent_cents: number; income_cents: number; balance_cents: number };
export type Category = { id: number; name: string };
export type Expense = { id: number; wallet_id: number; category_id: number; amount_cents: number; description: string; date: string; wallet_name: string; category_name: string };
export type Income = { id: number; wallet_id: number; amount_cents: number; source: string; description: string; date: string; wallet_name: string; recurring_id: number | null };
export type Recurring = { id: number; kind: 'income' | 'expense'; wallet_id: number; category_id: number | null; source: string | null; amount_cents: number; description: string; start_date: string; frequency: Frequency; end_date: string | null; next_index: number; enabled: number; wallet_name: string; category_name: string | null; next_date: string | null; due: boolean };
export type Snapshot = { currency: string; revision: number; wallets: Wallet[]; categories: Category[]; expenses: Expense[]; expenseCount: number; incomes: Income[]; incomeCount: number; recurring: Recurring[]; modelPath: string | null; modelName: string | null };
export type Proposal = { call: WriteCall; revision: number; title: string; details: string[]; destructive: boolean };

const expenseSelect = `SELECT e.*, w.name wallet_name, c.name category_name FROM expenses e JOIN wallets w ON w.id=e.wallet_id JOIN categories c ON c.id=e.category_id`;
const incomeSelect = `SELECT e.*, w.name wallet_name FROM incomes e JOIN wallets w ON w.id=e.wallet_id`;

export class Repository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private db: SqlClient, private today = localDay) {}

  // Every database operation is serialized on one connection. Reviewed writes
  // recheck their revision inside the transaction, so stale proposals cannot overwrite edits.
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async setting(key: string) { return (await this.db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', key))?.value ?? null; }
  private async wallets() {
    return this.db.getAllAsync<Wallet>(`SELECT w.*,
      COALESCE((SELECT SUM(amount_cents) FROM expenses WHERE wallet_id=w.id),0) spent_cents,
      COALESCE((SELECT SUM(amount_cents) FROM incomes WHERE wallet_id=w.id),0) income_cents,
      w.opening_cents+COALESCE((SELECT SUM(amount_cents) FROM incomes WHERE wallet_id=w.id),0)-COALESCE((SELECT SUM(amount_cents) FROM expenses WHERE wallet_id=w.id),0) balance_cents FROM wallets w ORDER BY w.id`);
  }
  private async schedules() {
    const rows = await this.db.getAllAsync<Recurring>('SELECT r.*,w.name wallet_name,c.name category_name FROM recurring r JOIN wallets w ON w.id=r.wallet_id LEFT JOIN categories c ON c.id=r.category_id ORDER BY r.id');
    return rows.map(row => {
      const next = occurrenceDate(row.start_date, row.next_index, row.frequency);
      const next_date = row.end_date && next > row.end_date ? null : next;
      return { ...row, next_date, due: !!row.enabled && !!next_date && next_date <= this.today() };
    });
  }
  getAiSettings(): Promise<OnlineSettings | null> {
    return this.serial(async () => { const value = await this.setting('online_ai'); return value ? JSON.parse(value) as OnlineSettings : null; });
  }
  saveAiSettings(settings: OnlineSettings) {
    // Explicit projection keeps API keys out of SQLite even if the caller has credentials.
    const value = JSON.stringify({ provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model });
    return this.serial(() => this.db.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'online_ai', value));
  }
  snapshot() {
    return this.serial(async (): Promise<Snapshot> => ({
      currency: await this.setting('currency') ?? 'PHP', revision: Number(await this.setting('revision')),
      wallets: await this.wallets(), categories: await this.db.getAllAsync<Category>('SELECT * FROM categories ORDER BY id'),
      expenses: await this.db.getAllAsync<Expense>(`${expenseSelect} ORDER BY e.date DESC,e.id DESC LIMIT 100`),
      expenseCount: (await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM expenses'))!.n,
      incomes: await this.db.getAllAsync<Income>(`${incomeSelect} ORDER BY e.date DESC,e.id DESC LIMIT 100`),
      incomeCount: (await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM incomes'))!.n,
      recurring: await this.schedules(),
      modelPath: await this.setting('model_path'), modelName: await this.setting('model_name'),
    }));
  }
  saveModel(path: string, name: string) {
    return this.serial(() => this.db.withTransactionAsync(async () => {
      await this.db.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'model_path', path);
      await this.db.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'model_name', name);
    }));
  }
  clearModel() {
    return this.serial(() => this.db.runAsync("DELETE FROM settings WHERE key IN ('model_path','model_name')"));
  }
  async read(input: ToolCall): Promise<unknown> {
    const call = toolSchema.parse(input);
    if (isWrite(call)) throw new Error('Changes require a reviewed proposal.');
    return this.serial(async () => {
      if (call.name === 'list_wallets') return { currency: await this.setting('currency'), wallets: await this.wallets() };
      if (call.name === 'list_recurring') return { recurring: await this.schedules() };
      const a = call.arguments;
      if (a.start && a.end && a.start > a.end) throw new Error('Start date must precede end date.');
      const clauses: string[] = [], params: (number | string)[] = [];
      if (a.start) { clauses.push('e.date>=?'); params.push(a.start); }
      if (a.end) { clauses.push('e.date<=?'); params.push(a.end); }
      if ('wallet_id' in a && a.wallet_id) { clauses.push('e.wallet_id=?'); params.push(a.wallet_id); }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const table = call.name === 'list_incomes' ? 'incomes' : 'expenses';
      const total = await this.db.getFirstAsync<{ count: number; total_cents: number }>(`SELECT COUNT(*) count,COALESCE(SUM(e.amount_cents),0) total_cents FROM ${table} e${where}`, ...params);
      if (call.name === 'get_summary') {
        const income = await this.db.getFirstAsync<{ income_count: number; income_cents: number }>(`SELECT COUNT(*) income_count,COALESCE(SUM(e.amount_cents),0) income_cents FROM incomes e${where}`, ...params);
        return {
        ...total, currency: await this.setting('currency'),
        ...income, net_cents: (income?.income_cents ?? 0) - (total?.total_cents ?? 0),
        categories: await this.db.getAllAsync<{ name: string; total_cents: number }>(`SELECT c.name, SUM(e.amount_cents) total_cents FROM expenses e JOIN categories c ON c.id=e.category_id${where} GROUP BY c.id ORDER BY total_cents DESC`, ...params),
        income_sources: await this.db.getAllAsync<{ source: string; total_cents: number }>(`SELECT source,SUM(amount_cents) total_cents FROM incomes e${where} GROUP BY source ORDER BY total_cents DESC`, ...params),
      }; }
      const { limit = 30, offset = 0 } = call.arguments;
      const rows = await this.db.getAllAsync(`${table === 'incomes' ? incomeSelect : expenseSelect}${where} ORDER BY e.date DESC,e.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
      return { ...total, limit, offset, currency: await this.setting('currency'), [table]: rows };
    });
  }
  private async mustExist(table: 'wallets' | 'categories' | 'expenses' | 'incomes' | 'recurring', id: number) {
    const row = await this.db.getFirstAsync<{ id: number; name?: string; description?: string }>(`SELECT * FROM ${table} WHERE id=?`, id);
    if (!row) throw new Error(`${({ expenses: 'Expense', wallets: 'Wallet', categories: 'Category', incomes: 'Income', recurring: 'Schedule' })[table]} no longer exists.`);
    return row;
  }
  private async inspect(call: WriteCall): Promise<Omit<Proposal, 'revision' | 'call'>> {
    const currency = await this.setting('currency') ?? 'PHP';
    switch (call.name) {
      case 'configure_tracking': {
        const count = await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM wallets');
        if (count!.n && call.arguments.currency !== currency) throw new Error('Currency cannot change after wallets are created. Existing amounts must keep their currency.');
        return { title: 'Set tracking currency', details: [call.arguments.currency], destructive: false };
      }
      case 'create_wallet': case 'update_wallet': {
        const a = call.arguments, cents = toCents(a.opening_balance, true);
        if ('id' in a) await this.mustExist('wallets', a.id);
        const duplicate = await this.db.getFirstAsync<{ id: number }>('SELECT id FROM wallets WHERE name=? COLLATE NOCASE', a.name);
        if (duplicate && (!('id' in a) || a.id !== duplicate.id)) throw new Error('A wallet with this name already exists.');
        return { title: call.name === 'create_wallet' ? 'Create wallet' : 'Update wallet', details: [a.name, `Opening balance: ${money(cents, currency)}`], destructive: false };
      }
      case 'create_category': {
        if (await this.db.getFirstAsync('SELECT id FROM categories WHERE name=? COLLATE NOCASE', call.arguments.name)) throw new Error('This category already exists.');
        return { title: 'Create category', details: [call.arguments.name], destructive: false };
      }
      case 'delete_wallet': {
        const w = await this.mustExist('wallets', call.arguments.id);
        if (await this.db.getFirstAsync('SELECT id FROM expenses WHERE wallet_id=? LIMIT 1', w.id)) throw new Error('This wallet has expenses. Move or delete them before deleting the wallet.');
        if (await this.db.getFirstAsync('SELECT id FROM incomes WHERE wallet_id=? LIMIT 1', w.id)) throw new Error('This wallet has income. Move or delete it before deleting the wallet.');
        if (await this.db.getFirstAsync('SELECT id FROM recurring WHERE wallet_id=? LIMIT 1', w.id)) throw new Error('This wallet has recurring schedules. Move or delete them before deleting the wallet.');
        return { title: 'Delete wallet', details: [w.name!], destructive: true };
      }
      case 'create_expense': case 'update_expense': {
        const a = call.arguments, cents = toCents(a.amount);
        if ('id' in a) await this.mustExist('expenses', a.id);
        const w = await this.mustExist('wallets', a.wallet_id), c = await this.mustExist('categories', a.category_id);
        return { title: call.name === 'create_expense' ? 'Add expense' : 'Update expense', details: [a.description, `${money(cents, currency)} · ${w.name}`, `${c.name} · ${a.date}`], destructive: false };
      }
      case 'delete_expense': {
        const e = await this.db.getFirstAsync<Expense>(`${expenseSelect} WHERE e.id=?`, call.arguments.id);
        if (!e) throw new Error('Expense no longer exists.');
        return { title: 'Delete expense', details: [e.description, `${money(e.amount_cents, currency)} · ${e.wallet_name}`, e.date], destructive: true };
      }
      case 'create_income': case 'update_income': {
        const a = call.arguments, cents = toCents(a.amount);
        if ('id' in a) await this.mustExist('incomes', a.id);
        const w = await this.mustExist('wallets', a.wallet_id);
        return { title: call.name === 'create_income' ? 'Add income' : 'Update income', details: [a.description, `+${money(cents, currency)} · ${w.name}`, `${a.source} · ${a.date}`], destructive: false };
      }
      case 'delete_income': {
        const income = await this.db.getFirstAsync<Income>(`${incomeSelect} WHERE e.id=?`, call.arguments.id);
        if (!income) throw new Error('Income no longer exists.');
        return { title: 'Delete income', details: [income.description, `Remove ${money(income.amount_cents, currency)} from ${income.wallet_name}`, income.date], destructive: true };
      }
      case 'create_recurring': case 'update_recurring': {
        const a = call.arguments, cents = toCents(a.amount);
        const w = await this.mustExist('wallets', a.wallet_id);
        if (a.end_date && a.end_date < a.start_date) throw new Error('The schedule end date must not precede its start date.');
        if (a.kind === 'expense') {
          if (!a.category_id || a.source !== null) throw new Error('A recurring bill needs a category and source must be null.');
          await this.mustExist('categories', a.category_id);
        } else if (!a.source || a.category_id !== null) throw new Error('A recurring deposit needs a source and category must be null.');
        if ('id' in a) {
          const old = await this.db.getFirstAsync<Recurring>('SELECT * FROM recurring WHERE id=?', a.id);
          if (!old) throw new Error('Schedule no longer exists.');
          if (old.next_index > 0 && (old.start_date !== a.start_date || old.frequency !== a.frequency || old.kind !== a.kind)) throw new Error('Start date, frequency, and kind cannot change after an occurrence was handled. Create a new schedule instead.');
        }
        return { title: call.name === 'create_recurring' ? 'Create recurring schedule' : 'Update recurring schedule', details: [a.description, `${a.kind === 'income' ? '+' : '-'}${money(cents, currency)} · ${w.name}`, `${a.frequency} from ${a.start_date}${a.end_date ? ` through ${a.end_date}` : ''}`, 'Due entries need confirmation. Creating a schedule does not record a payment.'], destructive: false };
      }
      case 'set_recurring_enabled': case 'delete_recurring': {
        const rule = await this.mustExist('recurring', call.arguments.id);
        return { title: call.name === 'delete_recurring' ? 'Delete recurring schedule' : call.arguments.enabled ? 'Resume schedule' : 'Pause schedule', details: [rule.description!, 'Previously recorded transactions stay in your history.'], destructive: call.name === 'delete_recurring' };
      }
      case 'post_recurring': case 'skip_recurring': {
        const rule = (await this.schedules()).find(r => r.id === call.arguments.id);
        if (!rule) throw new Error('Schedule no longer exists.');
        if (!rule.due || rule.next_date !== call.arguments.date) throw new Error('Only the next enabled, due occurrence can be recorded or skipped. Refresh the schedule.');
        if (await this.db.getFirstAsync('SELECT date FROM recurring_occurrences WHERE recurring_id=? AND date=?', rule.id, call.arguments.date)) throw new Error('This occurrence was already handled.');
        return { title: call.name === 'skip_recurring' ? 'Skip due occurrence' : rule.kind === 'income' ? 'Record received deposit' : 'Record paid bill',
          details: [rule.description, `${rule.kind === 'income' ? '+' : '-'}${money(rule.amount_cents, currency)} · ${rule.wallet_name}`, call.arguments.date,
            call.name === 'skip_recurring' ? 'No balance change.' : 'Only records this transaction; no bank transfer or bill payment is made.'], destructive: call.name === 'skip_recurring' };
      }
    }
  }
  propose(input: WriteCall) {
    const call = toolSchema.parse(input);
    if (!isWrite(call)) throw new Error('This is a read operation.');
    return this.serial(async (): Promise<Proposal> => ({ call, revision: Number(await this.setting('revision')), ...await this.inspect(call) }));
  }
  apply(proposal: Proposal) {
    return this.serial(async () => {
      let result = '';
      await this.db.withTransactionAsync(async () => {
        if (Number(await this.setting('revision')) !== proposal.revision) throw new Error('Your data changed since this proposal. Review the updated details and try again.');
        const call = toolSchema.parse(proposal.call);
        if (!isWrite(call)) throw new Error('Expected a change.');
        const preview = await this.inspect(call);
        switch (call.name) {
          case 'configure_tracking': await this.db.runAsync("UPDATE settings SET value=? WHERE key='currency'", call.arguments.currency); break;
          case 'create_wallet': await this.db.runAsync('INSERT INTO wallets (name,opening_cents) VALUES (?,?)', call.arguments.name, toCents(call.arguments.opening_balance, true)); break;
          case 'update_wallet': await this.db.runAsync('UPDATE wallets SET name=?,opening_cents=? WHERE id=?', call.arguments.name, toCents(call.arguments.opening_balance, true), call.arguments.id); break;
          case 'delete_wallet': await this.db.runAsync('DELETE FROM wallets WHERE id=?', call.arguments.id); break;
          case 'create_category': await this.db.runAsync('INSERT INTO categories (name) VALUES (?)', call.arguments.name); break;
          case 'create_expense': {
            const a = call.arguments;
            await this.db.runAsync('INSERT INTO expenses (wallet_id,category_id,amount_cents,description,date) VALUES (?,?,?,?,?)', a.wallet_id, a.category_id, toCents(a.amount), a.description, a.date); break;
          }
          case 'update_expense': {
            const a = call.arguments;
            await this.db.runAsync('UPDATE expenses SET wallet_id=?,category_id=?,amount_cents=?,description=?,date=? WHERE id=?', a.wallet_id, a.category_id, toCents(a.amount), a.description, a.date, a.id); break;
          }
          case 'delete_expense': await this.db.runAsync('DELETE FROM expenses WHERE id=?', call.arguments.id); break;
          case 'create_income': {
            const a = call.arguments;
            await this.db.runAsync('INSERT INTO incomes (wallet_id,amount_cents,source,description,date) VALUES (?,?,?,?,?)', a.wallet_id, toCents(a.amount), a.source, a.description, a.date); break;
          }
          case 'update_income': {
            const a = call.arguments;
            await this.db.runAsync('UPDATE incomes SET wallet_id=?,amount_cents=?,source=?,description=?,date=? WHERE id=?', a.wallet_id, toCents(a.amount), a.source, a.description, a.date, a.id); break;
          }
          case 'delete_income': await this.db.runAsync('DELETE FROM incomes WHERE id=?', call.arguments.id); break;
          case 'create_recurring': case 'update_recurring': {
            const a = call.arguments;
            const params = [a.kind, a.wallet_id, a.category_id, a.source, toCents(a.amount), a.description, a.start_date, a.frequency, a.end_date];
            if ('id' in a) await this.db.runAsync('UPDATE recurring SET kind=?,wallet_id=?,category_id=?,source=?,amount_cents=?,description=?,start_date=?,frequency=?,end_date=? WHERE id=?', ...params, a.id);
            else await this.db.runAsync('INSERT INTO recurring (kind,wallet_id,category_id,source,amount_cents,description,start_date,frequency,end_date) VALUES (?,?,?,?,?,?,?,?,?)', ...params);
            break;
          }
          case 'set_recurring_enabled': await this.db.runAsync('UPDATE recurring SET enabled=? WHERE id=?', call.arguments.enabled ? 1 : 0, call.arguments.id); break;
          case 'delete_recurring': await this.db.runAsync('DELETE FROM recurring WHERE id=?', call.arguments.id); break;
          case 'post_recurring': case 'skip_recurring': {
            const a = call.arguments;
            const rule = (await this.db.getFirstAsync<Recurring>('SELECT * FROM recurring WHERE id=?', a.id))!;
            if (call.name === 'post_recurring') {
              if (rule.kind === 'income') await this.db.runAsync('INSERT INTO incomes (wallet_id,amount_cents,source,description,date,recurring_id) VALUES (?,?,?,?,?,?)', rule.wallet_id, rule.amount_cents, rule.source, rule.description, a.date, rule.id);
              else await this.db.runAsync('INSERT INTO expenses (wallet_id,category_id,amount_cents,description,date,recurring_id) VALUES (?,?,?,?,?,?)', rule.wallet_id, rule.category_id, rule.amount_cents, rule.description, a.date, rule.id);
            }
            await this.db.runAsync('INSERT INTO recurring_occurrences (recurring_id,date,status) VALUES (?,?,?)', rule.id, a.date, call.name === 'post_recurring' ? 'posted' : 'skipped');
            await this.db.runAsync('UPDATE recurring SET next_index=next_index+1 WHERE id=?', rule.id); break;
          }
        }
        await this.db.runAsync("UPDATE settings SET value=CAST(value AS INTEGER)+1 WHERE key='revision'");
        result = `${preview.title}: ${preview.details.join(' · ')}. Saved on this device.`;
      });
      return result;
    });
  }
}

export function walletArguments(w: Wallet) { return { id: w.id, name: w.name, opening_balance: decimal(w.opening_cents) }; }
export function expenseArguments(e: Expense) {
  return { id: e.id, wallet_id: e.wallet_id, category_id: e.category_id, amount: decimal(e.amount_cents), description: e.description, date: e.date };
}
