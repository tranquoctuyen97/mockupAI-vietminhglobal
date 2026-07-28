import { notFound } from "next/navigation";
import { getOAuthClient } from "@/lib/mcp/oauth-service";
import { OAuthConsentClient } from "./OAuthConsentClient";

export default async function McpOAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const clientId = typeof params.client_id === "string" ? params.client_id : "";
  const redirectUri = typeof params.redirect_uri === "string" ? params.redirect_uri : "";
  const codeChallenge = typeof params.code_challenge === "string" ? params.code_challenge : "";
  const scope = typeof params.scope === "string" ? params.scope : "";
  const state = typeof params.state === "string" ? params.state : undefined;
  const client = await getOAuthClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) notFound();

  return (
    <OAuthConsentClient
      clientName={client.clientName}
      request={{
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod: "S256",
        scopes: scope.split(" ").filter(Boolean),
        state,
      }}
    />
  );
}
