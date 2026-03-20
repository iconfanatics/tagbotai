import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    // Basic security check (must be admin session)
    try {
        await authenticate.admin(request);
    } catch (e) {
        return new Response("Unauthorized", { status: 401 });
    }

    const results = [];
    
    // Commands to run one-by-one
    const commands = [
        `ALTER TABLE "Store" ADD COLUMN "monthlyCustomerTagCount" INTEGER DEFAULT 0`,
        `ALTER TABLE "Store" ADD COLUMN "monthlyOrderTagCount" INTEGER DEFAULT 0`,
        `ALTER TABLE "Store" ADD COLUMN "monthlyRemovalCount" INTEGER DEFAULT 0`,
        `ALTER TABLE "Store" ADD COLUMN "usageResetDate" DATETIME DEFAULT CURRENT_TIMESTAMP`
    ];

    for (const cmd of commands) {
        try {
            // We use $executeRawUnsafe to skip Prisma's schema validation
            // @ts-ignore
            await db.$executeRawUnsafe(cmd);
            results.push({ command: cmd, status: "SUCCESS" });
        } catch (err: any) {
            results.push({ command: cmd, status: "ERROR", message: err.message });
        }
    }

    return { 
        message: "Database repair attempted. If all say Error, the columns probably already exist.",
        results 
    };
};

export default function FixDb() {
    return <div>Repairing database... check server logs or returned JSON.</div>;
}
