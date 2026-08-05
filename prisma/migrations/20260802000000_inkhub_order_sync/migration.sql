ALTER TABLE "stores"
  ADD COLUMN "inkhub_shop_id" INTEGER,
  ADD COLUMN "inkhub_shop_label" TEXT;

CREATE UNIQUE INDEX "stores_tenant_id_inkhub_shop_id_key"
  ON "stores"("tenant_id", "inkhub_shop_id");

CREATE INDEX "stores_tenant_id_inkhub_shop_id_idx"
  ON "stores"("tenant_id", "inkhub_shop_id");

ALTER TABLE "orders"
  ALTER COLUMN "shopify_order_id" DROP NOT NULL,
  ADD COLUMN "inkhub_order_id" INTEGER,
  ADD COLUMN "inkhub_shop_id" INTEGER,
  ADD COLUMN "inkhub_code" TEXT,
  ADD COLUMN "inkhub_created_at" TIMESTAMP(3),
  ADD COLUMN "inkhub_updated_at" TIMESTAMP(3),
  ADD COLUMN "inkhub_synced_at" TIMESTAMP(3),
  ADD COLUMN "inkhub_status" TEXT,
  ADD COLUMN "actual_fulfillment_cost" DECIMAL(12,2),
  ADD COLUMN "actual_shipping_cost" DECIMAL(12,2),
  ADD COLUMN "actual_tax_cost" DECIMAL(12,2),
  ADD COLUMN "actual_other_cost" DECIMAL(12,2),
  ADD COLUMN "actual_total_cost" DECIMAL(12,2),
  ADD COLUMN "actual_cost_status" TEXT NOT NULL DEFAULT 'PENDING';

CREATE UNIQUE INDEX "orders_tenant_inkhub_shop_order_key"
  ON "orders"("tenant_id", "inkhub_shop_id", "inkhub_order_id");

CREATE INDEX "orders_tenant_id_inkhub_shop_id_inkhub_created_at_idx"
  ON "orders"("tenant_id", "inkhub_shop_id", "inkhub_created_at");

ALTER TABLE "order_line_items"
  ADD COLUMN "listing_id" TEXT,
  ADD COLUMN "inkhub_item_id" INTEGER,
  ADD COLUMN "inkhub_product_id" TEXT,
  ADD COLUMN "inkhub_variant_id" TEXT,
  ADD COLUMN "sku" TEXT,
  ADD COLUMN "actual_fulfillment_cost" DECIMAL(12,2),
  ADD COLUMN "actual_shipping_cost" DECIMAL(12,2),
  ADD COLUMN "actual_tax_cost" DECIMAL(12,2),
  ADD COLUMN "actual_other_cost" DECIMAL(12,2),
  ADD COLUMN "actual_total_cost" DECIMAL(12,2),
  ADD COLUMN "actual_cost_status" TEXT NOT NULL DEFAULT 'PENDING';

CREATE INDEX "order_line_items_listing_id_idx"
  ON "order_line_items"("listing_id");

CREATE INDEX "order_line_items_inkhub_product_id_inkhub_variant_id_idx"
  ON "order_line_items"("inkhub_product_id", "inkhub_variant_id");

CREATE UNIQUE INDEX "order_line_items_order_id_inkhub_item_id_key"
  ON "order_line_items"("order_id", "inkhub_item_id");

ALTER TABLE "order_line_items"
  ADD CONSTRAINT "order_line_items_listing_id_fkey"
  FOREIGN KEY ("listing_id") REFERENCES "listings"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
