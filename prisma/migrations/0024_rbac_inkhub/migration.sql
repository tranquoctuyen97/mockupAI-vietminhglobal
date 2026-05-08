-- Add SUPER_ADMIN to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN' BEFORE 'ADMIN';

-- CreateTable tenant_role_permissions
CREATE TABLE "tenant_role_permissions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "feature" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable inkhub_credentials
CREATE TABLE "inkhub_credentials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_encrypted" BYTEA NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inkhub_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_role_permissions_tenant_id_role_feature_key" ON "tenant_role_permissions"("tenant_id", "role", "feature");
CREATE INDEX "tenant_role_permissions_tenant_id_role_idx" ON "tenant_role_permissions"("tenant_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "inkhub_credentials_tenant_id_key" ON "inkhub_credentials"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_role_permissions" ADD CONSTRAINT "tenant_role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inkhub_credentials" ADD CONSTRAINT "inkhub_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
