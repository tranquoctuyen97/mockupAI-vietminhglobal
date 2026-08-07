import { formatInTimeZone } from "date-fns-tz";

export interface DateRange {
  from: string;
  to: string;
}

export type ComparisonMode =
  | "none"
  | "previous_period"
  | "previous_week"
  | "previous_month"
  | "previous_quarter"
  | "previous_year";

export type DatePreset = "today" | "yesterday" | "7d" | "14d" | "30d" | "90d" | "this_month";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(date: string): Date {
  if (!DATE_PATTERN.test(date)) throw new Error(`Invalid date: ${date}`);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid date: ${date}`);
  }
  return parsed;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number): string {
  const shifted = parseDate(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return formatDate(shifted);
}

function shiftMonths(date: string, months: number): string {
  const source = parseDate(date);
  const targetMonthStart = new Date(
    Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1),
  );
  const lastTargetDay = new Date(
    Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();
  targetMonthStart.setUTCDate(Math.min(source.getUTCDate(), lastTargetDay));
  return formatDate(targetMonthStart);
}

function assertOrdered(range: DateRange): void {
  const from = parseDate(range.from);
  const to = parseDate(range.to);
  if (from > to) throw new Error("Invalid date range: from must be on or before to");
}

export function inclusiveDayCount(range: DateRange): number {
  assertOrdered(range);
  return (
    Math.round((parseDate(range.to).getTime() - parseDate(range.from).getTime()) / 86_400_000) + 1
  );
}

export function comparisonRange(range: DateRange, mode: ComparisonMode): DateRange | null {
  assertOrdered(range);
  if (mode === "none") return null;
  if (mode === "previous_period") {
    const to = shiftDays(range.from, -1);
    return { from: shiftDays(to, -(inclusiveDayCount(range) - 1)), to };
  }
  if (mode === "previous_week") {
    return { from: shiftDays(range.from, -7), to: shiftDays(range.to, -7) };
  }
  const months = mode === "previous_month" ? -1 : mode === "previous_quarter" ? -3 : -12;
  return { from: shiftMonths(range.from, months), to: shiftMonths(range.to, months) };
}

export function presetRange(preset: DatePreset, timezone: string, now = new Date()): DateRange {
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const yesterday = shiftDays(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (preset === "this_month") return { from: `${today.slice(0, 7)}-01`, to: today };
  const days = Number.parseInt(preset, 10);
  return { from: shiftDays(today, -(days - 1)), to: today };
}

/** Convert a calendar date to the UTC midnight representation used by PostgreSQL DATE. */
export function calendarDateToUtcMidnight(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
