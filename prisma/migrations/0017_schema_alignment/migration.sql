-- Phase 6.10 step 5 — Schema alignment with consolidated plan
-- Move fields to StoreMockupTemplate, drop deprecated cols, add new fields

-- 1. StoreMockupTemplate: add missing columns
ALTER TABLE store_mockup_templates
  ADD COLUMN IF NOT EXISTS enabled_variant_ids INTEGER[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS default_prompt_version TEXT DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS default_aspect_ratio TEXT DEFAULT '1:1',
  ADD COLUMN IF NOT EXISTS blueprint_title TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS print_provider_title TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS store_preset_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS schema_version INTEGER DEFAULT 1;

-- 2. Drop deprecated legacy offset columns
ALTER TABLE store_mockup_templates
  DROP COLUMN IF EXISTS placement_offset_x_mm,
  DROP COLUMN IF EXISTS placement_offset_y_mm,
  DROP COLUMN IF EXISTS placement_scale_percent;

-- 3. StoreColor: add enabled flag
ALTER TABLE store_colors
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT true;

-- 4. Feature flags
INSERT INTO feature_flags (key, enabled, rollout_percent, description)
VALUES
  ('wizard_v3', false, 0, 'Phase 6.10 5-step wizard'),
  ('store_preset_required', false, 0, 'Enforce presetStatus.ready before wizard start'),
  ('placement_override_visible', true, 100, 'Show placement override UI in wizard step-3')
ON CONFLICT (key) DO NOTHING;
