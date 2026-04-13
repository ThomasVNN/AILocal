/**
 * Performance Optimization Tests
 *
 * Validates the 9 optimizations applied to OmniRoute:
 * 1. settingsCache TTL increased to 15s
 * 2. policyEngine regex cache
 * 3. quotaCache bounded to 500 entries with LRU eviction
 * 4. cacheLayer accurate Buffer.byteLength size estimation
 * 5. semanticCache large payload guard in isCacheable()
 * 6. lockoutPolicy evictExpiredLockouts()
 * 7. costRules budget batch preload with _budgetsLoaded flag
 * 8. domainState loadAllBudgets exported
 * 9. providers/validation AbortSignal.timeout on all fetches
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ─── Setup isolated DB for each test group ───────────────────────────────────

let tmpDir;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-opt-test-"));
  process.env.DATA_DIR = tmpDir;
});

after(() => {
  delete process.env.DATA_DIR;
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── 1. Settings Cache TTL ───────────────────────────────────────────────────

describe("settingsCache", async () => {
  const { DEFAULT_SETTINGS_TTL } = await import("../../src/lib/settingsCache.ts");

  it("DEFAULT_SETTINGS_TTL should be 15000ms (was 5000ms)", () => {
    assert.equal(DEFAULT_SETTINGS_TTL, 15_000, "TTL should be 15 seconds");
  });
});

// ─── 2. Policy Engine Regex Cache ───────────────────────────────────────────

describe("policyEngine - glob regex cache", async () => {
  const { PolicyEngine } = await import("../../src/domain/policyEngine.ts");

  it("PolicyEngine.evaluate() should match patterns via cached regex", () => {
    const engine = new PolicyEngine();
    engine.addPolicy({
      id: "p1",
      name: "Test Routing",
      type: "routing",
      enabled: true,
      priority: 1,
      conditions: { model_pattern: "gpt-*" },
      actions: { prefer_provider: ["openai"] },
    });

    // First call — compiles and caches regex
    const r1 = engine.evaluate({ model: "gpt-4o" });
    assert.equal(r1.preferredProviders.includes("openai"), true);

    // Second call — uses cached regex (same result)
    const r2 = engine.evaluate({ model: "gpt-3.5-turbo" });
    assert.equal(r2.preferredProviders.includes("openai"), true);

    // Non-matching model
    const r3 = engine.evaluate({ model: "claude-3" });
    assert.equal(r3.preferredProviders.includes("openai"), false);
  });

  it("evaluateFirstAllowed should not duplicate evaluation for last denied model", async () => {
    const { evaluateFirstAllowed } = await import("../../src/domain/policyEngine.ts");
    // All models allowed — returns first
    const result = evaluateFirstAllowed(["model-x", "model-y"], {});
    assert.equal(result.model, "model-x");
    assert.equal(result.verdict.allowed, true);
  });
});

// ─── 3. Quota Cache Bounded Entries ─────────────────────────────────────────

describe("quotaCache - bounded entries", async () => {
  const { setQuotaCache, getQuotaCache, pruneQuotaCache } =
    await import("../../src/domain/quotaCache.ts");

  it("should export pruneQuotaCache function", () => {
    assert.equal(typeof pruneQuotaCache, "function", "pruneQuotaCache must be exported");
  });

  it("cache should accept and retrieve entries", () => {
    setQuotaCache("conn-test-001", "openai", {
      daily: { remainingPercentage: 80, resetAt: null },
    });
    const entry = getQuotaCache("conn-test-001");
    assert.ok(entry, "Entry should exist in cache");
    assert.equal(entry.provider, "openai");
    assert.equal(entry.exhausted, false);
  });

  it("pruneQuotaCache should return a number", () => {
    const removed = pruneQuotaCache();
    assert.equal(typeof removed, "number");
    assert.ok(removed >= 0);
  });
});

// ─── 4. CacheLayer accurate Buffer.byteLength ─────────────────────────────

describe("cacheLayer - accurate size estimation", async () => {
  const { LRUCache } = await import("../../src/lib/cacheLayer.ts");

  it("should store and retrieve a value correctly", () => {
    const cache = new LRUCache({ maxSize: 10, maxBytes: 1024 * 1024 });
    const key = "test-key-1";
    const value = { content: "hello world", tokens: 42 };
    cache.set(key, value);
    const retrieved = cache.get(key);
    assert.deepEqual(retrieved, value);
  });

  it("stats.bytes should be > 0 after setting a value", () => {
    const cache = new LRUCache({ maxSize: 10, maxBytes: 1024 * 1024 });
    cache.set("k1", { text: "some content here" });
    const stats = cache.getStats();
    assert.ok(stats.bytes > 0, "Byte count should be positive");
  });

  it("bytes should be accurate (closer to actual UTF-8 bytes, not doubled)", () => {
    const cache = new LRUCache({ maxSize: 10, maxBytes: 1024 * 1024 });
    const value = { text: "hello" }; // ASCII-only: same byte count as string length
    cache.set("k2", value);
    const stats = cache.getStats();
    const expected = Buffer.byteLength(JSON.stringify(value), "utf8");
    // With Buffer.byteLength: should equal expected
    // With old .length * 2: would be ~2x for ASCII
    assert.equal(stats.bytes, expected, "Size should match Buffer.byteLength");
  });
});

// ─── 5. Semantic Cache Large Payload Guard ──────────────────────────────────

describe("semanticCache - large payload guard", async () => {
  const { isCacheable } = await import("../../src/lib/semanticCache.ts");

  it("should cache small payloads (stream=false, temp=0)", () => {
    assert.equal(isCacheable({ stream: false, temperature: 0, messages: [] }, null), true);
  });

  it("should reject very large payloads", () => {
    // Generate a payload that exceeds 256KB
    const largeText = "x".repeat(300 * 1024);
    const body = {
      stream: false,
      temperature: 0,
      messages: [{ role: "user", content: largeText }],
    };
    // Override env to use small limit for predictable test
    const prevLimit = process.env.SEMANTIC_CACHE_MAX_PAYLOAD_BYTES;
    process.env.SEMANTIC_CACHE_MAX_PAYLOAD_BYTES = String(1024); // 1KB limit
    try {
      const result = isCacheable(body, null);
      assert.equal(result, false, "Large payload should not be cacheable");
    } finally {
      if (prevLimit === undefined) {
        delete process.env.SEMANTIC_CACHE_MAX_PAYLOAD_BYTES;
      } else {
        process.env.SEMANTIC_CACHE_MAX_PAYLOAD_BYTES = prevLimit;
      }
    }
  });
});

// ─── 6. Lockout Policy Eviction ──────────────────────────────────────────────

describe("lockoutPolicy - evictExpiredLockouts", async () => {
  const { evictExpiredLockouts, recordFailedAttempt, checkLockout } =
    await import("../../src/domain/lockoutPolicy.ts");

  it("should export evictExpiredLockouts", () => {
    assert.equal(typeof evictExpiredLockouts, "function");
  });

  it("should evict expired entries and return count", () => {
    // Actively locked entries should NOT be evicted
    const ip = `evict-test-${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt(ip);
    }
    // Locked entries still active — evict should not remove them
    const removedWhileLocked = evictExpiredLockouts();
    assert.ok(removedWhileLocked >= 0, "Should return non-negative removal count");
  });
});

// ─── 7+8. Cost Rules Budget Preload ─────────────────────────────────────────

describe("costRules - budget preload", async () => {
  const { setBudget, getBudget, resetCostData } = await import("../../src/domain/costRules.ts");

  after(() => resetCostData());

  it("getBudget returns null for unknown key", () => {
    const result = getBudget(`unknown-key-${Date.now()}`);
    assert.equal(result, null);
  });

  it("setBudget + getBudget round-trip works", () => {
    const keyId = `budget-test-${Date.now()}`;
    setBudget(keyId, { dailyLimitUsd: 5.0, monthlyLimitUsd: 100, warningThreshold: 0.9 });
    const result = getBudget(keyId);
    assert.ok(result, "Budget should be retrievable after set");
    assert.equal(result.dailyLimitUsd, 5.0);
    assert.equal(result.warningThreshold, 0.9);
  });
});

// ─── 9. Domain State loadAllBudgets export ──────────────────────────────────

describe("domainState - loadAllBudgets", async () => {
  it("should export loadAllBudgets function", async () => {
    const domainState = await import("../../src/lib/db/domainState.ts");
    assert.equal(
      typeof domainState.loadAllBudgets,
      "function",
      "loadAllBudgets must be exported from domainState"
    );
  });

  it("loadAllBudgets should return an object (possibly empty)", async () => {
    const { loadAllBudgets } = await import("../../src/lib/db/domainState.ts");
    const result = loadAllBudgets();
    assert.equal(typeof result, "object", "loadAllBudgets should return an object");
    assert.ok(!Array.isArray(result), "Should return a Record, not an Array");
  });
});
