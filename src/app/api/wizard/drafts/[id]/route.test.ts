import assert from "node:assert/strict";
import test from "node:test";
import { buildChecklist as sharedBuildChecklist } from "@/lib/wizard/checklist";
import { buildChecklist as routeBuildChecklist } from "./checklist";

test("route-local checklist export remains compatible", () => {
  assert.equal(routeBuildChecklist, sharedBuildChecklist);
});
