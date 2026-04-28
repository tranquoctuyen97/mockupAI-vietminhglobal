-- Phase 6.10 — Store-as-Template Refactor
-- Store preset fields (blueprint/provider already in store_mockup_templates)

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS enabled_variant_ids INTEGER[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS default_price_usd NUMERIC(10,2) DEFAULT 24.99,
  ADD COLUMN IF NOT EXISTS default_prompt_version TEXT DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS publish_mode TEXT DEFAULT 'draft';

-- StoreMockupTemplate — upgrade placement to JSONB
ALTER TABLE store_mockup_templates
  ADD COLUMN IF NOT EXISTS default_placement JSONB;

-- WizardDraft — add variant override for tick/untick at step-3 Preview
ALTER TABLE wizard_drafts
  ADD COLUMN IF NOT EXISTS enabled_variant_ids_override INTEGER[] DEFAULT '{}';

-- Cleanup: delete all draft data (not in prod, safe to wipe)
DELETE FROM mockup_jobs;
DELETE FROM wizard_drafts;
