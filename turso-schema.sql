-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);
-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "planName" TEXT NOT NULL DEFAULT 'Free',
    "monthlyTagCount" INTEGER NOT NULL DEFAULT 0,
    "syncTagsToNotes" BOOLEAN NOT NULL DEFAULT false,
    "enableSentimentAnalysis" BOOLEAN NOT NULL DEFAULT false,
    "isSyncing" BOOLEAN NOT NULL DEFAULT false,
    "syncTarget" INTEGER NOT NULL DEFAULT 0,
    "syncCompleted" INTEGER NOT NULL DEFAULT 0,
    "syncMessage" TEXT,
    "klaviyoApiKey" TEXT,
    "mailchimpApiKey" TEXT,
    "mailchimpServerPrefix" TEXT,
    "mailchimpListId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "conditions" TEXT NOT NULL,
    "targetTag" TEXT NOT NULL,
    "collectionId" TEXT,
    "collectionName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Rule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "totalSpent" REAL NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "lastOrderDate" DATETIME,
    "tags" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "ruleId" TEXT,
    "action" TEXT NOT NULL,
    "tagContext" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_customerId_storeId_fkey" FOREIGN KEY ("customerId", "storeId") REFERENCES "Customer" ("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule" ("id") ON DELETE
    SET NULL ON UPDATE CASCADE
);
-- CreateIndex
CREATE UNIQUE INDEX "Store_shop_key" ON "Store"("shop");
-- CreateIndex
CREATE INDEX "Store_shop_idx" ON "Store"("shop");
-- CreateIndex
CREATE INDEX "Rule_storeId_idx" ON "Rule"("storeId");
-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");
-- CreateIndex
CREATE INDEX "Customer_storeId_idx" ON "Customer"("storeId");
-- CreateIndex
CREATE UNIQUE INDEX "Customer_id_storeId_key" ON "Customer"("id", "storeId");