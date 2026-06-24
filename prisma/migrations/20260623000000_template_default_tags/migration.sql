ALTER TABLE "store_mockup_templates"
  ADD COLUMN "default_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
