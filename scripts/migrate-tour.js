import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config();

const dbUrl = process.env.TURSO_DATABASE_URL;
const dbAuthToken = process.env.TURSO_AUTH_TOKEN;

if (!dbUrl || !dbAuthToken) {
  console.error("Missing TURSO credentials in .env");
  process.exit(1);
}

const client = createClient({
  url: dbUrl,
  authToken: dbAuthToken,
});

async function runMigration() {
  try {
    console.log("Adding hasSeenTour column to Store table...");
    await client.execute("ALTER TABLE Store ADD COLUMN hasSeenTour BOOLEAN NOT NULL DEFAULT false;");
    console.log("Migration successful!");
  } catch (error) {
    if (error.message && error.message.includes("duplicate column name")) {
      console.log("Column already exists. Safe to ignore.");
    } else {
      console.error("Migration failed:", error);
    }
  }
}

runMigration();
