ALTER TABLE "stores"
  ADD COLUMN "shopify_currency_code" TEXT;

ALTER TABLE "store_credentials"
  ADD COLUMN "shopify_granted_scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
