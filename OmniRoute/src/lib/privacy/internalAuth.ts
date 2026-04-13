import { timingSafeEqual } from "crypto";

export async function verifyInternalPrivacyRequest(request: Request) {
  const expected = process.env.PRIVACY_FILTER_INTERNAL_TOKEN;
  if (!expected) {
    return null;
  }

  const provided = request.headers.get("x-omniroute-internal-token") || "";
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return "Internal privacy token required";
  }

  return null;
}
