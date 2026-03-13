import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });

async function run() {
    const rawUrl = process.env.PRISMA_DB_URL;
    if (!rawUrl) throw new Error("PRISMA_DB_URL not set");
    
    if (rawUrl.startsWith("file:") || rawUrl.startsWith("sqlite:")) {
        console.log("⏭️  Local SQLite database detected. Skipping Turso remote migration script.");
        return;
    }
    
    // Convert libsql://... to https://...
    const httpsUrl = rawUrl.replace(/^libsql:\/\//, "https://");
    const [baseUrl, query] = httpsUrl.split("?");
    const tokenParams = new URLSearchParams(query);
    const authToken = tokenParams.get("authToken");
    
    console.log("Connecting to:", baseUrl);

    try {
        const response = await fetch(`${baseUrl}/v2/pipeline`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                requests: [
                    { type: "execute", stmt: { sql: "ALTER TABLE Rule ADD COLUMN lastSyncCompletedAt DATETIME;" } },
                    { type: "close" }
                ]
            })
        });

        const data = await response.json();
        
        if (data.results && data.results[0].type === "ok") {
            console.log("✅ Successfully added lastSyncCompletedAt column to Turso Store table");
        } else if (JSON.stringify(data).includes("duplicate column name")) {
            console.log("✅ Column lastSyncCompletedAt already exists");
        } else {
            console.error("❌ Error adding column. Response:", JSON.stringify(data, null, 2));
        }
    } catch (err) {
        console.error("❌ Request failed:", err.message);
    }
}

run();
