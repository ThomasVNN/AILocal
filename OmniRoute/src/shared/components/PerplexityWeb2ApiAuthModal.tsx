"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import Button from "./Button";

/**
 * Perplexity Web2API Auth Modal
 * Prompts user to paste the full browser Cookie header string from DevTools.
 * This is required to bypass Cloudflare bot protection — just the session token is not enough.
 */
export default function PerplexityWeb2ApiAuthModal({ isOpen, onSuccess, onClose }) {
  const [cookieString, setCookieString] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);

  const parsedCookieNames = Array.from(
    new Set(
      cookieString
        .replace(/^cookie\s*:\s*/i, "")
        .split(";")
        .map((part) => part.trim())
        .map((part) => part.split("=")[0]?.trim())
        .filter(Boolean)
    )
  );

  const handleImportToken = async () => {
    if (!cookieString.trim()) {
      setError("Please paste your full browser Cookie string");
      return;
    }

    if (!cookieString.includes("=")) {
      setError(
        "Invalid format — paste the full Cookie header value (it should contain multiple name=value pairs)"
      );
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/perplexity-web2api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookieString }),
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
    <Modal isOpen={isOpen} title="Connect Perplexity Web Session" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex gap-2 text-sm text-amber-800 dark:text-amber-200">
            <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">
              warning
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-semibold">Browser Session Import</p>
              <p>
                Perplexity uses Cloudflare protection. You must copy the <b>entire Cookie header</b>
                , not just the session token. This connects your current web session and is not an
                official OAuth flow. Include Cloudflare cookies like <code>cf_clearance</code>.
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
              <p className="font-semibold">How to copy the full Cookie header:</p>
              <ol className="list-decimal pl-4 mt-1 space-y-1">
                <li>
                  Log in to{" "}
                  <a
                    href="https://perplexity.ai"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    perplexity.ai
                  </a>
                </li>
                <li>
                  Open DevTools (F12) → <b>Network</b> tab
                </li>
                <li>
                  Reload the page and click any request to <code>www.perplexity.ai</code>
                </li>
                <li>
                  Go to <b>Request Headers</b> → find <b>Cookie</b> → copy the entire value
                </li>
                <li>
                  Paste the full value below (it will be a long string of <code>name=value</code>{" "}
                  pairs)
                </li>
              </ol>
              <p className="mt-1 text-xs opacity-75">
                Tip: paste the Cookie value only. If you copied the whole header line, the form will
                normalize the leading <code>Cookie:</code> prefix automatically.
              </p>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Full Cookie Header Value <span className="text-red-500">*</span>
          </label>
          <textarea
            value={cookieString}
            onChange={(e) => setCookieString(e.target.value)}
            placeholder="__cf_bm=...; cf_clearance=...; __Secure-next-auth.session-token=...; pplx.session-id=...; ..."
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
          {cookieString && !cookieString.includes("cf_clearance") && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              <code>cf_clearance</code> cookie not detected — requests may still be blocked by
              Cloudflare. Make sure you copied the full Cookie header from the Network tab.
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
            disabled={importing || !cookieString.trim()}
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

PerplexityWeb2ApiAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
