"use client";

import { useState } from "react";

type Props = {
  clientName: string;
  request: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
    scopes: string[];
    state?: string;
  };
};

export function OAuthConsentClient({ clientName, request }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function allow() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/mcp/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await response.json();
      if (!response.ok || !body.redirectTo) {
        throw new Error(body.error_description ?? "Authorization failed");
      }
      window.location.assign(body.redirectTo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authorization failed");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl py-16 px-6">
      <div className="card card-lg">
        <p className="text-caption mb-2">MCP OAuth authorization</p>
        <h1 className="text-section-heading">Allow {clientName}?</h1>
        <p className="text-body mt-3" style={{ color: "var(--text-secondary)" }}>
          This client will act only with the MCP scopes listed below. Your current ADMIN permissions
          continue to apply on every request.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {request.scopes.map((scope) => (
            <span className="badge" key={scope}>
              {scope}
            </span>
          ))}
        </div>
        {error ? (
          <p className="text-body mt-4" style={{ color: "var(--color-error)" }}>
            {error}
          </p>
        ) : null}
        <div className="mt-8 flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => window.history.back()} type="button">
            Deny
          </button>
          <button className="btn-primary" disabled={submitting} onClick={allow} type="button">
            {submitting ? "Authorizing..." : "Allow"}
          </button>
        </div>
      </div>
    </main>
  );
}
