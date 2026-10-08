import type { SqlClient } from './schema';
import { isWrite, toolSchema, type ToolCall, type WriteCall } from './tools';
import { decimal, money, toCents } from '../lib/money';

export type Wallet = { id: number; name: string; opening_cents: number; spent_cents: number; balance_cents: number };
export type Category = { id: number; name: string };
export type Expense = { id: number; wallet_id: number; category_id: number; amount_cents: number; description: string; date: string; wallet_name: string; category_name: string };
export type Snapshot = { currency: string; revision: number; wallets: Wallet[]; categories: Category[]; expenses: Expense[]; expenseCount: number; modelPath: string | null; modelName: string | null };
export type Proposal = { call: WriteCall; revision: number; title: string; details: string[]; destructive: boolean };

const expenseSelect = `SELECT e.*, w.name wallet_name, c.name category_name FROM expenses e JOIN wallets w ON w.id=e.wallet_id JOIN categories c ON c.id=e.category_id`;

export class Repository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private db: SqlClient) {}

  // Every database operation is serialized on one connection. Reviewed writes
  // recheck their revision inside the transaction, so stale proposals cannot overwrite edits.
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async setting(key: string) { return (await this.db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', key))?.value ?? null; }
  private async wallets() {
    return this.db.getAllAsync<Wallet>(`SELECT w.*, COALESCE(SUM(e.amount_cents),0) spent_cents, w.opening_cents-COALESCE(SUM(e.amount_cents),0) balance_cents FROM wallets w LEFT JOIN expenses e ON w.id=e.wallet_id GROUP BY w.id ORDER BY w.id`);
  }
  snapshot() {
    return this.serial(async (): Promise<Snapshot> => ({
      currency: await this.setting('currency') ?? 'PHP', revision: Number(await this.setting('revision')),
      wallets: await this.wallets(), categories: await this.db.getAllAsync<Category>('SELECT * FROM categories ORDER BY id'),
      expenses: await this.db.getAllAsync<Expense>(`${expenseSelect} ORDER BY e.date DESC,e.id DESC LIMIT 100`),
      expenseCount: (await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM expenses'))!.n,
      modelPath: await this.setting('model_path'), modelName: await this.setting('model_name'),
    }));
  }
  saveModel(path: string, name: string) {
    return this.serial(() => this.db.withTransactionAsync(async () => {
      await this.db.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'model_path', path);
      await this.db.runAsync('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'model_name', name);
    }));
  }
  async read(input: ToolCall): Promise<unknown> {
    const call = toolSchema.parse(input);
    if (isWrite(call)) throw new Error('Changes require a reviewed proposal.');
    return this.serial(async () => {
      if (call.name === 'list_wallets') return { currency: await this.setting('currency'), wallets: await this.wallets() };
      const a = call.arguments;
      if (a.start && a.end && a.start > a.end) throw new Error('Start date must precede end date.');
      const clauses: string[] = [], params: (number | string)[] = [];
      if (a.start) { clauses.push('e.date>=?'); params.push(a.start); }
      if (a.end) { clauses.push('e.date<=?'); params.push(a.end); }
      if ('wallet_id' in a && a.wallet_id) { clauses.push('e.wallet_id=?'); params.push(a.wallet_id); }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const total = await this.db.getFirstAsync<{ count: number; total_cents: number }>(`SELECT COUNT(*) count,COALESCE(SUM(e.amount_cents),0) total_cents FROM expenses e${where}`, ...params);
      if (call.name === 'get_summary') return {
        ...total, currency: await this.setting('currency'),
        categories: await this.db.getAllAsync<{ name: string; total_cents: number }>(`SELECT c.name, SUM(e.amount_cents) total_cents FROM expenses e JOIN categories c ON c.id=e.category_id${where} GROUP BY c.id ORDER BY total_cents DESC`, ...params),
      };
      const { limit = 30, offset = 0 } = call.arguments;
      return { ...total, limit, offset, currency: await this.setting('currency'), expenses: await this.db.getAllAsync<Expense>(`${expenseSelect}${where} ORDER BY e.date DESC,e.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset) };
    });
  }
  private async mustExist(table: 'wallets' | 'categories' | 'expenses', id: number) {
    const row = await this.db.getFirstAsync<{ id: number; name?: string; description?: string }>(`SELECT * FROM ${table} WHERE id=?`, id);
    if (!row) throw new Error(`${table === 'expenses' ? 'Expense' : table === 'wallets' ? 'Wallet' : 'Category'} no longer exists.`);
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
