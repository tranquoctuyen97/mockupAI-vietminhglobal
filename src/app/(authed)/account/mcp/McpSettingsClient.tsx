"use client";

import {
  Check,
  Clipboard,
  KeyRound,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type ProfileStatus = "SETUP_INCOMPLETE" | "ENABLED" | "DISABLED" | "SUSPENDED";

type Credential = {
  id: string;
  label: string;
  tokenPrefix: string;
  scopes: string[];
  status: string;
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
};

type OAuthGrant = {
  id: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  client: { clientId: string; clientName: string };
};

type Profile = {
  id: string;
  status: ProfileStatus;
  suspensionReason: string | null;
  defaultStoreId: string | null;
  createdAt: string;
  updatedAt: string;
  credentials: Credential[];
  oauthGrants: OAuthGrant[];
};

type RateLimits = Record<string, { readonly limit: number; readonly windowSeconds: number }>;

type Props = {
  effectiveGroups: string[];
  initialProfile: Profile | null;
  publicUrl: string;
  rateLimits: RateLimits;
  stores: Array<{ id: string; name: string; status: string }>;
};

const SETUP_STEPS = [
  "Inherited access",
  "Choose connection",
  "Create profile & credential",
  "Connect your client",
  "Test & finish",
];

export default function McpSettingsClient({
  effectiveGroups,
  initialProfile,
  publicUrl,
  rateLimits,
  stores,
}: Props) {
  const [profile, setProfile] = useState(initialProfile);
  const [connectionKind, setConnectionKind] = useState<"PAT" | "OAUTH">("PAT");
  const [selectedScopes, setSelectedScopes] = useState(() => new Set(effectiveGroups));
  const [label, setLabel] = useState("Codex local");
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [plaintextToken, setPlaintextToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testCredentialId, setTestCredentialId] = useState(
    initialProfile?.credentials.find((credential) => credential.status === "ACTIVE")?.id ?? "",
  );

  const activeCredentials = useMemo(
    () =>
      profile?.credentials.filter(
        (credential) =>
          credential.status === "ACTIVE" && new Date(credential.expiresAt).getTime() > Date.now(),
      ) ?? [],
    [profile],
  );
  const mcpEndpoint = `${publicUrl}/mcp`;
  const setupIncomplete =
    !profile ||
    profile.status === "SETUP_INCOMPLETE" ||
    (profile.status === "ENABLED" &&
      activeCredentials.length === 0 &&
      !profile.oauthGrants.some((grant) => !grant.revokedAt));

  async function requestJson(path: string, init?: RequestInit) {
    const response = await fetch(path, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Request failed");
    return data;
  }

  async function ensureEnabledProfile(): Promise<void> {
    let current = profile;
    if (!current) {
      const created = await requestJson("/api/account/mcp/profile", {
        method: "POST",
      });
      current = { ...created.profile, credentials: [], oauthGrants: [] };
      setProfile(current);
    }
    if (current?.status === "SETUP_INCOMPLETE" || current?.status === "DISABLED") {
      const enabled = await requestJson("/api/account/mcp/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable" }),
      });
      setProfile((value) => (value ? { ...value, ...enabled.profile } : value));
    }
  }

  async function createCredential() {
    setBusy("create");
    try {
      await ensureEnabledProfile();
      if (connectionKind === "OAUTH") {
        toast.success("Profile ready. Your OAuth client can now start PKCE authorization.");
        window.location.reload();
        return;
      }
      const created = await requestJson("/api/account/mcp/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          scopes: [...selectedScopes],
          expiresInDays,
        }),
      });
      setPlaintextToken(created.plaintextToken);
      setTestCredentialId(created.credential.id);
      setProfile((value) =>
        value
          ? {
              ...value,
              status: "ENABLED",
              credentials: [
                {
                  ...created.credential,
                  status: "ACTIVE",
                  lastUsedAt: null,
                  createdAt: new Date().toISOString(),
                },
                ...value.credentials,
              ],
            }
          : value,
      );
      toast.success("Credential created. Copy the secret now; it will not be shown again.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Setup failed");
    } finally {
      setBusy(null);
    }
  }

  async function updateProfile(action: "enable" | "disable" | "resume") {
    setBusy(action);
    try {
      const data = await requestJson("/api/account/mcp/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setProfile((value) => (value ? { ...value, ...data.profile } : value));
      toast.success(action === "resume" ? "MCP resumed" : `MCP ${action}d`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Profile update failed");
    } finally {
      setBusy(null);
    }
  }

  async function revokeCredential(credentialId: string) {
    setBusy(credentialId);
    try {
      await requestJson(`/api/account/mcp/credentials/${credentialId}`, {
        method: "DELETE",
      });
      setProfile((value) =>
        value
          ? {
              ...value,
              credentials: value.credentials.map((credential) =>
                credential.id === credentialId ? { ...credential, status: "REVOKED" } : credential,
              ),
            }
          : value,
      );
      toast.success("Credential revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Revoke failed");
    } finally {
      setBusy(null);
    }
  }

  async function revokeOAuthGrant(grantId: string) {
    setBusy(grantId);
    try {
      await requestJson(`/api/account/mcp/oauth-grants/${grantId}`, {
        method: "DELETE",
      });
      setProfile((value) =>
        value
          ? {
              ...value,
              oauthGrants: value.oauthGrants.map((grant) =>
                grant.id === grantId ? { ...grant, revokedAt: new Date().toISOString() } : grant,
              ),
            }
          : value,
      );
      toast.success("OAuth grant revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "OAuth revoke failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveDefaultStore(defaultStoreId: string) {
    try {
      await requestJson("/api/account/mcp/defaults", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultStoreId: defaultStoreId || null }),
      });
      setProfile((value) => (value ? { ...value, defaultStoreId: defaultStoreId || null } : value));
      toast.success("Default store updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Default update failed");
    }
  }

  async function testConnection() {
    if (!testCredentialId) {
      toast.error("Select an active credential first");
      return;
    }
    setBusy("test");
    try {
      const data = await requestJson("/api/account/mcp/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: testCredentialId }),
      });
      toast.success(`Connection healthy: ${data.scopes.join(", ")}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection test failed");
    } finally {
      setBusy(null);
    }
  }

  function toggleScope(scope: string) {
    setSelectedScopes((current) => {
      const next = new Set(current);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <section className="card card-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-card-heading">Your MCP connection</h2>
              <span
                className={`badge ${
                  profile?.status === "ENABLED" ? "badge-success" : "badge-info"
                }`}
              >
                {profile?.status ?? "NOT SET UP"}
              </span>
            </div>
            <p className="text-body mt-2" style={{ color: "var(--text-secondary)" }}>
              You own this profile and its credentials. SUPER_ADMIN cannot create or reveal them.
            </p>
          </div>
          {profile?.status === "SUSPENDED" ? (
            <button
              className="btn-primary"
              disabled={busy === "resume"}
              onClick={() => updateProfile("resume")}
              type="button"
            >
              <PlayCircle size={16} />
              Resume MCP
            </button>
          ) : profile?.status === "ENABLED" ? (
            <button
              className="btn-secondary"
              disabled={busy === "disable"}
              onClick={() => updateProfile("disable")}
              type="button"
            >
              <PauseCircle size={16} />
              Disable
            </button>
          ) : profile?.status === "DISABLED" ? (
            <button
              className="btn-primary"
              disabled={busy === "enable"}
              onClick={() => updateProfile("enable")}
              type="button"
            >
              <PlayCircle size={16} />
              Enable
            </button>
          ) : null}
        </div>
        {profile?.status === "SUSPENDED" && (
          <div
            className="mt-4 rounded-lg border p-4"
            style={{ borderColor: "var(--color-warning)" }}
          >
            Permission was restored, but restoration never auto-resumes MCP.
            {profile.suspensionReason ? ` Reason: ${profile.suspensionReason}` : ""}
          </div>
        )}
      </section>

      {setupIncomplete && (
        <section className="card card-lg">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="badge badge-info">Setup incomplete</span>
              <h2 className="text-card-heading mt-3">Set up your MCP profile</h2>
            </div>
            <span className="text-caption" style={{ color: "var(--text-muted)" }}>
              Resumable
            </span>
          </div>
          <ol className="mt-6 grid gap-3 md:grid-cols-5">
            {SETUP_STEPS.map((step, index) => (
              <li
                className="rounded-lg border p-3"
                key={step}
                style={{ borderColor: "var(--border-default)" }}
              >
                <span className="text-caption" style={{ color: "var(--text-muted)" }}>
                  0{index + 1}
                </span>
                <p className="mt-1 text-sm font-semibold">{step}</p>
              </li>
            ))}
          </ol>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <div className="rounded-lg border p-5" style={{ borderColor: "var(--border-default)" }}>
              <h3 className="font-semibold">Inherited access</h3>
              <p className="text-body mt-2" style={{ color: "var(--text-secondary)" }}>
                All tenant stores are listable. The default store below is convenience only, not
                store-level ACL.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {effectiveGroups.map((group) => (
                  <label className="badge badge-success cursor-pointer" key={group}>
                    <input
                      checked={selectedScopes.has(group)}
                      className="mr-1"
                      onChange={() => toggleScope(group)}
                      type="checkbox"
                    />
                    {group}
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-lg border p-5" style={{ borderColor: "var(--border-default)" }}>
              <h3 className="font-semibold">Choose connection</h3>
              <div className="mt-3 grid gap-2">
                <button
                  className={connectionKind === "PAT" ? "btn-primary" : "btn-secondary"}
                  onClick={() => setConnectionKind("PAT")}
                  type="button"
                >
                  <KeyRound size={16} />
                  Personal access token
                </button>
                <button
                  className={connectionKind === "OAUTH" ? "btn-primary" : "btn-secondary"}
                  onClick={() => setConnectionKind("OAUTH")}
                  type="button"
                >
                  <ShieldCheck size={16} />
                  OAuth PKCE
                </button>
              </div>
            </div>
          </div>

          {connectionKind === "PAT" && (
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <label className="text-sm">
                Label
                <input
                  className="input mt-1 w-full"
                  maxLength={80}
                  onChange={(event) => setLabel(event.target.value)}
                  value={label}
                />
              </label>
              <label className="text-sm">
                Expires
                <select
                  className="input mt-1 w-full"
                  onChange={(event) => setExpiresInDays(Number(event.target.value))}
                  value={expiresInDays}
                >
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={180}>180 days</option>
                  <option value={365}>365 days</option>
                </select>
              </label>
              <button
                className="btn-primary self-end"
                disabled={busy === "create" || selectedScopes.size === 0}
                onClick={createCredential}
                type="button"
              >
                {busy === "create" ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <KeyRound size={16} />
                )}
                Create profile & credential
              </button>
            </div>
          )}
          {connectionKind === "OAUTH" && (
            <div
              className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
              style={{ borderColor: "var(--border-default)" }}
            >
              <p className="text-body" style={{ color: "var(--text-secondary)" }}>
                Prepare the profile, then let Claude, Codex, or n8n start OAuth dynamic registration
                and PKCE authorization.
              </p>
              <button
                className="btn-primary"
                disabled={busy === "create"}
                onClick={createCredential}
                type="button"
              >
                Prepare OAuth profile
              </button>
            </div>
          )}
        </section>
      )}

      {plaintextToken && (
        <section className="card card-lg" style={{ borderColor: "var(--color-warning)" }}>
          <h2 className="text-card-heading">Copy this token now</h2>
          <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
            It is shown once and cannot be recovered.
          </p>
          <div className="mt-3 flex gap-2">
            <code
              className="min-w-0 flex-1 overflow-x-auto rounded-lg p-3 text-sm"
              style={{ background: "var(--bg-tertiary)" }}
            >
              {plaintextToken}
            </code>
            <button
              className="btn-secondary"
              onClick={() => navigator.clipboard.writeText(plaintextToken)}
              type="button"
            >
              <Clipboard size={16} />
              Copy
            </button>
          </div>
        </section>
      )}

      {profile && (
        <>
          <section className="grid gap-5 lg:grid-cols-2">
            <div className="card card-lg">
              <h2 className="text-card-heading">Personal defaults</h2>
              <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
                This preselects a store; it never limits list_stores.
              </p>
              <select
                className="input mt-4 w-full"
                onChange={(event) => saveDefaultStore(event.target.value)}
                value={profile.defaultStoreId ?? ""}
              >
                <option value="">No default</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name} · {store.status}
                  </option>
                ))}
              </select>
            </div>
            <div className="card card-lg">
              <h2 className="text-card-heading">Inherited rate limits</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {Object.entries(rateLimits).map(([name, config]) => (
                  <div
                    className="rounded-lg border p-3"
                    key={name}
                    style={{ borderColor: "var(--border-default)" }}
                  >
                    <p className="text-sm font-semibold">{name}</p>
                    <p className="text-caption" style={{ color: "var(--text-muted)" }}>
                      {config.limit} / {config.windowSeconds}s
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="card card-lg">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-card-heading">Personal credentials</h2>
                <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
                  Prefixes and scope snapshots are safe to display; secrets are never recoverable.
                </p>
              </div>
              <button
                className="btn-secondary"
                onClick={() => window.location.reload()}
                type="button"
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name / client</th>
                    <th>Prefix</th>
                    <th>Scopes</th>
                    <th>Expiry</th>
                    <th>Last used</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.credentials.map((credential) => (
                    <tr key={credential.id}>
                      <td>{credential.label}</td>
                      <td className="font-mono text-xs">{credential.tokenPrefix}…</td>
                      <td>{credential.scopes.join(", ")}</td>
                      <td>{new Date(credential.expiresAt).toLocaleDateString()}</td>
                      <td>
                        {credential.lastUsedAt
                          ? new Date(credential.lastUsedAt).toLocaleString()
                          : "Never"}
                      </td>
                      <td>
                        {credential.status === "ACTIVE" ? (
                          <button
                            className="btn-danger-ghost"
                            disabled={busy === credential.id}
                            onClick={() => revokeCredential(credential.id)}
                            type="button"
                          >
                            <Trash2 size={14} />
                            Revoke
                          </button>
                        ) : (
                          <span className="badge badge-danger">{credential.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {profile.oauthGrants.map((grant) => (
                    <tr key={grant.id}>
                      <td>
                        {grant.client.clientName} · {grant.client.clientId}
                      </td>
                      <td className="font-mono text-xs">{grant.tokenPrefix}…</td>
                      <td>{grant.scopes.join(", ")}</td>
                      <td>{new Date(grant.expiresAt).toLocaleDateString()}</td>
                      <td>
                        {grant.lastUsedAt ? new Date(grant.lastUsedAt).toLocaleString() : "Never"}
                      </td>
                      <td>
                        {grant.revokedAt ? (
                          <span className="badge badge-danger">REVOKED</span>
                        ) : (
                          <button
                            className="btn-danger-ghost"
                            disabled={busy === grant.id}
                            onClick={() => revokeOAuthGrant(grant.id)}
                            type="button"
                          >
                            <Trash2 size={14} />
                            Revoke OAuth grant
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!setupIncomplete && (
              <div
                className="mt-5 rounded-lg border p-4"
                style={{ borderColor: "var(--border-default)" }}
              >
                <h3 className="font-semibold">Create or rotate a PAT</h3>
                <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
                  Create replacement, test the new client, then revoke the old credential. Existing
                  credentials remain independent.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {effectiveGroups.map((group) => (
                    <label className="badge badge-success cursor-pointer" key={group}>
                      <input
                        checked={selectedScopes.has(group)}
                        className="mr-1"
                        onChange={() => toggleScope(group)}
                        type="checkbox"
                      />
                      {group}
                    </label>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <label className="text-sm">
                    Label
                    <input
                      className="input mt-1 w-full"
                      maxLength={80}
                      onChange={(event) => setLabel(event.target.value)}
                      value={label}
                    />
                  </label>
                  <label className="text-sm">
                    Expires
                    <select
                      className="input mt-1 w-full"
                      onChange={(event) => setExpiresInDays(Number(event.target.value))}
                      value={expiresInDays}
                    >
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                      <option value={180}>180 days</option>
                      <option value={365}>365 days</option>
                    </select>
                  </label>
                  <button
                    className="btn-primary self-end"
                    disabled={busy === "create" || selectedScopes.size === 0}
                    onClick={createCredential}
                    type="button"
                  >
                    <KeyRound size={16} />
                    Create replacement
                  </button>
                </div>
              </div>
            )}
            <div className="mt-5 flex flex-wrap items-end gap-3">
              <label className="min-w-64 flex-1 text-sm">
                Test credential
                <select
                  className="input mt-1 w-full"
                  onChange={(event) => setTestCredentialId(event.target.value)}
                  value={testCredentialId}
                >
                  <option value="">Select credential</option>
                  {activeCredentials.map((credential) => (
                    <option key={credential.id} value={credential.id}>
                      {credential.label} · {credential.tokenPrefix}…
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn-primary"
                disabled={busy === "test"}
                onClick={testConnection}
                type="button"
              >
                {busy === "test" ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                Test connection
              </button>
            </div>
          </section>
        </>
      )}

      <section className="card card-lg">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-card-heading">Connect your client</h2>
            <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
              MCP endpoint: <code>{mcpEndpoint}</code>
            </p>
          </div>
          <Link className="btn-secondary" href="/account/mcp/tools">
            Open Tool Reference
          </Link>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {[
            ["Claude", `URL: ${mcpEndpoint}\\nAuthorization: Bearer <YOUR_TOKEN>`],
            [
              "Codex",
              `[mcp_servers.mockupai]\\nurl = "${mcpEndpoint}"\\nbearer_token_env_var = "MOCKUPAI_MCP_TOKEN"`,
            ],
            ["n8n", `MCP URL: ${mcpEndpoint}\\nBearer token: {{ $env.MOCKUPAI_MCP_TOKEN }}`],
          ].map(([name, snippet]) => (
            <div
              className="rounded-lg border p-4"
              key={name}
              style={{ borderColor: "var(--border-default)" }}
            >
              <h3 className="font-semibold">{name}</h3>
              <pre
                className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs"
                style={{ color: "var(--text-secondary)" }}
              >
                {snippet}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
