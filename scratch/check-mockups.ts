import pg from "pg";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const connectionString = process.env.DATABASE_URL;
const client = new pg.Client({ connectionString });

async function main() {
  await client.connect();
  const res = await client.query("SELECT tgname, tgtype FROM pg_trigger WHERE tgname NOT LIKE 'RI_%' AND tgname NOT LIKE 'pg_%'");
  console.log("=== NON-SYSTEM TRIGGERS ===");
  console.log(res.rows);
  await client.end();
}

main().catch(console.error);
