import db from "../db.server";
import type { Store } from "@prisma/client";

// Simple in-memory LRU-style cache
const cacheByShop = new Map<string, { data: Store; expiry: number }>();
const cacheById = new Map<string, { data: Store; expiry: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Why: High-frequency webhooks (orders/paid, customers/create) and loaders repetitively query 
 * the Store configs (like Billing Plan, API keys). Caching this reduces DB load significantly.
 */
const REPAIR_COMMANDS = [
    `ALTER TABLE "Store" ADD COLUMN "monthlyCustomerTagCount" INTEGER DEFAULT 0`,
    `ALTER TABLE "Store" ADD COLUMN "monthlyOrderTagCount" INTEGER DEFAULT 0`,
    `ALTER TABLE "Store" ADD COLUMN "monthlyRemovalCount" INTEGER DEFAULT 0`,
    `ALTER TABLE "Store" ADD COLUMN "usageResetDate" DATETIME DEFAULT CURRENT_TIMESTAMP`
];

async function attemptRepair() {
    console.log("[DB_REPAIR] Starting automatic schema repair check...");
    try {
        // @ts-ignore
        const tableInfo = await db.$queryRawUnsafe(`PRAGMA table_info("Store")`) as any[];
        const existingColumns = tableInfo.map(c => c.name);
        
        const repairs = [
            { name: "monthlyCustomerTagCount", sql: `ALTER TABLE "Store" ADD COLUMN "monthlyCustomerTagCount" INTEGER DEFAULT 0` },
            { name: "monthlyOrderTagCount", sql: `ALTER TABLE "Store" ADD COLUMN "monthlyOrderTagCount" INTEGER DEFAULT 0` },
            { name: "monthlyRemovalCount", sql: `ALTER TABLE "Store" ADD COLUMN "monthlyRemovalCount" INTEGER DEFAULT 0` },
            { name: "usageResetDate", sql: `ALTER TABLE "Store" ADD COLUMN "usageResetDate" DATETIME DEFAULT CURRENT_TIMESTAMP` }
        ];

        for (const repair of repairs) {
            if (!existingColumns.includes(repair.name)) {
                try {
                    console.log(`[DB_REPAIR] Adding missing column: ${repair.name}`);
                    // @ts-ignore
                    await db.$executeRawUnsafe(repair.sql);
                    console.log(`[DB_REPAIR] SUCCESS: ${repair.name}`);
                } catch (e: any) {
                    console.error(`[DB_REPAIR] FAILED: ${repair.name} - ${e.message}`);
                }
            } else {
                console.log(`[DB_REPAIR] Column already exists: ${repair.name}`);
            }
        }
    } catch (err: any) {
        console.error(`[DB_REPAIR] Fatal error during schema check: ${err.message}`);
    }
}

export async function getCachedStore(shop: string): Promise<Store | null> {
    const now = Date.now();
    const cached = cacheByShop.get(shop);

    if (cached && cached.expiry > now) {
        return cached.data;
    }

    let store: Store | null = null;
    try {
        store = await db.store.findUnique({ where: { shop } });
    } catch (err: any) {
        if (err.message?.includes("no such column")) {
            console.error(`[DB_DRIFT] Detected missing columns for shop ${shop}. Attempting auto-repair.`);
            await attemptRepair();
            
            // Try one more time with full fetch
            try {
                store = await db.store.findUnique({ where: { shop } });
            } catch (retryErr) {
                // Last ditch: survival fetch
                // @ts-ignore
                store = await db.store.findUnique({
                    where: { shop },
                    select: { 
                        id: true, shop: true, isActive: true, planName: true,
                        hasSeenTour: true, welcomeEmailSent: true,
                        isSyncing: true, syncTarget: true, syncCompleted: true, syncMessage: true,
                        klaviyoIsActive: true, klaviyoApiKey: true,
                        mailchimpApiKey: true, mailchimpServerPrefix: true, mailchimpListId: true,
                        syncTagsToNotes: true, enableSentimentAnalysis: true,
                        createdAt: true, updatedAt: true
                    }
                }) as any;
            }
        } else {
            throw err;
        }
    }

    if (store) {
        cacheByShop.set(shop, { data: store, expiry: now + CACHE_TTL });
        cacheById.set(store.id, { data: store, expiry: now + CACHE_TTL });
    }

    return store;
}

export async function getCachedStoreById(id: string): Promise<Store | null> {
    const now = Date.now();
    const cached = cacheById.get(id);

    if (cached && cached.expiry > now) {
        return cached.data;
    }

    let store: Store | null = null;
    try {
        store = await db.store.findUnique({ where: { id } });
    } catch (err: any) {
        if (err.message?.includes("no such column")) {
            console.error(`[DB_DRIFT] Detected missing columns for ID ${id}. Attempting auto-repair.`);
            await attemptRepair();
            
            try {
                store = await db.store.findUnique({ where: { id } });
            } catch (retryErr) {
                // @ts-ignore
                store = await db.store.findUnique({
                    where: { id },
                    select: { 
                        id: true, shop: true, isActive: true, planName: true,
                        hasSeenTour: true, welcomeEmailSent: true,
                        isSyncing: true, syncTarget: true, syncCompleted: true, syncMessage: true,
                        klaviyoIsActive: true, klaviyoApiKey: true,
                        mailchimpApiKey: true, mailchimpServerPrefix: true, mailchimpListId: true,
                        syncTagsToNotes: true, enableSentimentAnalysis: true,
                        createdAt: true, updatedAt: true
                    }
                }) as any;
            }
        } else {
            throw err;
        }
    }

    if (store) {
        cacheById.set(id, { data: store, expiry: now + CACHE_TTL });
        cacheByShop.set(store.shop, { data: store, expiry: now + CACHE_TTL });
    }

    return store;
}

/**
 * Why: When a merchant updates their settings or upgrades their plan, 
 * we must invalidate the cache to ensure the next webhook uses the fresh rules.
 */
export function invalidateStoreCache(shop: string) {
    const cached = cacheByShop.get(shop);
    if (cached) {
        cacheById.delete(cached.data.id);
    }
    cacheByShop.delete(shop);
}

export function invalidateStoreCacheById(id: string) {
    const cached = cacheById.get(id);
    if (cached) {
        cacheByShop.delete(cached.data.shop);
    }
    cacheById.delete(id);
}
