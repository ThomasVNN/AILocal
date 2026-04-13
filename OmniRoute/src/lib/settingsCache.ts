/**
 * Settings Cache — FASE-03 Architecture Refactoring
 *
 * In-memory cache for settings to eliminate self-fetch anti-pattern in middleware.
 * The middleware was making HTTP requests to its own /api/settings endpoint,
 * which caused circular dependencies and performance issues.
 *
 * @module settingsCache
 */

import { getSettings } from "@/lib/localDb";

/**
 * Default TTL for cached settings.
 * 15 seconds is a good balance between freshness and DB load on high-traffic deployments.
 * Override via setSettingsCacheTTL() for tests or special environments.
 */
export const DEFAULT_SETTINGS_TTL = 15_000; // 15 seconds

/** @type {{ data: object|null, lastFetch: number, ttl: number }} */
const cache = {
  data: null,
  lastFetch: 0,
  ttl: DEFAULT_SETTINGS_TTL,
};

/**
 * Get settings from cache (or refresh if stale).
 * This replaces the self-fetch pattern in middleware.
 *
 * @returns {Promise<object>} Settings object
 */
export async function getCachedSettings() {
  const now = Date.now();

  if (cache.data && now - cache.lastFetch < cache.ttl) {
    return cache.data;
  }

  try {
    const settings = await getSettings();
    cache.data = settings;
    cache.lastFetch = now;
    return settings;
  } catch (err) {
    // If fetch fails but we have stale data, return it
    if (cache.data) {
      console.error("[SettingsCache] Failed to refresh, using stale data:", err.message);
      return cache.data;
    }
    throw err;
  }
}

/**
 * Invalidate the cache (e.g. after settings update).
 */
export function invalidateSettingsCache() {
  cache.data = null;
  cache.lastFetch = 0;
}

/**
 * Set the cache TTL in milliseconds.
 * @param {number} ms
 */
export function setSettingsCacheTTL(ms) {
  cache.ttl = ms;
}
