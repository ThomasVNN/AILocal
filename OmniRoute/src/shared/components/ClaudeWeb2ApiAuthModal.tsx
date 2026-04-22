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
  for (const line of lines) {
    const inline = /^(:?[A-Za-z0-9][A-Za-z0-9_.-]*)\s*:\s*(.+)$/.exec(line);
    if (inline?.[1]) {
      names.add(inline[1].replace(/^:/, "").toLowerCase());
      continue;
    }
    const curlHeader = /(?:-H|--header)\s+\$?(?:"([^":]+):[\s\S]*"|'([^':]+):[\s\S]*')/.exec(line);
    if (curlHeader?.[1] || curlHeader?.[2]) {
      names.add(String(curlHeader[1] || curlHeader[2]).toLowerCase());
      continue;
    }
    if (/(?:-b|--cookie)\s+\$?(?:"[^"]+"|'[^']+')/.test(line)) {
      names.add("cookie");
    }
  }

  return Array.from(names);
}

export default function ClaudeWeb2ApiAuthModal({ isOpen, onSuccess, onClose }) {
  const [sessionInput, setSessionInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const detectedHeaderNames = useMemo(() => parseDetectedHeaderNames(sessionInput), [sessionInput]);
  const hasCookieHeader =
    detectedHeaderNames.includes("cookie") ||
    /(?:^|\s)(?:-b|--cookie)\b/m.test(sessionInput) ||
    /\bsessionKey=/i.test(sessionInput);
  const hasOrganization =
    /\blastActiveOrg=[0-9a-f-]{36}/i.test(sessionInput) ||
    /\/organizations\/[0-9a-f-]{36}/i.test(sessionInput) ||
    /^x-organization-uuid\s*:/im.test(sessionInput);

  const handleImport = async () => {
    if (!sessionInput.trim()) {
      setError("Please paste a Claude request capture, Copy as cURL, or Cookie header");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/claudew2a/import", {
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
    <Modal isOpen={isOpen} title="Connect Claude Web Session" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex gap-2 text-sm text-amber-800 dark:text-amber-200">
            <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">
              warning
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-semibold">Unofficial Web2API import</p>
              <p>
                Paste a full <b>claude.ai</b> request capture or <b>Copy as cURL</b> from the
                browser/Electron Network tab. OmniRoute stores the browser session cookie as a
                provider credential; do not paste shared or third-party sessions.
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
              <p className="font-semibold">What to paste:</p>
              <ol className="list-decimal pl-4 mt-1 space-y-1">
                <li>
                  Open{" "}
                  <a
                    href="https://claude.ai"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    claude.ai
                  </a>{" "}
                  while signed in
                </li>
                <li>
                  Network tab, select a request to <code>claude.ai</code>, preferably{" "}
                  <code>/completion</code> or an organization endpoint
                </li>
                <li>
                  Paste the request headers or <b>Copy as cURL</b>; include <code>Cookie</code> and
                  an organization hint such as <code>lastActiveOrg</code>
                </li>
              </ol>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Claude Web Session Input <span className="text-red-500">*</span>
          </label>
          <textarea
            value={sessionInput}
            onChange={(event) => setSessionInput(event.target.value)}
            placeholder={
              "curl 'https://claude.ai/api/organizations/.../completion'\n  -H 'cookie: sessionKey=...; lastActiveOrg=...; cf_clearance=...'\n  -H 'anthropic-device-id: ...'"
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
          {!hasCookieHeader && sessionInput.trim().length > 0 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Could not detect <code>Cookie</code> or <code>sessionKey</code>. Paste a full request
              capture from <code>claude.ai</code>.
            </p>
          )}
          {hasCookieHeader && !hasOrganization && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Cookie detected, but no organization UUID was found. Include{" "}
              <code>lastActiveOrg</code> or a URL containing{" "}
              <code>/organizations/&lt;uuid&gt;</code>.
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

ClaudeWeb2ApiAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
