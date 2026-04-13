"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import Button from "./Button";
import OAuthModal from "./OAuthModal";
import ClaudeCodeImportModal from "./ClaudeCodeImportModal";

export default function ClaudeCodeOAuthWrapper({ isOpen, providerInfo, onSuccess, onClose }) {
  const [mode, setMode] = useState<null | "oauth" | "import">(null);

  const handleClose = () => {
    setMode(null);
    onClose();
  };

  const handleBack = () => {
    setMode(null);
  };

  const handleSuccess = () => {
    setMode(null);
    onSuccess?.();
  };

  if (mode === "oauth") {
    return (
      <OAuthModal
        isOpen={isOpen}
        provider="claude"
        providerInfo={providerInfo}
        onSuccess={handleSuccess}
        onClose={handleBack}
      />
    );
  }

  if (mode === "import") {
    return <ClaudeCodeImportModal isOpen={isOpen} onSuccess={handleSuccess} onClose={handleBack} />;
  }

  return (
    <Modal isOpen={isOpen} title="Connect Claude Code" onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          Choose how OmniRoute should connect the <b>Claude Code</b> provider.
        </p>

        <button
          type="button"
          className="text-left rounded-xl border border-primary/20 bg-primary/5 p-4 hover:border-primary/40 transition-colors"
          onClick={() => setMode("import")}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-text-main">Import Claude session</p>
              <p className="mt-1 text-sm text-text-muted">
                Recommended for local/dev setups. Paste <code>~/.claude/.credentials.json</code> or
                import it from the OmniRoute host.
              </p>
            </div>
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              Recommended
            </span>
          </div>
        </button>

        <button
          type="button"
          className="text-left rounded-xl border border-border bg-background p-4 hover:border-primary/30 transition-colors"
          onClick={() => setMode("oauth")}
        >
          <p className="font-semibold text-text-main">OAuth login</p>
          <p className="mt-1 text-sm text-text-muted">
            Use the standard OmniRoute Claude OAuth flow via <code>claude.ai/oauth/authorize</code>.
          </p>
        </button>

        <div className="flex gap-2 pt-2">
          <Button variant="ghost" fullWidth onClick={handleClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ClaudeCodeOAuthWrapper.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerInfo: PropTypes.shape({
    name: PropTypes.string,
  }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
