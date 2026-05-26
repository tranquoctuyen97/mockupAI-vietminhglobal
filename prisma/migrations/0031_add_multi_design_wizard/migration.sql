CREATE TABLE "wizard_draft_designs" (
    "id" TEXT NOT NULL,
    "wizard_draft_id" TEXT NOT NULL,
    "design_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "printify_image_id" TEXT,
    "printify_draft_product_id" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wizard_draft_designs_pkey" PRIMARY KEY ("id")
);

INSERT INTO "wizard_draft_designs" (
    "id",
    "wizard_draft_id",
    "design_id",
    "sort_order",
    "printify_image_id",
    "printify_draft_product_id",
    "created_at",
    "updated_at"
)
SELECT
    concat('wdd_', substr(md5(wd."id" || ':' || wd."design_id"), 1, 24)),
    wd."id",
    wd."design_id",
    0,
    wd."printify_image_id",
    wd."printify_draft_product_id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "wizard_drafts" wd
WHERE wd."design_id" IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "mockup_jobs" ADD COLUMN "wizard_draft_design_id" TEXT;
ALTER TABLE "mockup_jobs" ADD COLUMN "design_id" TEXT;

UPDATE "mockup_jobs" mj
SET
  "wizard_draft_design_id" = wdd."id",
  "design_id" = wdd."design_id"
FROM "wizard_draft_designs" wdd
WHERE mj."wizard_draft_id" = wdd."wizard_draft_id"
  AND wdd."sort_order" = 0
  AND mj."wizard_draft_design_id" IS NULL;

ALTER TABLE "listings" ADD COLUMN "wizard_draft_design_id" TEXT;

UPDATE "listings" l
SET
  "wizard_draft_design_id" = wdd."id",
  "design_id" = COALESCE(l."design_id", wdd."design_id")
FROM "wizard_draft_designs" wdd
WHERE l."wizard_draft_id" = wdd."wizard_draft_id"
  AND wdd."sort_order" = 0
  AND l."wizard_draft_design_id" IS NULL;

ALTER TABLE "listings" DROP CONSTRAINT IF EXISTS "listings_wizard_draft_id_key";
DROP INDEX IF EXISTS "listings_wizard_draft_id_key";

CREATE UNIQUE INDEX "wizard_draft_designs_wizard_draft_id_design_id_key" ON "wizard_draft_designs"("wizard_draft_id", "design_id");
CREATE UNIQUE INDEX "listings_wizard_draft_design_id_key" ON "listings"("wizard_draft_design_id");
CREATE INDEX "wizard_draft_designs_wizard_draft_id_sort_order_idx" ON "wizard_draft_designs"("wizard_draft_id", "sort_order");
CREATE INDEX "wizard_draft_designs_design_id_idx" ON "wizard_draft_designs"("design_id");
CREATE INDEX "mockup_jobs_wizard_draft_id_wizard_draft_design_id_status_idx" ON "mockup_jobs"("wizard_draft_id", "wizard_draft_design_id", "status");
CREATE INDEX "mockup_jobs_wizard_draft_design_id_idx" ON "mockup_jobs"("wizard_draft_design_id");
CREATE INDEX "mockup_jobs_design_id_idx" ON "mockup_jobs"("design_id");
CREATE INDEX "listings_wizard_draft_id_idx" ON "listings"("wizard_draft_id");
CREATE INDEX "listings_design_id_idx" ON "listings"("design_id");

ALTER TABLE "wizard_draft_designs"
  ADD CONSTRAINT "wizard_draft_designs_wizard_draft_id_fkey"
  FOREIGN KEY ("wizard_draft_id") REFERENCES "wizard_drafts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wizard_draft_designs"
  ADD CONSTRAINT "wizard_draft_designs_design_id_fkey"
  FOREIGN KEY ("design_id") REFERENCES "designs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mockup_jobs"
  ADD CONSTRAINT "mockup_jobs_wizard_draft_design_id_fkey"
  FOREIGN KEY ("wizard_draft_design_id") REFERENCES "wizard_draft_designs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mockup_jobs"
  ADD CONSTRAINT "mockup_jobs_design_id_fkey"
  FOREIGN KEY ("design_id") REFERENCES "designs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "listings"
  ADD CONSTRAINT "listings_wizard_draft_id_fkey"
  FOREIGN KEY ("wizard_draft_id") REFERENCES "wizard_drafts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "listings"
  ADD CONSTRAINT "listings_wizard_draft_design_id_fkey"
  FOREIGN KEY ("wizard_draft_design_id") REFERENCES "wizard_draft_designs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
