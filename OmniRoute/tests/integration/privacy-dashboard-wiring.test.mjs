import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readProjectFile(relPath) {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

test("privacy dashboard page is wired into the dashboard route", () => {
  const source = readProjectFile("src/app/(dashboard)/dashboard/privacy-filter/page.tsx");

  assert.match(source, /PrivacyFilterPageClient/);
  assert.match(source, /return <PrivacyFilterPageClient \/>/);
});

test("privacy dashboard is visible in sidebar and uses fallback labels", () => {
  const constantsSource = readProjectFile("src/shared/constants/sidebarVisibility.ts");
  const sidebarSource = readProjectFile("src/shared/components/Sidebar.tsx");
  const appearanceSource = readProjectFile(
    "src/app/(dashboard)/dashboard/settings/components/AppearanceTab.tsx"
  );

  assert.match(constantsSource, /"privacy-filter"/);
  assert.match(constantsSource, /\/dashboard\/privacy-filter/);
  assert.match(constantsSource, /labelFallback:\s*"Privacy Filter"/);
  assert.match(
    sidebarSource,
    /getSidebarLabel\(item\.i18nKey,\s*item\.labelFallback \|\| item\.i18nKey\)/
  );
  assert.match(
    appearanceSource,
    /getSidebarLabel\(item\.i18nKey,\s*item\.labelFallback \|\| item\.i18nKey\)/
  );
});
