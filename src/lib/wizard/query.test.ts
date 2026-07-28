import assert from "node:assert/strict";
import test from "node:test";

import { WizardResourceError } from "./contracts";
import { resolveTenantResource } from "./query";

const rows = [
  { id: "store_1", tenantId: "tenant_1", name: "North America" },
  { id: "store_2", tenantId: "tenant_1", name: "North Europe" },
  { id: "store_3", tenantId: "tenant_2", name: "Private Store" },
];

test("resource id resolution always binds the tenant", async () => {
  const resolved = await resolveTenantResource({
    tenantId: "tenant_1",
    ref: { id: "store_1" },
    load: async ({ tenantId, id }) =>
      rows.filter((row) => row.tenantId === tenantId && row.id === id),
  });
  assert.equal(resolved.id, "store_1");

  await assert.rejects(
    resolveTenantResource({
      tenantId: "tenant_1",
      ref: { id: "store_3" },
      load: async ({ tenantId, id }) =>
        rows.filter((row) => row.tenantId === tenantId && row.id === id),
    }),
    (error: unknown) => error instanceof WizardResourceError && error.code === "RESOURCE_NOT_FOUND",
  );
});

test("name resolution prefers one exact match and rejects ambiguous partial matches", async () => {
  const load = async ({ tenantId, name }: { tenantId: string; id?: string; name?: string }) =>
    rows.filter(
      (row) =>
        row.tenantId === tenantId && (!name || row.name.toLowerCase().includes(name.toLowerCase())),
    );

  const exact = await resolveTenantResource({
    tenantId: "tenant_1",
    ref: { name: "North America" },
    load,
  });
  assert.equal(exact.id, "store_1");

  await assert.rejects(
    resolveTenantResource({
      tenantId: "tenant_1",
      ref: { name: "North" },
      load,
    }),
    (error: unknown) => {
      assert.ok(error instanceof WizardResourceError);
      assert.equal(error.code, "AMBIGUOUS_REFERENCE");
      assert.deepEqual(error.candidates, [
        { id: "store_1", name: "North America" },
        { id: "store_2", name: "North Europe" },
      ]);
      return true;
    },
  );
});
