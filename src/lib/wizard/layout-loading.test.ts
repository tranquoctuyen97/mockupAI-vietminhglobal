import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowWizardBlockingLoader } from "./layout-loading";

test("keeps wizard content mounted during background draft refresh", () => {
  assert.equal(
    shouldShowWizardBlockingLoader({ loading: true, hasDraft: true }),
    false,
  );
});

test("blocks wizard content while the initial draft is loading", () => {
  assert.equal(
    shouldShowWizardBlockingLoader({ loading: true, hasDraft: false }),
    true,
  );
  assert.equal(
    shouldShowWizardBlockingLoader({ loading: false, hasDraft: false }),
    false,
  );
});
