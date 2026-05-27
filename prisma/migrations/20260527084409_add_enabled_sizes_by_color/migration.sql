-- AlterTable
ALTER TABLE "store_mockup_templates" ADD COLUMN     "enabled_sizes_by_color" JSONB;

-- AlterTable
ALTER TABLE "wizard_drafts" ADD COLUMN     "enabled_sizes_by_color" JSONB;
