ALTER TABLE "store_mockup_templates"
  ADD COLUMN "default_collections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
