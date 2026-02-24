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
export async function getCachedStore(shop: string): Promise<Store | null> {
    const now = Date.now();
    const cached = cacheByShop.get(shop);

    if (cached && cached.expiry > now) {
        return cached.data;
    }

    const store = await db.store.findUnique({ where: { shop } });

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

    const store = await db.store.findUnique({ where: { id } });

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
