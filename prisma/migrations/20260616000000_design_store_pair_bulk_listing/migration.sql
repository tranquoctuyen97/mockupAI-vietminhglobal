ALTER TABLE "designs"
  ADD COLUMN "store_id" TEXT;

ALTER TABLE "designs"
  ADD CONSTRAINT "designs_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "designs_tenant_id_store_id_status_idx"
  ON "designs"("tenant_id", "store_id", "status");

ALTER TABLE "store_colors"
  ADD COLUMN "color_group" TEXT NOT NULL DEFAULT 'auto';

ALTER TABLE "mockup_jobs"
  ADD COLUMN "color_filter_ids" JSONB,
  ADD COLUMN "color_group" TEXT;

CREATE TABLE "wizard_draft_design_pairs" (
  "id" TEXT NOT NULL,
  "wizard_draft_id" TEXT NOT NULL,
  "base_name" TEXT NOT NULL,
  "light_draft_design_id" TEXT NOT NULL,
  "dark_draft_design_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "ai_content" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wizard_draft_design_pairs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "wizard_draft_design_pairs"
  ADD CONSTRAINT "wizard_draft_design_pairs_wizard_draft_id_fkey"
  FOREIGN KEY ("wizard_draft_id") REFERENCES "wizard_drafts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wizard_draft_design_pairs"
  ADD CONSTRAINT "wizard_draft_design_pairs_light_draft_design_id_fkey"
  FOREIGN KEY ("light_draft_design_id") REFERENCES "wizard_draft_designs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wizard_draft_design_pairs"
  ADD CONSTRAINT "wizard_draft_design_pairs_dark_draft_design_id_fkey"
  FOREIGN KEY ("dark_draft_design_id") REFERENCES "wizard_draft_designs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "wizard_draft_design_pairs_wizard_draft_id_base_name_key"
  ON "wizard_draft_design_pairs"("wizard_draft_id", "base_name");

CREATE UNIQUE INDEX "wizard_draft_design_pairs_wizard_draft_id_light_draft_design_id_key"
  ON "wizard_draft_design_pairs"("wizard_draft_id", "light_draft_design_id");

CREATE UNIQUE INDEX "wizard_draft_design_pairs_wizard_draft_id_dark_draft_design_id_key"
  ON "wizard_draft_design_pairs"("wizard_draft_id", "dark_draft_design_id");

CREATE INDEX "wizard_draft_design_pairs_wizard_draft_id_sort_order_idx"
  ON "wizard_draft_design_pairs"("wizard_draft_id", "sort_order");

ALTER TABLE "listings"
  ADD COLUMN "wizard_draft_design_pair_id" TEXT;

ALTER TABLE "listings"
  ADD CONSTRAINT "listings_wizard_draft_design_pair_id_fkey"
  FOREIGN KEY ("wizard_draft_design_pair_id") REFERENCES "wizard_draft_design_pairs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "listings_wizard_draft_design_pair_id_key"
  ON "listings"("wizard_draft_design_pair_id");
