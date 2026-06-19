ALTER TABLE "store_mockup_templates"
  ADD COLUMN "base_price_usd" DECIMAL(10, 2),
  ADD COLUMN "price_by_size_default" JSONB,
  ADD COLUMN "default_composite_region_px" JSONB;
