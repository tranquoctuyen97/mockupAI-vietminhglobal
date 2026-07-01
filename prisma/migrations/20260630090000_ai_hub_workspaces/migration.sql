CREATE TABLE "ai_hub_workspaces" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'codex',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_hub_workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_hub_member_workspaces" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_hub_member_workspaces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_hub_workspaces_tenant_id_provider_path_key"
  ON "ai_hub_workspaces"("tenant_id", "provider", "path");

CREATE INDEX "ai_hub_workspaces_tenant_id_provider_type_idx"
  ON "ai_hub_workspaces"("tenant_id", "provider", "type");

CREATE UNIQUE INDEX "ai_hub_member_workspaces_user_id_workspace_id_key"
  ON "ai_hub_member_workspaces"("user_id", "workspace_id");

CREATE INDEX "ai_hub_member_workspaces_workspace_id_idx"
  ON "ai_hub_member_workspaces"("workspace_id");

ALTER TABLE "ai_hub_workspaces"
  ADD CONSTRAINT "ai_hub_workspaces_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_hub_member_workspaces"
  ADD CONSTRAINT "ai_hub_member_workspaces_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_hub_member_workspaces"
  ADD CONSTRAINT "ai_hub_member_workspaces_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "ai_hub_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
