-- Migration 0015c: Wizard Draft Mockup Stale Detection
-- Phase 6.9 — adds mockups_stale flag + DB trigger

-- 1. Add columns
ALTER TABLE wizard_drafts
  ADD COLUMN IF NOT EXISTS mockups_stale BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mockups_stale_reason TEXT;

-- 2. Function: mark stale when relevant fields change
-- Uses IS DISTINCT FROM to correctly handle NULL values
-- (NULL != value gives NULL, not TRUE; IS DISTINCT FROM gives TRUE)
CREATE OR REPLACE FUNCTION mark_mockups_stale_on_draft_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Guard: only run on actual UPDATEs (OLD is non-null for UPDATE)
  -- Don't run when only updating mockups_stale itself or audit fields
  -- to prevent trigger loops

  IF OLD.selected_colors IS DISTINCT FROM NEW.selected_colors THEN
    NEW.mockups_stale := true;
    NEW.mockups_stale_reason := 'colors_changed';

  ELSIF OLD.design_id IS DISTINCT FROM NEW.design_id THEN
    NEW.mockups_stale := true;
    NEW.mockups_stale_reason := 'design_changed';

  ELSIF OLD.placement IS DISTINCT FROM NEW.placement THEN
    NEW.mockups_stale := true;
    NEW.mockups_stale_reason := 'placement_changed';

  END IF;
  -- Note: if only mockups_stale or updated_at changes → no action
  -- This prevents infinite loop when worker resets the flag

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Attach trigger (drop first to allow idempotent re-run)
DROP TRIGGER IF EXISTS trg_wizard_drafts_stale ON wizard_drafts;

CREATE TRIGGER trg_wizard_drafts_stale
BEFORE UPDATE ON wizard_drafts
FOR EACH ROW
EXECUTE FUNCTION mark_mockups_stale_on_draft_change();
