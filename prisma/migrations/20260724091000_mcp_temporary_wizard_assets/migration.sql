CREATE TYPE "DesignScope" AS ENUM ('LIBRARY', 'TEMPORARY_MCP');

ALTER TABLE "designs"
  ADD COLUMN "scope" "DesignScope" NOT NULL DEFAULT 'LIBRARY',
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "source_url_redacted" TEXT;

CREATE INDEX "designs_tenant_id_scope_status_idx"
  ON "designs"("tenant_id", "scope", "status");
CREATE INDEX "designs_scope_expires_at_idx"
  ON "designs"("scope", "expires_at");

CREATE TABLE "wizard_draft_mockup_sources" (
  "id" TEXT NOT NULL,
  "wizard_draft_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "storage_path" TEXT,
  "source_url_redacted" TEXT,
  "mockup_library_item_id" TEXT,
  "view" "MockupLibraryView" NOT NULL,
  "applies_to_color_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "applies_to_all" BOOLEAN NOT NULL DEFAULT false,
  "composite_region_px" JSONB,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size_bytes" INTEGER NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wizard_draft_mockup_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wizard_draft_mockup_sources_source_check"
    CHECK (num_nonnulls("storage_path", "mockup_library_item_id") = 1)
);

CREATE INDEX "wizard_draft_mockup_sources_wizard_draft_id_sort_order_idx"
  ON "wizard_draft_mockup_sources"("wizard_draft_id", "sort_order");
CREATE INDEX "wizard_draft_mockup_sources_expires_at_idx"
  ON "wizard_draft_mockup_sources"("expires_at");
CREATE INDEX "wizard_draft_mockup_sources_mockup_library_item_id_idx"
  ON "wizard_draft_mockup_sources"("mockup_library_item_id");

ALTER TABLE "wizard_draft_mockup_sources"
  ADD CONSTRAINT "wizard_draft_mockup_sources_wizard_draft_id_fkey"
  FOREIGN KEY ("wizard_draft_id") REFERENCES "wizard_drafts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wizard_draft_mockup_sources"
  ADD CONSTRAINT "wizard_draft_mockup_sources_mockup_library_item_id_fkey"
  FOREIGN KEY ("mockup_library_item_id") REFERENCES "mockup_library_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
