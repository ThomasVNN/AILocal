"use client";

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import Button from "./Button";

function parseDetectedHeaderNames(rawValue: string) {
  const lines = rawValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const names = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inline = /^(:?[A-Za-z0-9][A-Za-z0-9_.-]*)\s*:\s*(.+)$/.exec(line);
    if (inline?.[1]) {
      names.add(inline[1].toLowerCase());
      continue;
    }
    const tabular = /^(:?[A-Za-z0-9][A-Za-z0-9_.-]*)\s+(.+)$/.exec(line);
    if (tabular?.[1]) {
      names.add(tabular[1].toLowerCase());
      continue;
    }
    const curlHeader = /(?:-H|--header)\s+\$?(?:"([^":]+):[\s\S]*"|'([^':]+):[\s\S]*')/.exec(line);
    if (curlHeader?.[1] || curlHeader?.[2]) {
      names.add(String(curlHeader[1] || curlHeader[2]).toLowerCase());
      continue;
    }
    if (/(?:-b|--cookie)\s+\$?(?:"[^"]+"|'[^']+')/.test(line)) {
      names.add("cookie");
      continue;
    }
    if (/^:?[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(line)) {
      names.add(line.toLowerCase());
    }
  }

  return Array.from(names);
}

/**
 * Gemini Web2API Auth Modal
 * Accepts raw Gemini browser request headers copied from DevTools, cookie exports, or cURL captures.
 */
export default function GeminiWeb2ApiAuthModal({ isOpen, onSuccess, onClose }) {
  const [sessionInput, setSessionInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const detectedHeaderNames = useMemo(() => parseDetectedHeaderNames(sessionInput), [sessionInput]);
  const hasApiKey = /AIza[0-9A-Za-z_-]{8,}/.test(sessionInput);
  const hasAuthorizationHeader =
    detectedHeaderNames.includes("authorization") ||
    /authorization/i.test(sessionInput) ||
    /^bearer\s+\S+/im.test(sessionInput) ||
    /^sapisid(?:1p|3p)?hash\s+\S+/im.test(sessionInput);
  const hasCookieHeader =
    detectedHeaderNames.includes("cookie") ||
    /(?:^|\s)(?:-b|--cookie)\b/m.test(sessionInput) ||
    /\b(?:SAPISID|APISID|__Secure-1PAPISID|__Secure-3PAPISID)=/i.test(sessionInput);

  const handleImport = async () => {
    if (!sessionInput.trim()) {
      setError("Please paste Gemini browser request headers, cookie export, or Copy as cURL");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/gemini-web2api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionInput }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect Gemini Web Session" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex gap-2 text-sm text-amber-800 dark:text-amber-200">
            <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">
              warning
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-semibold">Unofficial Web2API import</p>
              <p>
                Paste full request headers, cookie exports, or <b>Copy as cURL</b> from{" "}
                <b>gemini.google.com</b>. This flow only accepts browser-derived web sessions.
                Official Gemini API keys belong under the <b>Gemini (Google AI Studio)</b> provider.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex gap-2 text-sm text-blue-800 dark:text-blue-200">
            <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 flex-shrink-0">
              info
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-semibold">How to capture headers:</p>
              <ol className="list-decimal pl-4 mt-1 space-y-1">
                <li>
                  Open{" "}
                  <a
                    href="https://gemini.google.com"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    gemini.google.com
                  </a>
                </li>
                <li>
                  Easiest: DevTools → Network → Gemini request → <b>Copy as cURL (bash)</b>, then
                  paste it here
                </li>
                <li>
                  Supported today: raw browser header lists, cookie exports, or <b>Copy as cURL</b>{" "}
                  captures that include cookie/auth headers
                </li>
                <li>
                  If you use web-session import, include the full request so OmniRoute can extract{" "}
                  <code>cookie</code>, <code>origin</code>, and related browser headers
                </li>
              </ol>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Gemini Web Session Input <span className="text-red-500">*</span>
          </label>
          <textarea
            value={sessionInput}
            onChange={(e) => setSessionInput(e.target.value)}
            placeholder={
              "curl 'https://gemini.google.com/...'\n  -H 'cookie: SAPISID=...'\n  -H 'origin: https://gemini.google.com'"
            }
            rows={6}
            className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
          />
          {detectedHeaderNames.length > 0 && (
            <p className="mt-1 text-xs text-text-muted">
              Detected headers: {detectedHeaderNames.slice(0, 8).join(", ")}
              {detectedHeaderNames.length > 8 ? ", ..." : ""}
            </p>
          )}
          {hasApiKey && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Detected a Gemini API key. Web2API no longer accepts API keys here; add it under the{" "}
              <code>gemini</code> provider instead.
            </p>
          )}
          {!hasApiKey &&
            !hasAuthorizationHeader &&
            !hasCookieHeader &&
            sessionInput.trim().length > 0 && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Could not detect <code>Authorization</code> or <code>Cookie</code>. Paste a{" "}
                <b>Copy as cURL</b> capture or a request header/cookie export from{" "}
                <code>gemini.google.com</code>.
              </p>
            )}
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button onClick={handleImport} fullWidth disabled={importing || !sessionInput.trim()}>
            {importing ? "Connecting..." : "Connect Session"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

GeminiWeb2ApiAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
