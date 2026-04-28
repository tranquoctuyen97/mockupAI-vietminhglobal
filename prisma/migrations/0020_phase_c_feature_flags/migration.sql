INSERT INTO feature_flags (key, enabled, rollout_percent, description)
VALUES
  ('printify_real_mockups', false, 100, 'Use real Printify draft products and Printify-hosted mockup images instead of local synthetic composites.'),
  ('printify_orphan_cleanup_enabled', true, 100, 'Allow cleanup tasks to delete orphan Printify draft products.')
ON CONFLICT (key) DO UPDATE
SET
  rollout_percent = CASE
    WHEN feature_flags.key = 'printify_real_mockups' THEN 100
    ELSE feature_flags.rollout_percent
  END,
  description = EXCLUDED.description;
