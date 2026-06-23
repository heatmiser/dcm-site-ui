import React, { useEffect, useState } from "react";
import { api } from "./api.js";

export default function App() {
  const [nodes, setNodes] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listNodes()
      .then((data) => setNodes(data.nodes))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div style={{ fontFamily: "RedHatText, sans-serif", padding: "2rem", maxWidth: "960px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>dcm-site-ui</h1>
      <p style={{ color: "#6a6e73", marginBottom: "2rem" }}>
        OCP cluster discovery and classification — Phase 3 operator UI
      </p>

      {error && (
        <div style={{ background: "#fdf1eb", border: "1px solid #f4763b", padding: "1rem", borderRadius: "4px", marginBottom: "1rem" }}>
          Backend unreachable: {error}
        </div>
      )}

      <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>
        Discovered Nodes ({nodes.length})
      </h2>

      {nodes.length === 0 ? (
        <p style={{ color: "#6a6e73" }}>
          No nodes yet. Boot nodes with the discovery ISO or run{" "}
          <code>./scripts/simulate-phone-home.sh http://localhost:9090</code> to seed fixtures.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #d2d2d2", textAlign: "left" }}>
              <th style={{ padding: "0.5rem" }}>Serial</th>
              <th style={{ padding: "0.5rem" }}>IP</th>
              <th style={{ padding: "0.5rem" }}>System</th>
              <th style={{ padding: "0.5rem" }}>CPU</th>
              <th style={{ padding: "0.5rem" }}>RAM (GB)</th>
              <th style={{ padding: "0.5rem" }}>Role</th>
              <th style={{ padding: "0.5rem" }}>Hostname</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "0.5rem", fontFamily: "monospace" }}>{node.serial}</td>
                <td style={{ padding: "0.5rem", fontFamily: "monospace" }}>{node.ip}</td>
                <td style={{ padding: "0.5rem" }}>
                  {node.manifest?.system?.manufacturer} {node.manifest?.system?.model}
                </td>
                <td style={{ padding: "0.5rem" }}>{node.manifest?.cpu?.count}c</td>
                <td style={{ padding: "0.5rem" }}>{node.manifest?.memory_gb}</td>
                <td style={{ padding: "0.5rem", color: node.role ? "#3e8635" : "#6a6e73" }}>
                  {node.role || "—"}
                </td>
                <td style={{ padding: "0.5rem", fontFamily: "monospace", fontSize: "0.8rem" }}>
                  {node.hostname || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: "3rem", fontSize: "0.75rem", color: "#6a6e73" }}>
        Classification grid, hardware drawer, and install kickoff — next phase.
      </p>
    </div>
  );
}
