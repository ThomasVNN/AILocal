"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import Button from "./Button";

/**
 * ChatGPT Web2API Auth Modal
 * Accepts either the full browser Cookie header string or the /api/auth/session JSON payload.
 */
export default function ChatgptWeb2ApiAuthModal({ isOpen, onSuccess, onClose }) {
  const [sessionInput, setSessionInput] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);

  const parseInput = (value) => {
    const trimmed = value.trim();
    if (!trimmed) return { type: null };

    if (trimmed.startsWith("[")) {
      try {
        const cookies = JSON.parse(trimmed);
        return { type: "cookie-json", cookies };
      } catch (err) {
        return {
          type: "cookie-json",
          error: "Invalid cookie JSON — expected an array like [{name, value}, ...]",
        };
      }
    }

    if (trimmed.startsWith("{")) {
      try {
        const payload = JSON.parse(trimmed);
        return { type: "payload", payload };
      } catch (err) {
        return {
          type: "payload",
          error: "Invalid JSON — paste the full session JSON from /api/auth/session",
        };
      }
    }

    return { type: "cookie", cookieString: trimmed };
  };

  const parsedInput = parseInput(sessionInput);
  const parsedCookieNames = (() => {
    if (parsedInput.type === "cookie") {
      return Array.from(
        new Set(
          parsedInput.cookieString
            .replace(/^cookie\s*:\s*/i, "")
            .split(";")
            .map((part) => part.trim())
            .map((part) => part.split("=")[0]?.trim())
            .filter(Boolean)
        )
      );
    }

    if (parsedInput.type === "cookie-json" && Array.isArray(parsedInput.cookies)) {
      return Array.from(
        new Set(
          parsedInput.cookies
            .map((entry) => (entry && typeof entry === "object" ? entry.name : null))
            .filter((name) => typeof name === "string" && name.trim().length > 0)
            .map((name) => name.trim())
        )
      );
    }

    return [];
  })();

  const sessionToken =
    parsedInput.type === "payload"
      ? parsedInput.payload?.sessionToken ||
        parsedInput.payload?.session_token ||
        parsedInput.payload?.sessionTokenValue
      : null;

  const handleImportToken = async () => {
    if (!sessionInput.trim()) {
      setError("Please paste your Cookie header or session JSON");
      return;
    }

    if (
      (parsedInput.type === "payload" || parsedInput.type === "cookie-json") &&
      parsedInput.error
    ) {
      setError(parsedInput.error);
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const body =
        parsedInput.type === "payload"
          ? { sessionPayload: parsedInput.payload }
          : {
              cookieString:
                parsedInput.type === "cookie-json" ? sessionInput.trim() : parsedInput.cookieString,
            };

      const res = await fetch("/api/oauth/chatgpt-web2api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect ChatGPT Web Session" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex gap-2 text-sm text-amber-800 dark:text-amber-200">
            <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">
              warning
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-semibold">Browser Session Import</p>
              <p>
                Paste the <b>entire Cookie header</b>, <b>JSON cookie export</b>, or the{" "}
                <b>/api/auth/session JSON</b> from chatgpt.com. This connects your current browser
                session and is not an official OAuth flow.
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
              <p className="font-semibold">How to copy the Cookie header:</p>
              <ol className="list-decimal pl-4 mt-1 space-y-1">
                <li>
                  Log in to{" "}
                  <a
                    href="https://chatgpt.com"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    chatgpt.com
                  </a>
                </li>
                <li>
                  Open DevTools (F12) → <b>Network</b> tab
                </li>
                <li>
                  Reload the page and click any request to <code>chatgpt.com</code>
                </li>
                <li>
                  Go to <b>Request Headers</b> → find <b>Cookie</b> → copy the entire value
                </li>
                <li>
                  Paste the full value below (long string of <code>name=value</code> pairs)
                </li>
              </ol>
              <p className="mt-1 text-xs opacity-75">
                Tip: if you copied <code>Cookie:</code>, this form will normalize that prefix.
              </p>
              <p className="mt-1 text-xs opacity-75">
                Cookie export JSON format is also supported, for example{" "}
                <code>[{'{ "name": "...", "value": "..." }'}]</code>.
              </p>
              <p className="mt-2 text-xs opacity-75">
                Alternative: open the request to <code>/api/auth/session</code>, copy the JSON
                response, and paste it below.
              </p>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Session JSON or Cookie Header <span className="text-red-500">*</span>
          </label>
          <textarea
            value={sessionInput}
            onChange={(e) => setSessionInput(e.target.value)}
            placeholder='{"accessToken":"...","sessionToken":"...","user":{...}} or __Secure-next-auth.session-token=...; oai-did=... or [{"name":"__Secure-next-auth.session-token","value":"..."}]'
            rows={5}
            className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
          />
          {parsedCookieNames.length > 0 && (
            <p className="mt-1 text-xs text-text-muted">
              Detected {parsedCookieNames.length} cookies:{" "}
              {parsedCookieNames.slice(0, 6).join(", ")}
              {parsedCookieNames.length > 6 ? ", ..." : ""}
            </p>
          )}
          {(parsedInput.type === "cookie" || parsedInput.type === "cookie-json") &&
            sessionInput &&
            !/__Secure-next-auth\.session-token/.test(sessionInput) && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                <code>__Secure-next-auth.session-token</code> not detected. Make sure you copied the
                full Cookie header from Network tab, or paste the /api/auth/session JSON instead.
              </p>
            )}
          {parsedInput.type === "payload" && parsedInput.error && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{parsedInput.error}</p>
          )}
          {parsedInput.type === "cookie-json" && parsedInput.error && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{parsedInput.error}</p>
          )}
          {parsedInput.type === "payload" && !sessionToken && !parsedInput.error && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Session JSON missing <code>sessionToken</code>. Paste the full /api/auth/session
              response to enable refresh.
            </p>
          )}
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleImportToken}
            fullWidth
            disabled={importing || !sessionInput.trim()}
          >
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

ChatgptWeb2ApiAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
