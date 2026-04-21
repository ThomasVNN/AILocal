import type {
  PrivacyControlPlanePatch,
  PrivacyControlPlaneWorkspace,
  PrivacyTestInput,
  PrivacyTestResult,
} from "@/lib/privacy/controlPlaneTypes";
import type { PrivacyBundleRecord } from "@/lib/privacy/types";

interface PrivacyBundleActionResponse {
  activeBundle?: PrivacyBundleRecord;
  workspace?: PrivacyControlPlaneWorkspace;
}

function formatApiError(error: unknown) {
  if (!error) return "Request failed";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Request failed";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(formatApiError(json?.error));
  }
  return json as T;
}

export async function getPrivacyControlPlaneWorkspace() {
  const response = await fetch("/api/privacy/control-plane");
  return readJson<PrivacyControlPlaneWorkspace>(response);
}

export async function patchPrivacyControlPlaneWorkspace(patch: PrivacyControlPlanePatch) {
  const response = await fetch("/api/privacy/control-plane", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return readJson<PrivacyControlPlaneWorkspace>(response);
}

export async function runPrivacyFilterTest(input: PrivacyTestInput) {
  const response = await fetch("/api/privacy/control-plane/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await readJson<{ result: PrivacyTestResult }>(response);
  return json.result;
}

export async function publishPrivacyBundle(notes: string) {
  const response = await fetch("/api/privacy/control-plane/bundles/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  return readJson<PrivacyBundleActionResponse>(response);
}

export async function rollbackPrivacyBundle(version: string) {
  const response = await fetch("/api/privacy/control-plane/bundles/rollback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
  });
  return readJson<PrivacyBundleActionResponse>(response);
}

export const privacyFilterService = {
  getPrivacyControlPlaneWorkspace,
  patchPrivacyControlPlaneWorkspace,
  runPrivacyFilterTest,
  publishPrivacyBundle,
  rollbackPrivacyBundle,
};
