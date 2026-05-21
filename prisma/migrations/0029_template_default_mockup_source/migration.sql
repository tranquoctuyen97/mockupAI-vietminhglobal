-- CreateEnum
CREATE TYPE "TemplateDefaultMockupSource" AS ENUM ('PRINTIFY', 'CUSTOM');

-- AlterTable
ALTER TABLE "store_mockup_templates" ADD COLUMN "default_mockup_source" "TemplateDefaultMockupSource" NOT NULL DEFAULT 'PRINTIFY';
