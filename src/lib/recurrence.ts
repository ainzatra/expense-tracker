import { validDay } from './money';

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

// Calculate from the original anchor: Jan 31 -> Feb 28 -> Mar 31.
export function occurrenceDate(
  start: string,
  index: number,
  frequency: Frequency,
): string {
  if (!validDay(start) || !Number.isSafeInteger(index) || index < 0)
    throw new Error('Invalid schedule date.');
  const [year, month, day] = start.split('-').map(Number);
  const date = new Date(`${start}T12:00:00Z`);
  if (frequency === 'daily' || frequency === 'weekly')
    date.setUTCDate(
      date.getUTCDate() + index * (frequency === 'weekly' ? 7 : 1),
    );
  else {
    const target = new Date(
      Date.UTC(
        year + (frequency === 'yearly' ? index : 0),
        month - 1 + (frequency === 'monthly' ? index : 0),
        1,
        12,
      ),
    );
    const last = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
    ).getUTCDate();
    target.setUTCDate(Math.min(day, last));
    date.setTime(target.getTime());
  }
  return date.toISOString().slice(0, 10);
}
