ALTER TABLE "wizard_drafts"
  ADD COLUMN "printify_draft_product_id" TEXT,
  ADD COLUMN "printify_image_id" TEXT;

ALTER TABLE "mockup_images"
  ADD COLUMN "mockup_type" TEXT NOT NULL DEFAULT 'front',
  ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "camera_label" TEXT;

CREATE INDEX "mockup_images_mockup_job_id_is_default_idx"
  ON "mockup_images"("mockup_job_id", "is_default");
