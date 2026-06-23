import React from "react";
import { Button } from "@patternfly/react-core";

function gpuSummary(gpu) {
  if (!gpu || gpu.length === 0) return "—";
  return gpu.map(g => `${g.count}× ${g.model}`).join(", ");
}

function cpuSummary(cpu) {
  if (!cpu) return "—";
  const words = (cpu.model || "").split(" ");
  const short = words.slice(0, 4).join(" ");
  return `${cpu.count}c ${short}`;
}

export default function DiscoveryView({ nodes, onNavigate }) {
  if (nodes.length === 0) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#6a6e73" }}>
        <p style={{ marginBottom: "0.5rem" }}>No nodes discovered yet.</p>
        <p style={{ fontSize: "0.875rem" }}>
          Boot nodes with the discovery ISO or run{" "}
          <code>./scripts/simulate-phone-home.sh http://localhost:9090</code>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{
        marginBottom: "1rem",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span style={{ color: "#6a6e73", fontSize: "0.875rem" }}>
          Polling every 5s — {nodes.length} node{nodes.length !== 1 ? "s" : ""} discovered
        </span>
        <Button variant="primary" onClick={onNavigate}>
          Proceed to Classify
        </Button>
      </div>

      <table className="pf-v5-c-table pf-m-compact" style={{ width: "100%" }}>
        <thead className="pf-v5-c-table__thead">
          <tr className="pf-v5-c-table__tr">
            <th className="pf-v5-c-table__th">Serial</th>
            <th className="pf-v5-c-table__th">IP</th>
            <th className="pf-v5-c-table__th">System</th>
            <th className="pf-v5-c-table__th">CPU</th>
            <th className="pf-v5-c-table__th">RAM (GB)</th>
            <th className="pf-v5-c-table__th">GPU</th>
            <th className="pf-v5-c-table__th">Disks</th>
            <th className="pf-v5-c-table__th">Status</th>
          </tr>
        </thead>
        <tbody className="pf-v5-c-table__tbody">
          {nodes.map(node => (
            <tr key={node.id} className="pf-v5-c-table__tr">
              <td className="pf-v5-c-table__td" style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                {node.serial}
              </td>
              <td className="pf-v5-c-table__td" style={{ fontFamily: "monospace" }}>
                {node.ip}
              </td>
              <td className="pf-v5-c-table__td">
                {node.manifest?.system?.manufacturer} {node.manifest?.system?.model}
              </td>
              <td className="pf-v5-c-table__td" style={{ fontSize: "0.8rem" }}>
                {cpuSummary(node.manifest?.cpu)}
              </td>
              <td className="pf-v5-c-table__td">{node.manifest?.memory_gb ?? "—"}</td>
              <td className="pf-v5-c-table__td" style={{ fontSize: "0.8rem" }}>
                {gpuSummary(node.manifest?.gpu)}
              </td>
              <td className="pf-v5-c-table__td">{node.manifest?.disks?.length ?? "—"}</td>
              <td className="pf-v5-c-table__td">
                {node.role
                  ? <span style={{ color: "#3e8635", fontWeight: 500 }}>✓ {node.role}</span>
                  : <span style={{ color: "#6a6e73" }}>pending</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
