import { notFound } from "@tanstack/react-router";
import { resolveFeatureAccess } from "./access";
import type { MonetizationConfig } from "./config";

/**
 * The merch shop is switched off while BallaCity is free (platformFreeMode) or
 * while a superadmin keeps it closed. Closed, /shop answers with the ordinary
 * 404 page (P0-11), like the developer routes in production: no empty,
 * indexable page that redirects in the browser.
 */
export function merchShopOpen(config: MonetizationConfig): boolean {
  return resolveFeatureAccess(config).merchEnabled;
}

/** `beforeLoad` check for /shop. */
export function requireMerchShopOpen(open: boolean): void {
  if (!open) throw notFound();
}
