-- Phase 6.10 — align wizard draft stale trigger with store-as-template schema

DROP TRIGGER IF EXISTS trg_wizard_drafts_stale ON wizard_drafts;

ALTER TABLE wizard_drafts
  ADD COLUMN IF NOT EXISTS enabled_variant_ids_override INTEGER[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS enabled_color_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS placement_override JSONB;

UPDATE wizard_drafts
SET
  enabled_variant_ids_override = COALESCE(enabled_variant_ids_override, '{}'),
  enabled_color_ids = COALESCE(enabled_color_ids, '{}');

ALTER TABLE wizard_drafts
  ALTER COLUMN enabled_variant_ids_override SET DEFAULT '{}',
  ALTER COLUMN enabled_color_ids SET DEFAULT '{}';

CREATE OR REPLACE FUNCTION mark_mockups_stale_on_draft_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.enabled_color_ids IS DISTINCT FROM NEW.enabled_color_ids
    OR OLD.enabled_variant_ids_override IS DISTINCT FROM NEW.enabled_variant_ids_override
    OR OLD.store_id IS DISTINCT FROM NEW.store_id THEN
    NEW.mockups_stale := true;
    NEW.mockups_stale_reason := 'colors_changed';

  ELSIF OLD.design_id IS DISTINCT FROM NEW.design_id THEN
    NEW.mockups_stale := true;
    NEW.mockups_stale_reason := 'design_changed';

  ELSIF OLD.placement_override IS DISTINCT FROM NEW.placement_override THEN
    NEW.mockups_stale := true;
    NEW.mockups_stale_reason := 'placement_changed';

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wizard_drafts_stale
BEFORE UPDATE ON wizard_drafts
FOR EACH ROW
EXECUTE FUNCTION mark_mockups_stale_on_draft_change();
