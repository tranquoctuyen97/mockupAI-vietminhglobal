CREATE TYPE "McpProfileStatus" AS ENUM (
  'SETUP_INCOMPLETE',
  'ENABLED',
  'DISABLED',
  'SUSPENDED'
);

CREATE TYPE "McpCredentialStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "McpIdempotencyStatus" AS ENUM ('IN_PROGRESS', 'SUCCEEDED');
CREATE TYPE "McpAssetTransferStatus" AS ENUM ('FETCHING', 'READY', 'ATTACHED', 'FAILED');
CREATE TYPE "McpAssetKind" AS ENUM ('DESIGN', 'MOCKUP');

CREATE TABLE "mcp_profiles" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "status" "McpProfileStatus" NOT NULL DEFAULT 'SETUP_INCOMPLETE',
  "suspension_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "default_store_id" TEXT,
  "tool_preferences" JSONB,
  "enabled_at" TIMESTAMP(3),
  "resumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mcp_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_credentials" (
  "id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "token_prefix" TEXT NOT NULL,
  "scopes" TEXT[],
  "status" "McpCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_clients" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "client_name" TEXT NOT NULL,
  "redirect_uris" TEXT[],
  "grant_types" TEXT[],
  "response_types" TEXT[],
  "token_endpoint_auth_method" TEXT NOT NULL DEFAULT 'none',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mcp_oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_authorization_codes" (
  "id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "oauth_client_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "redirect_uri" TEXT NOT NULL,
  "code_challenge" TEXT NOT NULL,
  "code_challenge_method" TEXT NOT NULL DEFAULT 'S256',
  "scopes" TEXT[],
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_grants" (
  "id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "oauth_client_id" TEXT NOT NULL,
  "access_token_hash" TEXT NOT NULL,
  "refresh_token_hash" TEXT NOT NULL,
  "token_prefix" TEXT NOT NULL,
  "scopes" TEXT[],
  "expires_at" TIMESTAMP(3) NOT NULL,
  "refresh_expires_at" TIMESTAMP(3) NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mcp_oauth_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_idempotency_records" (
  "id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "tool_name" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "status" "McpIdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "response" JSONB,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mcp_idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_asset_transfers" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "profile_id" TEXT,
  "wizard_draft_id" TEXT,
  "kind" "McpAssetKind" NOT NULL,
  "status" "McpAssetTransferStatus" NOT NULL DEFAULT 'FETCHING',
  "storage_path" TEXT,
  "preview_path" TEXT,
  "source_url_redacted" TEXT NOT NULL,
  "attached_resource_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mcp_asset_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_profiles_owner_user_id_key" ON "mcp_profiles"("owner_user_id");
CREATE INDEX "mcp_profiles_tenant_id_status_idx" ON "mcp_profiles"("tenant_id", "status");
CREATE UNIQUE INDEX "mcp_credentials_token_hash_key" ON "mcp_credentials"("token_hash");
CREATE INDEX "mcp_credentials_profile_id_status_idx" ON "mcp_credentials"("profile_id", "status");
CREATE UNIQUE INDEX "mcp_oauth_clients_client_id_key" ON "mcp_oauth_clients"("client_id");
CREATE UNIQUE INDEX "mcp_oauth_authorization_codes_code_hash_key" ON "mcp_oauth_authorization_codes"("code_hash");
CREATE INDEX "mcp_oauth_authorization_codes_profile_id_expires_at_idx" ON "mcp_oauth_authorization_codes"("profile_id", "expires_at");
CREATE UNIQUE INDEX "mcp_oauth_grants_access_token_hash_key" ON "mcp_oauth_grants"("access_token_hash");
CREATE UNIQUE INDEX "mcp_oauth_grants_refresh_token_hash_key" ON "mcp_oauth_grants"("refresh_token_hash");
CREATE INDEX "mcp_oauth_grants_profile_id_revoked_at_idx" ON "mcp_oauth_grants"("profile_id", "revoked_at");
CREATE UNIQUE INDEX "mcp_idempotency_records_profile_id_tool_name_idempotency_key_key"
  ON "mcp_idempotency_records"("profile_id", "tool_name", "idempotency_key");
CREATE INDEX "mcp_idempotency_records_expires_at_idx" ON "mcp_idempotency_records"("expires_at");
CREATE INDEX "mcp_asset_transfers_status_expires_at_idx" ON "mcp_asset_transfers"("status", "expires_at");
CREATE INDEX "mcp_asset_transfers_tenant_id_wizard_draft_id_idx" ON "mcp_asset_transfers"("tenant_id", "wizard_draft_id");

ALTER TABLE "mcp_profiles"
  ADD CONSTRAINT "mcp_profiles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mcp_profiles_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mcp_profiles_default_store_id_fkey"
  FOREIGN KEY ("default_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mcp_credentials"
  ADD CONSTRAINT "mcp_credentials_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "mcp_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_oauth_authorization_codes"
  ADD CONSTRAINT "mcp_oauth_authorization_codes_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "mcp_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mcp_oauth_authorization_codes_oauth_client_id_fkey"
  FOREIGN KEY ("oauth_client_id") REFERENCES "mcp_oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_oauth_grants"
  ADD CONSTRAINT "mcp_oauth_grants_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "mcp_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mcp_oauth_grants_oauth_client_id_fkey"
  FOREIGN KEY ("oauth_client_id") REFERENCES "mcp_oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_idempotency_records"
  ADD CONSTRAINT "mcp_idempotency_records_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "mcp_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_asset_transfers"
  ADD CONSTRAINT "mcp_asset_transfers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mcp_asset_transfers_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "mcp_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "mcp_asset_transfers_wizard_draft_id_fkey"
  FOREIGN KEY ("wizard_draft_id") REFERENCES "wizard_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
