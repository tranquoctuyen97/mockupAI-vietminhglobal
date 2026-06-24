-- Repair environments where the preceding migrations were resolved as applied
-- after duplicate-column errors, but the runtime database still lacks a column.
ALTER TABLE "store_mockup_templates"
  ADD COLUMN IF NOT EXISTS "default_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "wizard_draft_designs"
  ADD COLUMN IF NOT EXISTS "ai_content" JSONB;
