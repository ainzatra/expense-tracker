export const CURRENCIES = ['PHP', 'USD', 'EUR', 'GBP', 'SGD', 'AUD', 'CAD'] as const;

export function toCents(value: string, allowZero = false): number {
  const text = value.trim();
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(text)) throw new Error('Enter an amount with at most two decimal places, such as 250.00.');
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 1_000_000_000_000 || cents < (allowZero ? 0 : 1)) {
    throw new Error(allowZero ? 'Balance must be between 0 and 10,000,000,000.' : 'Amount must be greater than zero and at most 10,000,000,000.');
  }
  return cents;
}

export function decimal(cents: number) { return (cents / 100).toFixed(2); }
export function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(cents / 100);
}
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
