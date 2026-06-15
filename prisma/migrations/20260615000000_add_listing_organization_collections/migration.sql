ALTER TABLE "listings"
  ADD COLUMN IF NOT EXISTS "organization_collections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
