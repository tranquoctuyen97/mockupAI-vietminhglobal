import "dotenv/config";
import { defineConfig, env } from "prisma/config";

process.env.DATABASE_URL ??= "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  migrations: {
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
