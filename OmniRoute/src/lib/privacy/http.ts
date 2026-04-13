import { restorePrivacyPayload } from "./runtime";

export function resolvePrivacySourceApp(
  request: Request,
  apiKeyInfo?: { name?: string | null } | null
) {
  const explicit =
    request.headers.get("x-omniroute-source-app") || request.headers.get("x-source-app");
  if (explicit) {
    return explicit;
  }

  const apiKeyName = (apiKeyInfo?.name || "").toLowerCase();
  if (apiKeyName.includes("openwebui")) {
    return "openwebui";
  }
  if (apiKeyName.includes("openclaw")) {
    return "openclaw-gw";
  }

  const userAgent = (request.headers.get("user-agent") || "").toLowerCase();
  if (userAgent.includes("openwebui")) {
    return "openwebui";
  }
  if (userAgent.includes("openclaw")) {
    return "openclaw-gw";
  }

  return "direct-api";
}

export async function restorePrivacyJsonResponse(
  response: Response,
  input: {
    requestId: string;
    restoreSessionId: string | null;
    sourceApp: string;
    endpointType: string;
  }
) {
  if (!response.ok || !input.restoreSessionId) {
    return response;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return response;
  }

  const payloadText = await response.text();
  let parsedPayload: Record<string, unknown>;
  try {
    parsedPayload = JSON.parse(payloadText) as Record<string, unknown>;
  } catch {
    return new Response(payloadText, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const restored = await restorePrivacyPayload({
    requestId: input.requestId,
    restoreSessionId: input.restoreSessionId,
    sourceApp: input.sourceApp,
    endpointType: input.endpointType,
    stream: false,
    payload: parsedPayload,
  });

  const headers = new Headers(response.headers);
  headers.set(
    "x-omniroute-privacy-restored",
    restored.restoreSummary.restoredCount > 0 ? "1" : "0"
  );

  return new Response(JSON.stringify(restored.restoredPayload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
