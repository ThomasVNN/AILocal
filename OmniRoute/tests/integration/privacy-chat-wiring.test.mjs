import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readProjectFile(relPath) {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

test("chat route parses request body once and forwards the parsed body into handleChat", () => {
  const source = readProjectFile("src/app/api/v1/chat/completions/route.ts");

  assert.match(source, /body\s*=\s*await request\.json\(\)/);
  assert.match(source, /return await handleChat\(request,\s*null,\s*body\)/);
  assert.doesNotMatch(source, /request\.clone\(\)/);
});

test("chat handler imports privacy runtime and restore helper", () => {
  const source = readProjectFile("src/sse/handlers/chat.ts");

  assert.match(source, /sanitizePrivacyPayload/);
  assert.match(source, /restorePrivacyJsonResponse/);
});
