import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Triple Whale Add modal schedule UI", () => {
  it("renders custom date picker and interval input and posts them to create API", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/(authed)/integrations/triple-whale/TripleWhaleClient.tsx"),
      "utf8",
    );

    expect(source).toContain("syncFromDate");
    expect(source).toContain("syncIntervalMinutes");
    expect(source).toContain("function DatePickerField");
    expect(source).toContain("buildCalendarDays");
    expect(source).not.toContain('type="date"');
    expect(source).toContain("min={30}");
    expect(source).toContain("Sync every");
    expect(source).toContain('useState("30")');
    expect(source).toContain("Enter 30 minutes or more");
    expect(source).not.toContain("setSyncIntervalMinutes(Math.max");
    expect(source).toContain("async function deleteOne");
    expect(source).toContain("Remove Triple Whale shop");
    expect(source).toContain("method: \"DELETE\"");
    expect(source).toContain("title=\"Delete\"");
  });
});
