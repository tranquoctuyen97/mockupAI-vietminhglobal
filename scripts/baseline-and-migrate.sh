#!/bin/bash
# Baseline existing migrations + deploy new ones on VPS
# Usage: bash scripts/baseline-and-migrate.sh

set -e

echo "=== Step 1: Baseline all existing migrations ==="

# These migrations already exist in the DB (ran manually or via push)
# Mark them as "applied" without actually running the SQL
MIGRATIONS=(
  "0001_baseline_before_0015c"
  "0015c_wizard_mockup_stale"
  "0016_store_as_template"
  "0017_schema_alignment"
  "0018_wizard_draft_stale_trigger_alignment"
  "0019_phase_c_printify_mockups"
  "0020_phase_c_feature_flags"
  "0021_add_size_variants"
  "0022_ai_multi_provider_prompt_usage"
  "0023_ai_provider_model_cache"
  "0024_rbac_inkhub"
  "0025_triple_whale"
  "0026_schema_history_alignment"
  "0027_custom_mockup_library"
  "0028_custom_mockup_source_scopes"
  "0029_template_default_mockup_source"
  "0030_mockup_selection_primary"
  "0031_add_multi_design_wizard"
  "20260521131516_custom_mockup_source_scopes"
)

for m in "${MIGRATIONS[@]}"; do
  echo "  Resolving: $m"
  npx prisma migrate resolve --applied "$m" 2>/dev/null || echo "    (already resolved or skipped)"
done

echo ""
echo "=== Step 2: Deploy pending migrations ==="
npx prisma migrate deploy

echo ""
echo "=== Step 3: Generate Prisma client ==="
npx prisma generate

echo ""
echo "=== Done! Restart your app: pm2 restart mockupai ==="
