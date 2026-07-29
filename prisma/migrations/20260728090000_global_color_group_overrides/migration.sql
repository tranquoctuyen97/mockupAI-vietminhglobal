CREATE TABLE IF NOT EXISTS "color_group_overrides" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "color_name" TEXT NOT NULL,
  "color_name_key" TEXT NOT NULL,
  "color_group" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'admin',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "color_group_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "color_group_overrides_tenant_id_color_name_key_key"
  ON "color_group_overrides"("tenant_id", "color_name_key");

CREATE INDEX IF NOT EXISTS "color_group_overrides_tenant_id_color_group_idx"
  ON "color_group_overrides"("tenant_id", "color_group");

ALTER TABLE "color_group_overrides"
  ADD CONSTRAINT "color_group_overrides_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "color_group_overrides" (
  "id",
  "tenant_id",
  "color_name",
  "color_name_key",
  "color_group",
  "source",
  "created_at",
  "updated_at"
)
SELECT
  'cgo_' || replace(gen_random_uuid()::text, '-', ''),
  "id",
  'Heather Mauve',
  'heather mauve',
  'dark',
  'legacy_code',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants"
ON CONFLICT ("tenant_id", "color_name_key") DO NOTHING;

INSERT INTO "color_group_overrides" (
  "id",
  "tenant_id",
  "color_name",
  "color_name_key",
  "color_group",
  "source",
  "created_at",
  "updated_at"
)
SELECT
  'cgo_' || replace(gen_random_uuid()::text, '-', ''),
  s."tenant_id",
  min(sc."name"),
  lower(regexp_replace(trim(sc."name"), '\s+', ' ', 'g')),
  min(sc."color_group"),
  'legacy_store',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "store_colors" sc
JOIN "stores" s ON s."id" = sc."store_id"
WHERE sc."color_group" IN ('light', 'dark')
GROUP BY s."tenant_id", lower(regexp_replace(trim(sc."name"), '\s+', ' ', 'g'))
HAVING count(DISTINCT sc."color_group") = 1
ON CONFLICT ("tenant_id", "color_name_key") DO NOTHING;
