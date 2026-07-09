import dotenv from "dotenv";

dotenv.config({ path: ".env" });

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local", override: true });
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the standalone worker process.");
}
