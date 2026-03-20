-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "planName" TEXT NOT NULL DEFAULT 'Free',
    "monthlyCustomerTagCount" INTEGER NOT NULL DEFAULT 0,
    "monthlyOrderTagCount" INTEGER NOT NULL DEFAULT 0,
    "monthlyRemovalCount" INTEGER NOT NULL DEFAULT 0,
    "usageResetDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncTagsToNotes" BOOLEAN NOT NULL DEFAULT false,
    "enableSentimentAnalysis" BOOLEAN NOT NULL DEFAULT false,
    "isSyncing" BOOLEAN NOT NULL DEFAULT false,
    "syncTarget" INTEGER NOT NULL DEFAULT 0,
    "syncCompleted" INTEGER NOT NULL DEFAULT 0,
    "syncMessage" TEXT,
    "lastSyncCompletedAt" DATETIME,
    "klaviyoApiKey" TEXT,
    "klaviyoAccessToken" TEXT,
    "klaviyoRefreshToken" TEXT,
    "klaviyoIsActive" BOOLEAN NOT NULL DEFAULT false,
    "mailchimpApiKey" TEXT,
    "mailchimpServerPrefix" TEXT,
    "mailchimpListId" TEXT,
    "welcomeEmailSent" BOOLEAN NOT NULL DEFAULT false,
    "hasSeenTour" BOOLEAN NOT NULL DEFAULT false,
    "klaviyoSyncInProgress" BOOLEAN NOT NULL DEFAULT false,
    "mailchimpSyncInProgress" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Store" ("createdAt", "enableSentimentAnalysis", "hasSeenTour", "id", "isActive", "isSyncing", "klaviyoAccessToken", "klaviyoApiKey", "klaviyoIsActive", "klaviyoRefreshToken", "klaviyoSyncInProgress", "lastSyncCompletedAt", "mailchimpApiKey", "mailchimpListId", "mailchimpServerPrefix", "mailchimpSyncInProgress", "planName", "shop", "syncCompleted", "syncMessage", "syncTagsToNotes", "syncTarget", "updatedAt", "welcomeEmailSent") SELECT "createdAt", "enableSentimentAnalysis", "hasSeenTour", "id", "isActive", "isSyncing", "klaviyoAccessToken", "klaviyoApiKey", "klaviyoIsActive", "klaviyoRefreshToken", "klaviyoSyncInProgress", "lastSyncCompletedAt", "mailchimpApiKey", "mailchimpListId", "mailchimpServerPrefix", "mailchimpSyncInProgress", "planName", "shop", "syncCompleted", "syncMessage", "syncTagsToNotes", "syncTarget", "updatedAt", "welcomeEmailSent" FROM "Store";
DROP TABLE "Store";
ALTER TABLE "new_Store" RENAME TO "Store";
CREATE UNIQUE INDEX "Store_shop_key" ON "Store"("shop");
CREATE INDEX "Store_shop_idx" ON "Store"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

