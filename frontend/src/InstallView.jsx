import React, { useEffect, useRef } from "react";
import {
  Alert,
  Button,
  Spinner,
} from "@patternfly/react-core";

const STATUS_META = {
  not_started: { variant: "info",    label: "Not started" },
  running:     { variant: "warning", label: "Running…"    },
  succeeded:   { variant: "success", label: "Succeeded"   },
  failed:      { variant: "danger",  label: "Failed"      },
};

export default function InstallView({
  exported,
  clusterName,
  status,
  log,
  onInstall,
  installing,
}) {
  const logRef = useRef(null);

  // Auto-scroll log to bottom while running
  useEffect(() => {
    if (status === "running" && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log, status]);

  const canInstall = exported && clusterName && status !== "running" && status !== "succeeded";
  const meta = STATUS_META[status] || STATUS_META.not_started;

  return (
    <div>
      {!exported && (
        <Alert
          variant="info"
          title='Export cluster-vars.yaml first (Review + Export tab), then return here to start the install.'
          style={{ marginBottom: "1rem" }}
          isInline
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
        <div>
          <span style={{ fontWeight: 600, marginRight: "0.5rem" }}>Status:</span>
          <span style={{
            padding: "0.25rem 0.75rem",
            borderRadius: "4px",
            fontSize: "0.875rem",
            fontWeight: 600,
            background: meta.variant === "success" ? "#1e4620"
              : meta.variant === "danger"  ? "#7d1007"
              : meta.variant === "warning" ? "#4d3000"
              : "#004080",
            color: "#fff",
          }}>
            {meta.label}
          </span>
          {status === "running" && <Spinner size="sm" style={{ marginLeft: "0.75rem" }} />}
        </div>

        {clusterName && (
          <span style={{ color: "#6a6e73", fontSize: "0.875rem" }}>
            cluster: <code>{clusterName}</code>
          </span>
        )}
      </div>

      <div style={{ marginBottom: "1.5rem" }}>
        <Button
          variant="primary"
          onClick={onInstall}
          isDisabled={!canInstall || installing}
          isLoading={installing}
        >
          {status === "failed" ? "Re-trigger Install" : "Start Install on Bootstrap Appliance"}
        </Button>
      </div>

      {log.length > 0 && (
        <div>
          <div style={{
            fontSize: "0.8rem",
            color: "#6a6e73",
            marginBottom: "0.25rem",
          }}>
            Install log — last {log.length} lines
          </div>
          <pre
            ref={logRef}
            style={{
              background: "#0f0f0f",
              color: "#e0e0e0",
              padding: "1rem",
              borderRadius: "4px",
              fontSize: "0.75rem",
              lineHeight: "1.5",
              height: "420px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              margin: 0,
            }}
          >
            {log.join("\n")}
          </pre>
        </div>
      )}

      {log.length === 0 && (status === "running" || status === "succeeded" || status === "failed") && (
        <div style={{ color: "#6a6e73", fontSize: "0.875rem" }}>
          Waiting for log output…
        </div>
      )}
    </div>
  );
}
