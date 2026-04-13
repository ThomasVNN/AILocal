"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import Button from "./Button";

export default function ClaudeCodeImportModal({ isOpen, onSuccess, onClose }) {
  const [credentialsInput, setCredentialsInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importingLocal, setImportingLocal] = useState(false);

  const handleImport = async (body: Record<string, unknown>, mode: "local" | "manual") => {
    if (mode === "manual" && !credentialsInput.trim()) {
      setError("Paste the full ~/.claude/.credentials.json content or a raw access token.");
      return;
    }

    if (mode === "local") {
      setImportingLocal(true);
    } else {
      setImporting(true);
    }
    setError(null);
    setWarning(null);

    try {
      const response = await fetch("/api/oauth/claude/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Import failed");
      }

      if (data.warning) {
        setWarning(data.warning);
      }

      onSuccess?.();
      onClose();
    } catch (importError: any) {
      setError(importError?.message || "Import failed");
    } finally {
      setImporting(false);
      setImportingLocal(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Import Claude Code Session" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex gap-2 text-sm text-amber-800 dark:text-amber-200">
            <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">
              warning
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-semibold">Import Claude Code credentials into OmniRoute</p>
              <p>
                This keeps Claude under the <b>existing OmniRoute Claude provider</b>. Preferred
                input is the full <code>~/.claude/.credentials.json</code> content from Claude Code.
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
              <p className="font-semibold">Recommended flow</p>
              <ol className="list-decimal pl-4 mt-1 space-y-1">
                <li>Open Claude Code on the machine where you already logged in.</li>
                <li>
                  Copy the content of <code>~/.claude/.credentials.json</code>.
                </li>
                <li>Paste it below and import.</li>
              </ol>
              <p className="mt-1 text-xs opacity-75">
                If OmniRoute runs in Docker, the local-file import button only works when
                <code> ~/.claude </code>
                is mounted into the container.
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            fullWidth
            loading={importingLocal}
            disabled={importing}
            onClick={() => handleImport({ source: "local_file" }, "local")}
          >
            Import Local File
          </Button>
          <Button
            variant="ghost"
            fullWidth
            onClick={onClose}
            disabled={importing || importingLocal}
          >
            Back
          </Button>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Credentials JSON or Access Token <span className="text-red-500">*</span>
          </label>
          <textarea
            value={credentialsInput}
            onChange={(event) => setCredentialsInput(event.target.value)}
            placeholder={
              '{"claudeAiOauth":{"accessToken":"...","refreshToken":"...","expiresAt":1776000000000}}'
            }
            rows={7}
            className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
          />
          <p className="mt-1 text-xs text-text-muted">
            Also accepts a raw access token string if you do not have the full JSON.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {warning && (
          <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
            <p className="text-sm text-amber-700 dark:text-amber-300">{warning}</p>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            onClick={() => handleImport({ credentialsInput }, "manual")}
            fullWidth
            loading={importing}
            disabled={importingLocal || !credentialsInput.trim()}
          >
            Import Credentials
          </Button>
          <Button
            onClick={onClose}
            variant="ghost"
            fullWidth
            disabled={importing || importingLocal}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ClaudeCodeImportModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
