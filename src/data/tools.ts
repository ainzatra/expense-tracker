import { z } from 'zod';
import { CURRENCIES, validDay } from '../lib/money';

const id = z.number().int().positive('Choose an existing wallet, category, or expense.').max(Number.MAX_SAFE_INTEGER);
const name = z.string().trim().min(1, 'Enter a name.').max(60, 'Keep names within 60 characters.');
const amount = z.string().trim().max(16);
const day = z.string().refine(validDay, 'Use a valid YYYY-MM-DD date.');
const wallet = z.strictObject({ name, opening_balance: amount });
const expense = z.strictObject({ wallet_id: id, category_id: id, amount, description: z.string().trim().min(1, 'Enter an expense description.').max(200, 'Keep descriptions within 200 characters.'), date: day });
export const toolSchema = z.discriminatedUnion('name', [
  z.strictObject({ name: z.literal('configure_tracking'), arguments: z.strictObject({ currency: z.enum(CURRENCIES) }) }),
  z.strictObject({ name: z.literal('create_wallet'), arguments: wallet }),
  z.strictObject({ name: z.literal('update_wallet'), arguments: wallet.extend({ id }) }),
  z.strictObject({ name: z.literal('delete_wallet'), arguments: z.strictObject({ id }) }),
  z.strictObject({ name: z.literal('create_category'), arguments: z.strictObject({ name }) }),
  z.strictObject({ name: z.literal('create_expense'), arguments: expense }),
  z.strictObject({ name: z.literal('update_expense'), arguments: expense.extend({ id }) }),
  z.strictObject({ name: z.literal('delete_expense'), arguments: z.strictObject({ id }) }),
  z.strictObject({ name: z.literal('list_wallets'), arguments: z.strictObject({}) }),
  z.strictObject({ name: z.literal('list_expenses'), arguments: z.strictObject({
    wallet_id: id.optional(), start: day.optional(), end: day.optional(),
    limit: z.number().int().min(1).max(50).optional(), offset: z.number().int().min(0).max(100000).optional(),
  }) }),
  z.strictObject({ name: z.literal('get_summary'), arguments: z.strictObject({ start: day, end: day }) }),
]);
export type ToolCall = z.infer<typeof toolSchema>;
export type WriteCall = Exclude<ToolCall, { name: 'list_wallets' | 'list_expenses' | 'get_summary' }>;
export function isWrite(call: ToolCall): call is WriteCall {
  return !['list_wallets', 'list_expenses', 'get_summary'].includes(call.name);
}
export const agentOutputSchema = z.strictObject({ reply: z.string().max(600), tool: toolSchema.nullable() });
export const outputJsonSchema = z.toJSONSchema(agentOutputSchema, { target: 'draft-7', unrepresentable: 'any' });

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
list_expenses {wallet_id?,start?,end?,limit?,offset?}: query expenses, inclusive dates, newest first, limit <=50; result includes total match count.
get_summary {start,end}: total spending and category breakdown over inclusive dates.
`;
