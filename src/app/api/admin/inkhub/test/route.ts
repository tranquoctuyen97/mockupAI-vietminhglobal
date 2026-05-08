import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";

const LOGIN_URL = "https://api-inkhub-v2.grabink.co/api/auth/login";

export async function POST(request: Request) {
  const { response } = await requireFeature("inkhub_config");
  if (response) return response;

  const { username, password } = await request.json() as { username: string; password: string };
  if (!username || !password) {
    return NextResponse.json({ error: "username and password required" }, { status: 400 });
  }

  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "https://inkhub.grabink.co",
      "referer": "https://inkhub.grabink.co/",
    },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: `Login failed: ${res.status}` });
  }

  const data = await res.json() as { organizations: Array<{ id: number }> };
  return NextResponse.json({
    ok: true,
    orgId: String(data.organizations[0]?.id ?? ""),
  });
}
