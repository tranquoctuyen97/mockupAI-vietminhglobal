import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Triple Whale delete shop cleanup", () => {
  it("removes pending sync jobs before deleting synced stats and credential", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/integrations/triple-whale/[storeId]/route.ts"), "utf8");
    const queue = readFileSync(join(process.cwd(), "src/lib/triple-whale/queue.ts"), "utf8");

    expect(route).toContain("removePendingTripleWhaleSyncJobs");
    expect(route.indexOf("removePendingTripleWhaleSyncJobs")).toBeLessThan(route.indexOf("tripleWhaleDailyStat.deleteMany"));
    expect(route.indexOf("tripleWhaleDailyStat.deleteMany")).toBeLessThan(route.indexOf("tripleWhaleCredential.delete"));
    expect(queue).toContain("export async function removePendingTripleWhaleSyncJobs");
    expect(queue).toContain("waiting");
    expect(queue).toContain("delayed");
    expect(queue).toContain("prioritized");
    expect(queue).toContain("job.data?.credentialId === credentialId");
    expect(queue).toContain("job.remove()");
  });
});
