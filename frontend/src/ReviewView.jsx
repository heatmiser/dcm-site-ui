import React from "react";
import { Alert, Button, Label } from "@patternfly/react-core";

const ROLE_ORDER = { "control-plane": 0, "infra": 1, "worker": 2, "storage": 3 };

function roleColor(role) {
  if (role === "control-plane") return "blue";
  if (role === "infra") return "purple";
  if (role === "worker") return "green";
  if (role === "storage") return "orange";
  return "grey";
}

function sortedClassified(nodes) {
  return nodes
    .filter(n => n.role)
    .slice()
    .sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 99;
      const rb = ROLE_ORDER[b.role] ?? 99;
      if (ra !== rb) return ra - rb;
      return (a.hostname || "").localeCompare(b.hostname || "");
    });
}

export default function ReviewView({ nodes, onExport }) {
  const classified = sortedClassified(nodes);
  const unclassified = nodes.filter(n => !n.role);

  if (classified.length === 0) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#6a6e73" }}>
        No nodes classified yet. Go to Classify to assign roles.
      </div>
    );
  }

  const cpCount = classified.filter(n => n.role === "control-plane").length;
  const infraCount = classified.filter(n => n.role === "infra").length;
  const workerCount = classified.filter(n => n.role === "worker").length;
  const storageCount = classified.filter(n => n.role === "storage").length;

  return (
    <div>
      {unclassified.length > 0 && (
        <Alert
          variant="warning"
          title={`${unclassified.length} node(s) not yet classified — excluded from export`}
          style={{ marginBottom: "1rem" }}
        />
      )}

      <div style={{ marginBottom: "1rem", fontSize: "0.875rem", color: "#6a6e73" }}>
        {cpCount} control-plane
        {infraCount > 0 ? ` · ${infraCount} infra` : ""}
        {workerCount > 0 ? ` · ${workerCount} worker` : ""}
        {storageCount > 0 ? ` · ${storageCount} storage` : ""}
        {" · "}{classified.length} total
      </div>

      <table className="pf-v5-c-table pf-m-compact" style={{ width: "100%", marginBottom: "1.5rem" }}>
        <thead className="pf-v5-c-table__thead">
          <tr className="pf-v5-c-table__tr">
            <th className="pf-v5-c-table__th">Hostname</th>
            <th className="pf-v5-c-table__th">Role</th>
            <th className="pf-v5-c-table__th">IP</th>
            <th className="pf-v5-c-table__th">System</th>
            <th className="pf-v5-c-table__th">NIC</th>
            <th className="pf-v5-c-table__th">Boot Disk</th>
          </tr>
        </thead>
        <tbody className="pf-v5-c-table__tbody">
          {classified.map(node => (
            <tr key={node.id} className="pf-v5-c-table__tr">
              <td className="pf-v5-c-table__td" style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                {node.hostname}
              </td>
              <td className="pf-v5-c-table__td">
                <Label color={roleColor(node.role)}>{node.role}</Label>
              </td>
              <td className="pf-v5-c-table__td" style={{ fontFamily: "monospace" }}>
                {node.ip}
              </td>
              <td className="pf-v5-c-table__td">
                {node.manifest?.system?.manufacturer} {node.manifest?.system?.model}
              </td>
              <td className="pf-v5-c-table__td" style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                {node.interface_selected || "—"}
              </td>
              <td className="pf-v5-c-table__td" style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                {node.disk_selected || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Button variant="primary" onClick={onExport}>
        Export cluster-vars.yaml
      </Button>
    </div>
  );
}
