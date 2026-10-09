import type { SqlClient } from './schema';
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import { createDatabase } from './database';
import * as t from './tables';
import { isWrite, toolSchema, type ToolCall, type WriteCall } from './tools';
import { decimal, localDay, money, toCents } from '../lib/money';
import { occurrenceDate, type Frequency } from '../lib/recurrence';
import type { OnlineSettings } from '../lib/ai/online';

export type Wallet = {
  id: number;
  name: string;
  opening_cents: number;
  spent_cents: number;
  income_cents: number;
  balance_cents: number;
};
export type Category = { id: number; name: string };
export type Expense = {
  id: number;
  wallet_id: number;
  category_id: number;
  amount_cents: number;
  description: string;
  date: string;
  wallet_name: string;
  category_name: string;
};
export type Income = {
  id: number;
  wallet_id: number;
  amount_cents: number;
  source: string;
  description: string;
  date: string;
  wallet_name: string;
  recurring_id: number | null;
};
export type Recurring = {
  id: number;
  kind: 'income' | 'expense';
  wallet_id: number;
  category_id: number | null;
  source: string | null;
  amount_cents: number;
  description: string;
  start_date: string;
  frequency: Frequency;
  end_date: string | null;
  next_index: number;
  enabled: number;
  wallet_name: string;
  category_name: string | null;
  next_date: string | null;
  due: boolean;
};
export type Snapshot = {
  currency: string;
  revision: number;
  wallets: Wallet[];
  categories: Category[];
  expenses: Expense[];
  expenseCount: number;
  incomes: Income[];
  incomeCount: number;
  recurring: Recurring[];
  modelPath: string | null;
  modelName: string | null;
};
export type Proposal = {
  call: WriteCall;
  revision: number;
  title: string;
  details: string[];
  destructive: boolean;
};

export class Repository {
  private queue: Promise<unknown> = Promise.resolve();
  private orm: ReturnType<typeof createDatabase>;
  constructor(
    private db: SqlClient,
    private today = localDay,
  ) {
    this.orm = createDatabase(db);
  }
  private expenseQuery() {
    return this.orm
      .select({
        ...getTableColumns(t.expenses),
        wallet_name: t.wallets.name,
        category_name: t.categories.name,
      })
      .from(t.expenses)
      .innerJoin(t.wallets, eq(t.wallets.id, t.expenses.wallet_id))
      .innerJoin(t.categories, eq(t.categories.id, t.expenses.category_id));
  }
  private incomeQuery() {
    return this.orm
      .select({ ...getTableColumns(t.incomes), wallet_name: t.wallets.name })
      .from(t.incomes)
      .innerJoin(t.wallets, eq(t.wallets.id, t.incomes.wallet_id));
  }
  // Every database operation is serialized on one connection. Reviewed writes
  // recheck their revision inside the transaction, so stale proposals cannot overwrite edits.
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async setting(key: string) {
    return (
      this.orm.select().from(t.settings).where(eq(t.settings.key, key)).get()
        ?.value ?? null
    );
  }
  private setSetting(key: string, value: string) {
    return this.orm
      .insert(t.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: t.settings.key, set: { value } })
      .run();
  }
  private async wallets() {
    // Keep the outer reference qualified inside correlated subqueries.
    const walletId = sql`${sql.identifier('wallets')}.${sql.identifier('id')}`;
    const spent = sql<number>`COALESCE((SELECT SUM(${t.expenses.amount_cents}) FROM ${t.expenses} WHERE ${t.expenses.wallet_id}=${walletId}),0)`;
    const income = sql<number>`COALESCE((SELECT SUM(${t.incomes.amount_cents}) FROM ${t.incomes} WHERE ${t.incomes.wallet_id}=${walletId}),0)`;
    return this.orm
      .select({
        ...getTableColumns(t.wallets),
        spent_cents: spent.as('spent_cents'),
        income_cents: income.as('income_cents'),
        balance_cents:
          sql<number>`${t.wallets.opening_cents}+${income}-${spent}`.as(
            'balance_cents',
          ),
      })
      .from(t.wallets)
      .orderBy(t.wallets.id)
      .all();
  }
  private async schedules() {
    const rows = this.orm
      .select({
        ...getTableColumns(t.recurring),
        wallet_name: t.wallets.name,
        category_name: t.categories.name,
      })
      .from(t.recurring)
      .innerJoin(t.wallets, eq(t.wallets.id, t.recurring.wallet_id))
      .leftJoin(t.categories, eq(t.categories.id, t.recurring.category_id))
      .orderBy(t.recurring.id)
      .all();
    return rows.map((row) => {
      const next = occurrenceDate(
        row.start_date,
        row.next_index,
        row.frequency,
      );
      const next_date = row.end_date && next > row.end_date ? null : next;
      return {
        ...row,
        next_date,
        due: !!row.enabled && !!next_date && next_date <= this.today(),
      };
    });
  }
  getAiSettings(): Promise<OnlineSettings | null> {
    return this.serial(async () => {
      const value = await this.setting('online_ai');
      return value ? (JSON.parse(value) as OnlineSettings) : null;
    });
  }
  saveAiSettings(settings: OnlineSettings) {
    // Explicit projection keeps API keys out of SQLite even if the caller has credentials.
    const value = JSON.stringify({
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
    });
    return this.serial(() =>
      Promise.resolve(this.setSetting('online_ai', value)),
    );
  }
  snapshot() {
    return this.serial(async (): Promise<Snapshot> => ({
      currency: (await this.setting('currency')) ?? 'PHP',
      revision: Number(await this.setting('revision')),
      wallets: await this.wallets(),
      categories: this.orm
        .select()
        .from(t.categories)
        .orderBy(t.categories.id)
        .all(),
      expenses: this.expenseQuery()
        .orderBy(desc(t.expenses.date), desc(t.expenses.id))
        .limit(100)
        .all(),
      expenseCount: this.orm.select({ n: count() }).from(t.expenses).get()!.n,
      incomes: this.incomeQuery()
        .orderBy(desc(t.incomes.date), desc(t.incomes.id))
        .limit(100)
        .all(),
      incomeCount: this.orm.select({ n: count() }).from(t.incomes).get()!.n,
      recurring: await this.schedules(),
      modelPath: await this.setting('model_path'),
      modelName: await this.setting('model_name'),
    }));
  }
  saveModel(path: string, name: string) {
    return this.serial(() =>
      this.db.withTransactionAsync(async () => {
        this.setSetting('model_path', path);
        this.setSetting('model_name', name);
      }),
    );
  }
  clearModel() {
    return this.serial(() =>
      Promise.resolve(
        this.orm
          .delete(t.settings)
          .where(inArray(t.settings.key, ['model_path', 'model_name']))
          .run(),
      ),
    );
  }
  async read(input: ToolCall): Promise<unknown> {
    const call = toolSchema.parse(input);
    if (isWrite(call)) throw new Error('Changes require a reviewed proposal.');
    return this.serial(async () => {
      if (call.name === 'list_wallets')
        return {
          currency: await this.setting('currency'),
          wallets: await this.wallets(),
        };
      if (call.name === 'list_recurring')
        return { recurring: await this.schedules() };
      const a = call.arguments;
      if (a.start && a.end && a.start > a.end)
        throw new Error('Start date must precede end date.');
      const where = (table: typeof t.expenses | typeof t.incomes) => {
        const conditions: SQL[] = [];
        if (a.start) conditions.push(gte(table.date, a.start));
        if (a.end) conditions.push(lte(table.date, a.end));
        if ('wallet_id' in a && a.wallet_id)
          conditions.push(eq(table.wallet_id, a.wallet_id));
        return and(...conditions);
      };
      const table = call.name === 'list_incomes' ? t.incomes : t.expenses;
      const total = this.orm
        .select({
          count: count(),
          total_cents: sql<number>`COALESCE(SUM(${table.amount_cents}),0)`.as(
            'total_cents',
          ),
        })
        .from(table)
        .where(where(table))
        .get()!;
      if (call.name === 'get_summary') {
        const income = this.orm
          .select({
            income_count: count(),
            income_cents:
              sql<number>`COALESCE(SUM(${t.incomes.amount_cents}),0)`.as(
                'income_cents',
              ),
          })
          .from(t.incomes)
          .where(where(t.incomes))
          .get()!;
        return {
          ...total,
          currency: await this.setting('currency'),
          ...income,
          net_cents: income.income_cents - total.total_cents,
          categories: this.orm
            .select({
              name: t.categories.name,
              total_cents: sql<number>`SUM(${t.expenses.amount_cents})`.as(
                'total_cents',
              ),
            })
            .from(t.expenses)
            .innerJoin(
              t.categories,
              eq(t.categories.id, t.expenses.category_id),
            )
            .where(where(t.expenses))
            .groupBy(t.categories.id)
            .orderBy(desc(sql`SUM(${t.expenses.amount_cents})`))
            .all(),
          income_sources: this.orm
            .select({
              source: t.incomes.source,
              total_cents: sql<number>`SUM(${t.incomes.amount_cents})`.as(
                'total_cents',
              ),
            })
            .from(t.incomes)
            .where(where(t.incomes))
            .groupBy(t.incomes.source)
            .orderBy(desc(sql`SUM(${t.incomes.amount_cents})`))
            .all(),
        };
      }
      const { limit = 30, offset = 0 } = call.arguments;
      const rows =
        call.name === 'list_incomes'
          ? this.incomeQuery()
              .where(where(t.incomes))
              .orderBy(desc(t.incomes.date), desc(t.incomes.id))
              .limit(limit)
              .offset(offset)
              .all()
          : this.expenseQuery()
              .where(where(t.expenses))
              .orderBy(desc(t.expenses.date), desc(t.expenses.id))
              .limit(limit)
              .offset(offset)
              .all();
      return {
        ...total,
        limit,
        offset,
        currency: await this.setting('currency'),
        [call.name === 'list_incomes' ? 'incomes' : 'expenses']: rows,
      };
    });
  }
  private async mustExist(
    table: 'wallets' | 'categories' | 'expenses' | 'incomes' | 'recurring',
    id: number,
  ) {
    const entity = {
      wallets: t.wallets,
      categories: t.categories,
      expenses: t.expenses,
      incomes: t.incomes,
      recurring: t.recurring,
    }[table];
    const row = this.orm
      .select()
      .from(entity)
      .where(eq(entity.id, id))
      .get() as { id: number; name?: string; description?: string } | undefined;
    if (!row)
      throw new Error(
        `${{ expenses: 'Expense', wallets: 'Wallet', categories: 'Category', incomes: 'Income', recurring: 'Schedule' }[table]} no longer exists.`,
      );
    return row;
  }
  private async inspect(
    call: WriteCall,
  ): Promise<Omit<Proposal, 'revision' | 'call'>> {
    const currency = (await this.setting('currency')) ?? 'PHP';
    switch (call.name) {
      case 'configure_tracking': {
        const walletCount = this.orm
          .select({ n: count() })
          .from(t.wallets)
          .get();
        if (walletCount!.n && call.arguments.currency !== currency)
          throw new Error(
            'Currency cannot change after wallets are created. Existing amounts must keep their currency.',
          );
        return {
          title: 'Set tracking currency',
          details: [call.arguments.currency],
          destructive: false,
        };
      }
      case 'create_wallet':
      case 'update_wallet': {
        const a = call.arguments,
          cents = toCents(a.opening_balance, true);
        if ('id' in a) await this.mustExist('wallets', a.id);
        const duplicate = this.orm
          .select({ id: t.wallets.id })
          .from(t.wallets)
          .where(sql`${t.wallets.name} = ${a.name} COLLATE NOCASE`)
          .get();
        if (duplicate && (!('id' in a) || a.id !== duplicate.id))
          throw new Error('A wallet with this name already exists.');
        return {
          title:
            call.name === 'create_wallet' ? 'Create wallet' : 'Update wallet',
          details: [a.name, `Opening balance: ${money(cents, currency)}`],
          destructive: false,
        };
      }
      case 'create_category': {
        if (
          this.orm
            .select({ id: t.categories.id })
            .from(t.categories)
            .where(
              sql`${t.categories.name} = ${call.arguments.name} COLLATE NOCASE`,
            )
            .get()
        )
          throw new Error('This category already exists.');
        return {
          title: 'Create category',
          details: [call.arguments.name],
          destructive: false,
        };
      }
      case 'delete_wallet': {
        const w = await this.mustExist('wallets', call.arguments.id);
        if (
          this.orm
            .select({ id: t.expenses.id })
            .from(t.expenses)
            .where(eq(t.expenses.wallet_id, w.id))
            .limit(1)
            .get()
        )
          throw new Error(
            'This wallet has expenses. Move or delete them before deleting the wallet.',
          );
        if (
          this.orm
            .select({ id: t.incomes.id })
            .from(t.incomes)
            .where(eq(t.incomes.wallet_id, w.id))
            .limit(1)
            .get()
        )
          throw new Error(
            'This wallet has income. Move or delete it before deleting the wallet.',
          );
        if (
          this.orm
            .select({ id: t.recurring.id })
            .from(t.recurring)
            .where(eq(t.recurring.wallet_id, w.id))
            .limit(1)
            .get()
        )
          throw new Error(
            'This wallet has recurring schedules. Move or delete them before deleting the wallet.',
          );
        return {
          title: 'Delete wallet',
          details: [w.name!],
          destructive: true,
        };
      }
      case 'create_expense':
      case 'update_expense': {
        const a = call.arguments,
          cents = toCents(a.amount);
        if ('id' in a) await this.mustExist('expenses', a.id);
        const w = await this.mustExist('wallets', a.wallet_id),
          c = await this.mustExist('categories', a.category_id);
        return {
          title:
            call.name === 'create_expense' ? 'Add expense' : 'Update expense',
          details: [
            a.description,
            `${money(cents, currency)} · ${w.name}`,
            `${c.name} · ${a.date}`,
          ],
          destructive: false,
        };
      }
      case 'delete_expense': {
        const e = this.expenseQuery()
          .where(eq(t.expenses.id, call.arguments.id))
          .get();
        if (!e) throw new Error('Expense no longer exists.');
        return {
          title: 'Delete expense',
          details: [
            e.description,
            `${money(e.amount_cents, currency)} · ${e.wallet_name}`,
            e.date,
          ],
          destructive: true,
        };
      }
      case 'create_income':
      case 'update_income': {
        const a = call.arguments,
          cents = toCents(a.amount);
        if ('id' in a) await this.mustExist('incomes', a.id);
        const w = await this.mustExist('wallets', a.wallet_id);
        return {
          title: call.name === 'create_income' ? 'Add income' : 'Update income',
          details: [
            a.description,
            `+${money(cents, currency)} · ${w.name}`,
            `${a.source} · ${a.date}`,
          ],
          destructive: false,
        };
      }
      case 'delete_income': {
        const income = this.incomeQuery()
          .where(eq(t.incomes.id, call.arguments.id))
          .get();
        if (!income) throw new Error('Income no longer exists.');
        return {
          title: 'Delete income',
          details: [
            income.description,
            `Remove ${money(income.amount_cents, currency)} from ${income.wallet_name}`,
            income.date,
          ],
          destructive: true,
        };
      }
      case 'create_recurring':
      case 'update_recurring': {
        const a = call.arguments,
          cents = toCents(a.amount);
        const w = await this.mustExist('wallets', a.wallet_id);
        if (a.end_date && a.end_date < a.start_date)
          throw new Error(
            'The schedule end date must not precede its start date.',
          );
        if (a.kind === 'expense') {
          if (!a.category_id || a.source !== null)
            throw new Error(
              'A recurring bill needs a category and source must be null.',
            );
          await this.mustExist('categories', a.category_id);
        } else if (!a.source || a.category_id !== null)
          throw new Error(
            'A recurring deposit needs a source and category must be null.',
          );
        if ('id' in a) {
          const old = this.orm
            .select()
            .from(t.recurring)
            .where(eq(t.recurring.id, a.id))
            .get();
          if (!old) throw new Error('Schedule no longer exists.');
          if (
            old.next_index > 0 &&
            (old.start_date !== a.start_date ||
              old.frequency !== a.frequency ||
              old.kind !== a.kind)
          )
            throw new Error(
              'Start date, frequency, and kind cannot change after an occurrence was handled. Create a new schedule instead.',
            );
        }
        return {
          title:
            call.name === 'create_recurring'
              ? 'Create recurring schedule'
              : 'Update recurring schedule',
          details: [
            a.description,
            `${a.kind === 'income' ? '+' : '-'}${money(cents, currency)} · ${w.name}`,
            `${a.frequency} from ${a.start_date}${a.end_date ? ` through ${a.end_date}` : ''}`,
            'Due entries need confirmation. Creating a schedule does not record a payment.',
          ],
          destructive: false,
        };
      }
      case 'set_recurring_enabled':
      case 'delete_recurring': {
        const rule = await this.mustExist('recurring', call.arguments.id);
        return {
          title:
            call.name === 'delete_recurring'
              ? 'Delete recurring schedule'
              : call.arguments.enabled
                ? 'Resume schedule'
                : 'Pause schedule',
          details: [
            rule.description!,
            'Previously recorded transactions stay in your history.',
          ],
          destructive: call.name === 'delete_recurring',
        };
      }
      case 'post_recurring':
      case 'skip_recurring': {
        const rule = (await this.schedules()).find(
          (r) => r.id === call.arguments.id,
        );
        if (!rule) throw new Error('Schedule no longer exists.');
        if (!rule.due || rule.next_date !== call.arguments.date)
          throw new Error(
            'Only the next enabled, due occurrence can be recorded or skipped. Refresh the schedule.',
          );
        if (
          this.orm
            .select()
            .from(t.recurringOccurrences)
            .where(
              and(
                eq(t.recurringOccurrences.recurring_id, rule.id),
                eq(t.recurringOccurrences.date, call.arguments.date),
              ),
            )
            .get()
        )
          throw new Error('This occurrence was already handled.');
        return {
          title:
            call.name === 'skip_recurring'
              ? 'Skip due occurrence'
              : rule.kind === 'income'
                ? 'Record received deposit'
                : 'Record paid bill',
          details: [
            rule.description,
            `${rule.kind === 'income' ? '+' : '-'}${money(rule.amount_cents, currency)} · ${rule.wallet_name}`,
            call.arguments.date,
            call.name === 'skip_recurring'
              ? 'No balance change.'
              : 'Only records this transaction; no bank transfer or bill payment is made.',
          ],
          destructive: call.name === 'skip_recurring',
        };
      }
    }
  }
  propose(input: WriteCall) {
    const call = toolSchema.parse(input);
    if (!isWrite(call)) throw new Error('This is a read operation.');
    return this.serial(async (): Promise<Proposal> => ({
      call,
      revision: Number(await this.setting('revision')),
      ...(await this.inspect(call)),
    }));
  }
  apply(proposal: Proposal) {
    return this.serial(async () => {
      let result = '';
      await this.db.withTransactionAsync(async () => {
        if (Number(await this.setting('revision')) !== proposal.revision)
          throw new Error(
            'Your data changed since this proposal. Review the updated details and try again.',
          );
        const call = toolSchema.parse(proposal.call);
        if (!isWrite(call)) throw new Error('Expected a change.');
        const preview = await this.inspect(call);
        switch (call.name) {
          case 'configure_tracking':
            this.setSetting('currency', call.arguments.currency);
            break;
          case 'create_wallet':
            this.orm
              .insert(t.wallets)
              .values({
                name: call.arguments.name,
                opening_cents: toCents(call.arguments.opening_balance, true),
              })
              .run();
            break;
          case 'update_wallet':
            this.orm
              .update(t.wallets)
              .set({
                name: call.arguments.name,
                opening_cents: toCents(call.arguments.opening_balance, true),
              })
              .where(eq(t.wallets.id, call.arguments.id))
              .run();
            break;
          case 'delete_wallet':
            this.orm
              .delete(t.wallets)
              .where(eq(t.wallets.id, call.arguments.id))
              .run();
            break;
          case 'create_category':
            this.orm.insert(t.categories).values(call.arguments).run();
            break;
          case 'create_expense':
          case 'update_expense': {
            const a = call.arguments;
            const value = {
              wallet_id: a.wallet_id,
              category_id: a.category_id,
              amount_cents: toCents(a.amount),
              description: a.description,
              date: a.date,
            };
            if ('id' in a)
              this.orm
                .update(t.expenses)
                .set(value)
                .where(eq(t.expenses.id, a.id))
                .run();
            else this.orm.insert(t.expenses).values(value).run();
            break;
          }
          case 'delete_expense':
            this.orm
              .delete(t.expenses)
              .where(eq(t.expenses.id, call.arguments.id))
              .run();
            break;
          case 'create_income':
          case 'update_income': {
            const a = call.arguments;
            const value = {
              wallet_id: a.wallet_id,
              amount_cents: toCents(a.amount),
              source: a.source,
              description: a.description,
              date: a.date,
            };
            if ('id' in a)
              this.orm
                .update(t.incomes)
                .set(value)
                .where(eq(t.incomes.id, a.id))
                .run();
            else this.orm.insert(t.incomes).values(value).run();
            break;
          }
          case 'delete_income':
            this.orm
              .delete(t.incomes)
              .where(eq(t.incomes.id, call.arguments.id))
              .run();
            break;
          case 'create_recurring':
          case 'update_recurring': {
            const a = call.arguments;
            const value = {
              kind: a.kind,
              wallet_id: a.wallet_id,
              category_id: a.category_id,
              source: a.source,
              amount_cents: toCents(a.amount),
              description: a.description,
              start_date: a.start_date,
              frequency: a.frequency,
              end_date: a.end_date,
            };
            if ('id' in a)
              this.orm
                .update(t.recurring)
                .set(value)
                .where(eq(t.recurring.id, a.id))
                .run();
            else this.orm.insert(t.recurring).values(value).run();
            break;
          }
          case 'set_recurring_enabled':
            this.orm
              .update(t.recurring)
              .set({ enabled: call.arguments.enabled ? 1 : 0 })
              .where(eq(t.recurring.id, call.arguments.id))
              .run();
            break;
          case 'delete_recurring':
            this.orm
              .delete(t.recurring)
              .where(eq(t.recurring.id, call.arguments.id))
              .run();
            break;
          case 'post_recurring':
          case 'skip_recurring': {
            const a = call.arguments;
            const rule = this.orm
              .select()
              .from(t.recurring)
              .where(eq(t.recurring.id, a.id))
              .get()!;
            if (call.name === 'post_recurring') {
              const value = {
                wallet_id: rule.wallet_id,
                amount_cents: rule.amount_cents,
                description: rule.description,
                date: a.date,
                recurring_id: rule.id,
              };
              if (rule.kind === 'income')
                this.orm
                  .insert(t.incomes)
                  .values({ ...value, source: rule.source! })
                  .run();
              else
                this.orm
                  .insert(t.expenses)
                  .values({ ...value, category_id: rule.category_id! })
                  .run();
            }
            this.orm
              .insert(t.recurringOccurrences)
              .values({
                recurring_id: rule.id,
                date: a.date,
                status: call.name === 'post_recurring' ? 'posted' : 'skipped',
              })
              .run();
            this.orm
              .update(t.recurring)
              .set({ next_index: sql`${t.recurring.next_index}+1` })
              .where(eq(t.recurring.id, rule.id))
              .run();
            break;
          }
        }
        this.orm
          .update(t.settings)
          .set({ value: sql`CAST(${t.settings.value} AS INTEGER)+1` })
          .where(eq(t.settings.key, 'revision'))
          .run();
        result = `${preview.title}: ${preview.details.join(' · ')}. Saved on this device.`;
      });
      return result;
    });
  }
}

export function walletArguments(w: Wallet) {
  return { id: w.id, name: w.name, opening_balance: decimal(w.opening_cents) };
}
export function expenseArguments(e: Expense) {
  return {
    id: e.id,
    wallet_id: e.wallet_id,
    category_id: e.category_id,
    amount: decimal(e.amount_cents),
    description: e.description,
    date: e.date,
  };
}
