import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("deleteStore clears custom mockup joins before deleting the store", () => {
  const source = readFileSync("src/lib/stores/store-service.ts", "utf8");
  const block = source.match(/export async function deleteStore\(storeId: string\) \{[\s\S]*?\n\}/);

  assert.ok(block, "expected deleteStore implementation");
  assert.match(block[0], /wizardDraftMockupLibraryPick\.deleteMany/);
  assert.match(block[0], /templateMockupItem\.deleteMany/);
  assert.match(block[0], /store\.delete/);
  assert.ok(
    block[0].indexOf("wizardDraftMockupLibraryPick.deleteMany") <
      block[0].indexOf("templateMockupItem.deleteMany"),
  );
  assert.ok(block[0].indexOf("templateMockupItem.deleteMany") < block[0].indexOf("store.delete"));
});
