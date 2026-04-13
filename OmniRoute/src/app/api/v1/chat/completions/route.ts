import { CORS_ORIGIN, CORS_HEADERS } from "@/shared/utils/cors";
import { handleChat } from "@/sse/handlers/chat";
import { initTranslators } from "@omniroute/open-sse/translator/index.ts";
import { createInjectionGuard } from "@/middleware/promptInjectionGuard";

let initPromise = null;

// Singleton injection guard instance
const injectionGuard = createInjectionGuard();

/**
 * Initialize translators once (Promise-based singleton — no race condition)
 */
function ensureInitialized() {
  if (!initPromise) {
    initPromise = Promise.resolve(initTranslators()).then(() => {
      console.log("[SSE] Translators initialized");
    });
  }
  return initPromise;
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": CORS_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function POST(request) {
  await ensureInitialized();

  let body;
  try {
    body = await request.json();
    const { blocked, result } = injectionGuard(body);
    if (blocked) {
      return new Response(
        JSON.stringify({
          error: {
            message: "Request blocked: potential prompt injection detected",
            type: "injection_detected",
            code: "SECURITY_001",
            detections: result.detections.length,
          },
        }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return new Response(
        JSON.stringify({
          error: {
            message: "Invalid JSON body",
            type: "invalid_request_error",
            code: "INVALID_JSON",
          },
        }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    console.error("[SECURITY] Prompt injection guard failed:", error);
    return new Response(
      JSON.stringify({
        error: {
          message: "Security validation temporarily unavailable",
          type: "security_guard_unavailable",
          code: "SECURITY_002",
        },
      }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  return await handleChat(request, null, body);
}
