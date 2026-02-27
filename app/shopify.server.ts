import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  BillingInterval,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

export const MONTHLY_PLAN = "Premium Plans";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  billing: {
    "Growth Plan": {
      lineItems: [{
        amount: 14.99,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      }],
    },
    "Growth Plan Yearly": {
      lineItems: [{
        amount: 152.90, // 14.99 * 12 * 0.85 = ~$152.90/yr (15% off)
        currencyCode: "USD",
        interval: BillingInterval.Annual,
      }],
    },
    "Pro Plan": {
      lineItems: [{
        amount: 29.99,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      }],
    },
    "Pro Plan Yearly": {
      lineItems: [{
        amount: 305.90, // 29.99 * 12 * 0.85 = ~$305.90/yr (15% off)
        currencyCode: "USD",
        interval: BillingInterval.Annual,
      }],
    },
    "Elite Plan": {
      lineItems: [{
        amount: 49.99,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      }],
    },
    "Elite Plan Yearly": {
      lineItems: [{
        amount: 509.90, // 49.99 * 12 * 0.85 = ~$509.90/yr (15% off)
        currencyCode: "USD",
        interval: BillingInterval.Annual,
      }],
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
