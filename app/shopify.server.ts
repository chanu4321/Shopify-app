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
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "https://shopify-app-ten-pi.vercel.app",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  EnableGraphiQL: true,
  distribution: AppDistribution.AppStore,
  unstable_newEmbeddedAuthStrategy: true,
  unstable_enableWebhooks: true,
  isCustomStoreApp: false,
});

export const shopify_api = shopifyApi({
  apiKey:          process.env.SHOPIFY_API_KEY!,
  apiSecretKey:    process.env.SHOPIFY_API_SECRET!,
  scopes:          process.env.SHOPIFY_SCOPES!.split(","),
  hostName:        process.env.HOST_NAME!.replace(/^https?:\/\//, ""),
  apiVersion:      ApiVersion.January25,
  isCustomStoreApp: false,
  isEmbeddedApp:   true
});
export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

