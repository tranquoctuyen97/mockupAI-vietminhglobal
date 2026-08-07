import { describe, expect, it } from "vitest";

import { currentTripleWhaleHour, FIXED_GMT_MINUS_7 } from "./timezone";

describe("Triple Whale reporting timezone", () => {
  it("keeps the fixed GMT-7 offset in summer", () => {
    const now = new Date("2026-08-07T14:00:00.000Z");

    expect(currentTripleWhaleHour(FIXED_GMT_MINUS_7, now)).toBe(8);
  });

  it("uses a one-based hour at midnight", () => {
    const now = new Date("2026-08-07T07:00:00.000Z");

    expect(currentTripleWhaleHour(FIXED_GMT_MINUS_7, now)).toBe(1);
  });
});
