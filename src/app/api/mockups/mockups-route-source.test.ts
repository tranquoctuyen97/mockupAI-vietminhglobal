import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const listRoute = readFileSync("src/app/api/mockups/route.ts", "utf8");
const itemRoute = readFileSync("src/app/api/mockups/[mockupId]/route.ts", "utf8");

test("global mockup routes require mockup_library permission", () => {
  assert.match(listRoute, /requireFeature\(["']mockup_library["']\)/);
  assert.match(itemRoute, /requireFeature\(["']mockup_library["']\)/);
});

test("global mockup upload is COMPOSITE-only and stores upload metadata", () => {
  const serviceSource = readFileSync("src/lib/mockup/mockup-library-service.ts", "utf8");
  assert.match(listRoute, /createMockupLibraryItemFromUpload/);
  assert.match(listRoute, /parseMultipartJson/);
  assert.match(listRoute, /uploadedById:\s*session\.id/);
  assert.match(listRoute, /file,/);
  assert.match(serviceSource, /mimeType:\s*input\.file\.type/);
  assert.match(serviceSource, /fileSizeBytes:\s*input\.file\.size/);
  assert.match(listRoute, /previewUrl:\s*item\.previewPath\s*\?\s*storageUrl\(item\.previewPath\)\s*:\s*null/);
  assert.doesNotMatch(listRoute, /FINAL/);
  assert.doesNotMatch(listRoute, /as never/);
  // COMPOSITE-only validation is in the service
  assert.match(serviceSource, /normalizeCompositeRenderMode/);
  assert.match(serviceSource, /normalizeMockupLibraryView/);
  assert.match(serviceSource, /normalizeMockupLibraryScene/);
});

test("global mockup patch validates view and scene type", () => {
  assert.match(itemRoute, /normalizeMockupLibraryView/);
  assert.match(itemRoute, /normalizeMockupLibraryScene/);
  assert.match(itemRoute, /view is invalid/);
  assert.match(itemRoute, /sceneType is invalid/);
});

test("global mockup delete restricts template attachments and removes storage", () => {
  assert.match(itemRoute, /templateMockupItem\.count/);
  assert.match(itemRoute, /status:\s*409/);
  assert.match(itemRoute, /deleteMockupStorageObjects/);
  assert.match(readFileSync("src/lib/mockup/mockup-library-service.ts", "utf8"), /isMissingStorageObjectError/);
});
