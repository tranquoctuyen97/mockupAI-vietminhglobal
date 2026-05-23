import { GET } from "./src/app/api/wizard/drafts/[id]/mockup-sources/route";
import { NextRequest } from "next/server";

async function main() {
  process.env.DATABASE_URL = "postgresql://neondb_owner:npg_cwG3PVoz1lrb@ep-raspy-heart-ac1zj341.sa-east-1.aws.neon.tech/neondb?sslmode=verify-full";
  
  // We mock requireFeature to return a dummy session
  // Since requireFeature is imported inside the route file, we can bypass it by injecting a mock or setting mock session info if requireFeature reads from cookies/headers.
  // Actually requireFeature("mockup_library") checks the session. Let's see how requireFeature is implemented.
}
main();
