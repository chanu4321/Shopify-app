import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { adminClientFactory } from "node_modules/@shopify/shopify-app-remix/dist/ts/server/clients";
import { shopifyApi } from "@shopify/shopify-api";
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "https://shopify-app-ten-pi.vercel.app",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  unstable_newEmbeddedAuthStrategy: true,
  unstable_enableWebhooks: true,
  isCustomStoreApp: false,
  isEmbeddedApp: true
});

export const shopify_api = shopifyApi({
  apiKey:          process.env.SHOPIFY_API_KEY!,
  apiSecretKey:    process.env.SHOPIFY_API_SECRET!,
  scopes:          process.env.SCOPES?.split(","),
  hostName:        process.env.SHOPIFY_APP_URL!.replace(/^https?:\/\//, ""),
  apiVersion:      ApiVersion.April25,
  isCustomStoreApp: false,
  isEmbeddedApp:   true,
  sessionStorage: new PrismaSessionStorage(prisma)
});
export default shopify;
export const apiVersion = ApiVersion.April25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;