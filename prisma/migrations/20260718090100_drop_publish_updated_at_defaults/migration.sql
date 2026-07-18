-- Keep Prisma @updatedAt as the single owner for updated_at values.
-- DROP DEFAULT is safe even when the column already has no default.
ALTER TABLE "publish_attempts" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "publish_outbox" ALTER COLUMN "updated_at" DROP DEFAULT;
