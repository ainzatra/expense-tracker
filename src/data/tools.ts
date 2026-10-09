import { z } from 'zod';
import { CURRENCIES, validDay } from '../lib/money';
import { FREQUENCIES } from '../lib/recurrence';

const id = z
  .number()
  .int()
  .positive('Choose an existing wallet, category, or expense.')
  .max(Number.MAX_SAFE_INTEGER);
const name = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(60, 'Keep names within 60 characters.');
const amount = z.string().trim().max(16);
const day = z.string().refine(validDay, 'Use a valid YYYY-MM-DD date.');
const wallet = z.strictObject({ name, opening_balance: amount });
const expense = z.strictObject({
  wallet_id: id,
  category_id: id,
  amount,
  description: z
    .string()
    .trim()
    .min(1, 'Enter an expense description.')
    .max(200, 'Keep descriptions within 200 characters.'),
  date: day,
});
const income = z.strictObject({
  wallet_id: id,
  amount,
  source: name,
  description: z.string().trim().min(1).max(200),
  date: day,
});
const recurring = z.strictObject({
  kind: z.enum(['income', 'expense']),
  wallet_id: id,
  category_id: id.nullable(),
  source: name.nullable(),
  amount,
  description: z.string().trim().min(1).max(200),
  start_date: day,
  frequency: z.enum(FREQUENCIES),
  end_date: day.nullable(),
});
const filters = z.strictObject({
  wallet_id: id.optional(),
  start: day.optional(),
  end: day.optional(),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).max(100000).optional(),
});
export const toolSchema = z.discriminatedUnion('name', [
  z.strictObject({
    name: z.literal('configure_tracking'),
    arguments: z.strictObject({ currency: z.enum(CURRENCIES) }),
  }),
  z.strictObject({ name: z.literal('create_wallet'), arguments: wallet }),
  z.strictObject({
    name: z.literal('update_wallet'),
    arguments: wallet.extend({ id }),
  }),
  z.strictObject({
    name: z.literal('delete_wallet'),
    arguments: z.strictObject({ id }),
  }),
  z.strictObject({
    name: z.literal('create_category'),
    arguments: z.strictObject({ name }),
  }),
  z.strictObject({ name: z.literal('create_expense'), arguments: expense }),
  z.strictObject({
    name: z.literal('update_expense'),
    arguments: expense.extend({ id }),
  }),
  z.strictObject({
    name: z.literal('delete_expense'),
    arguments: z.strictObject({ id }),
  }),
  z.strictObject({ name: z.literal('create_income'), arguments: income }),
  z.strictObject({
    name: z.literal('update_income'),
    arguments: income.extend({ id }),
  }),
  z.strictObject({
    name: z.literal('delete_income'),
    arguments: z.strictObject({ id }),
  }),
  z.strictObject({ name: z.literal('create_recurring'), arguments: recurring }),
  z.strictObject({
    name: z.literal('update_recurring'),
    arguments: recurring.extend({ id }),
  }),
  z.strictObject({
    name: z.literal('set_recurring_enabled'),
    arguments: z.strictObject({ id, enabled: z.boolean() }),
  }),
  z.strictObject({
    name: z.literal('delete_recurring'),
    arguments: z.strictObject({ id }),
  }),
  z.strictObject({
    name: z.literal('post_recurring'),
    arguments: z.strictObject({ id, date: day }),
  }),
  z.strictObject({
    name: z.literal('skip_recurring'),
    arguments: z.strictObject({ id, date: day }),
  }),
  z.strictObject({
    name: z.literal('list_recurring'),
    arguments: z.strictObject({}),
  }),
  z.strictObject({ name: z.literal('list_incomes'), arguments: filters }),
  z.strictObject({
    name: z.literal('list_wallets'),
    arguments: z.strictObject({}),
  }),
  z.strictObject({ name: z.literal('list_expenses'), arguments: filters }),
  z.strictObject({
    name: z.literal('get_summary'),
    arguments: z.strictObject({ start: day, end: day }),
  }),
]);
export type ToolCall = z.infer<typeof toolSchema>;
export type WriteCall = Exclude<
  ToolCall,
  {
    name:
      | 'list_wallets'
      | 'list_expenses'
      | 'list_incomes'
      | 'list_recurring'
      | 'get_summary';
  }
>;
export function isWrite(call: ToolCall): call is WriteCall {
  return ![
    'list_wallets',
    'list_expenses',
    'list_incomes',
    'list_recurring',
    'get_summary',
  ].includes(call.name);
}

export const TOOL_GUIDE = `
configure_tracking {currency: "PHP"|"USD"|"EUR"|"GBP"|"SGD"|"AUD"|"CAD"}: set currency BEFORE any wallets exist.
create_wallet {name, opening_balance}: create a wallet. Opening balance is a decimal STRING, e.g. "1000.00".
update_wallet {id,name,opening_balance}: replace wallet name/opening balance; use existing values for unchanged fields.
delete_wallet {id}: delete an EMPTY wallet; wallets with expenses cannot be deleted.
create_category {name}: create a spending category.
create_expense {wallet_id,category_id,amount,description,date}: add spending. amount is a positive decimal STRING, date is YYYY-MM-DD.
update_expense {id,wallet_id,category_id,amount,description,date}: replace an expense; use existing fields for unchanged values.
delete_expense {id}: delete one explicitly identified expense.
list_wallets {}: return wallets and balances.
create_income {wallet_id,amount,source,description,date}: add money received (salary, allowance, gift, business, other). Never change opening balance to record income.
update_income {id,wallet_id,amount,source,description,date}: replace income; preserve unchanged values.
delete_income {id}: remove income and reduce the wallet balance.
list_incomes {wallet_id?,start?,end?,limit?,offset?}: query money received.
create_recurring {kind:"income"|"expense",wallet_id,category_id,source,amount,description,start_date,frequency:"daily"|"weekly"|"monthly"|"yearly",end_date}: create a schedule. Income requires source and category_id:null; bills require category_id and source:null. end_date is null for no end. Schedule creation does not record any payments.
update_recurring {id,...all create_recurring fields}: change future entries; start_date/frequency cannot change once any occurrence was handled.
set_recurring_enabled {id,enabled}: pause or resume a schedule.
delete_recurring {id}: delete schedule, keeping all previously recorded transactions.
list_recurring {}: list schedules, next_date and whether due. Only enabled due occurrences can be recorded.
post_recurring {id,date}: propose recording the next due deposit or paid bill. Ask if money was received/paid when not stated. Only use its exact next_date. No actual bank payment is made.
skip_recurring {id,date}: skip the next due occurrence without changing a balance, only when explicitly requested.
list_expenses {wallet_id?,start?,end?,limit?,offset?}: query expenses, inclusive dates, newest first, limit <=50; result includes total match count.
get_summary {start,end}: total spending and category breakdown over inclusive dates.
`;
