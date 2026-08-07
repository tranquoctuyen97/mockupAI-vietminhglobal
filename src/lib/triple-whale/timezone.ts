import { formatInTimeZone } from "date-fns-tz";

/** Fixed UTC-07:00 timezone. IANA's Etc/GMT signs are intentionally reversed. */
export const FIXED_GMT_MINUS_7 = "Etc/GMT+7" as const;

export const DEFAULT_TRIPLE_WHALE_TIMEZONE = FIXED_GMT_MINUS_7;

export const TRIPLE_WHALE_TIMEZONE_OPTIONS = [
  { value: FIXED_GMT_MINUS_7, label: "UTC-07:00 (GMT-7 fixed)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PT)" },
  { value: "America/Denver", label: "America/Denver (MT)" },
  { value: "America/Chicago", label: "America/Chicago (CT)" },
  { value: "America/New_York", label: "America/New_York (ET)" },
  { value: "UTC", label: "UTC" },
  { value: "Asia/Ho_Chi_Minh", label: "Asia/Ho_Chi_Minh (ICT)" },
] as const;

export const TRIPLE_WHALE_TIMEZONE_VALUES = TRIPLE_WHALE_TIMEZONE_OPTIONS.map(
  ({ value }) => value,
) as [string, ...string[]];

/** Triple Whale documents this as a one-based current-hour value. */
export function currentTripleWhaleHour(timezone: string, now = new Date()): number {
  return Number(formatInTimeZone(now, timezone, "H")) + 1;
}
