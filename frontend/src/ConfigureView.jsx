import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
  Button,
  Label,
} from "@patternfly/react-core";
import { api } from "./api.js";

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

// Build NMState networkConfig from node net state.
// netState shape:
//   mode: "simple" | "bond"
//   simple: { nic, ip, prefixLength, gateway }
//   bonds: [{ name, mode, members[], ip, prefixLength, gateway, vlan, vlanId }]
//   dnsServers: string[]
function buildNmstate(node, netState) {
  const m = node.manifest || {};
  const allIfaces = m.interfaces || [];
  const dns = netState.dnsServers || [];

  const interfaces = [];
  const routes = [];

  if (netState.mode === "simple") {
    const { nic, ip, prefixLength, gateway } = netState.simple || {};
    if (!nic || !ip || !prefixLength) return null;
    const ifc = allIfaces.find(i => i.name === nic);
    interfaces.push({
      name: nic,
      type: "ethernet",
      state: "up",
      "mac-address": ifc?.mac || "",
      ipv4: {
        enabled: true,
        address: [{ ip, "prefix-length": parseInt(prefixLength, 10) }],
        dhcp: false,
      },
    });
    if (gateway) {
      routes.push({ destination: "0.0.0.0/0", "next-hop-address": gateway, "next-hop-interface": nic, "table-id": 254 });
    }
  } else if (netState.mode === "bond") {
    const defaultRouteBond = netState.defaultRouteBond || "";
    for (const bond of (netState.bonds || [])) {
      const { name, mode, members, ip, prefixLength, gateway, vlan, vlanId } = bond;
      if (!name || !members?.length) continue;

      const memberIfaces = allIfaces.filter(i => members.includes(i.name));
      const hasVlan = vlan && vlanId;
      const vlanIfaceName = hasVlan ? `${name}.${vlanId}` : null;
      const ipOnParent = !hasVlan;

      // Bond parent interface
      interfaces.push({
        name,
        type: "bond",
        state: "up",
        ipv4: ipOnParent && ip && prefixLength
          ? { enabled: true, address: [{ ip, "prefix-length": parseInt(prefixLength, 10) }], dhcp: false }
          : { enabled: false },
        "link-aggregation": {
          mode: mode || "active-backup",
          port: members,
        },
      });

      // Member ethernet interfaces (no IP)
      for (const mi of memberIfaces) {
        interfaces.push({
          name: mi.name,
          type: "ethernet",
          state: "up",
          "mac-address": mi.mac || "",
          ipv4: { enabled: false },
        });
      }

      // VLAN interface (carries the IP when VLAN is enabled)
      if (hasVlan && ip && prefixLength) {
        interfaces.push({
          name: vlanIfaceName,
          type: "vlan",
          state: "up",
          vlan: { "base-iface": name, id: parseInt(vlanId, 10) },
          ipv4: {
            enabled: true,
            address: [{ ip, "prefix-length": parseInt(prefixLength, 10) }],
            dhcp: false,
          },
        });
      }

      // Only the designated default route bond emits the 0.0.0.0/0 route
      if (name === defaultRouteBond && gateway) {
        const routeIface = hasVlan ? vlanIfaceName : name;
        routes.push({ destination: "0.0.0.0/0", "next-hop-address": gateway, "next-hop-interface": routeIface, "table-id": 254 });
      }
    }
    if (interfaces.length === 0) return null;
  } else {
    return null;
  }

  return {
    interfaces,
    "dns-resolver": { config: { server: dns } },
    routes: { config: routes },
  };
}

// Minimal YAML serializer for NMState preview
function toYaml(obj, indent = 0) {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return `${pad}~`;
  if (typeof obj === "boolean" || typeof obj === "number") return `${pad}${obj}`;
  if (typeof obj === "string") return `${pad}${formatScalar(obj)}`;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return `${pad}[]`;
    return obj.map(item => {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item);
        if (entries.length === 0) return `${pad}- {}`;
        const [[fk, fv], ...rest] = entries;
        const firstLine = `${pad}- ${fk}: ${typeof fv === "object" && fv !== null ? "" : formatScalar(fv)}`;
        const nestedFirst = typeof fv === "object" && fv !== null
          ? `${pad}- ${fk}:\n${toYaml(fv, indent + 2)}`
          : firstLine;
        if (rest.length === 0) return typeof fv === "object" && fv !== null ? nestedFirst : firstLine;
        const restLines = rest.map(([k, v]) =>
          typeof v === "object" && v !== null
            ? `${pad}  ${k}:\n${toYaml(v, indent + 2)}`
            : `${pad}  ${k}: ${formatScalar(v)}`
        );
        return [typeof fv === "object" && fv !== null ? nestedFirst : firstLine, ...restLines].join("\n");
      }
      return `${pad}- ${formatScalar(item)}`;
    }).join("\n");
  }
  return Object.entries(obj).map(([k, v]) =>
    typeof v === "object" && v !== null
      ? `${pad}${k}:\n${toYaml(v, indent + 1)}`
      : `${pad}${k}: ${formatScalar(v)}`
  ).join("\n");
}

function formatScalar(v) {
  if (v === null || v === undefined) return "~";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (v.includes(":") || v.includes("#") || v === "" || /^\s|\s$/.test(v)) return `"${v}"`;
    return v;
  }
  return String(v);
}

// --- Bond entry editor ---
function BondEntry({ bond, index, availableNics, allNics, onUpdate, onRemove }) {
  const { name, mode, members, ip, prefixLength, gateway, vlan, vlanId } = bond;
  const set = (field, value) => onUpdate({ ...bond, [field]: value });

  const vlanIfaceName = vlan && vlanId ? `${name || "bond"}.${vlanId}` : null;

  return (
    <div style={{
      border: "1px solid #b8bbbe",
      borderRadius: "4px",
      marginBottom: "0.75rem",
      overflow: "hidden",
    }}>
      <div style={{
        background: "#e8e8e8",
        padding: "0.4rem 0.75rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
          {name || `bond${index}`}
          {vlanIfaceName ? ` → ${vlanIfaceName}` : ""}
        </span>
        <Button variant="plain" onClick={onRemove} style={{ padding: "0 0.25rem", color: "#c9190b" }}>
          ✕ Remove
        </Button>
      </div>

      <div style={{ padding: "0.75rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Bond Name</label>
          <input className="pf-v5-c-form-control" value={name} onChange={e => set("name", e.target.value)} placeholder={`bond${index}`} style={{ width: "100%" }} />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Bond Mode</label>
          <select className="pf-v5-c-form-control" value={mode} onChange={e => set("mode", e.target.value)} style={{ width: "100%" }}>
            <option value="active-backup">active-backup</option>
            <option value="802.3ad">802.3ad (LACP)</option>
          </select>
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Member NICs</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {allNics.map(ifc => {
              const isMember = members.includes(ifc.name);
              const isUnavailable = !isMember && !availableNics.find(a => a.name === ifc.name);
              return (
                <label
                  key={ifc.name}
                  style={{
                    fontSize: "0.8rem",
                    cursor: isUnavailable ? "not-allowed" : "pointer",
                    opacity: isUnavailable ? 0.4 : 1,
                    padding: "0.2rem 0.5rem",
                    border: `1px solid ${isMember ? "#0066cc" : "#d2d2d2"}`,
                    borderRadius: "3px",
                    background: isMember ? "#e7f1fa" : "#fff",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.3rem",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isMember}
                    disabled={isUnavailable}
                    onChange={e => set("members", e.target.checked
                      ? [...members, ifc.name]
                      : members.filter(n => n !== ifc.name)
                    )}
                  />
                  <span>{ifc.name}</span>
                  <span style={{ color: "#6a6e73", fontSize: "0.72rem" }}>
                    {ifc.speed ? `${ifc.speed}Mbps` : ""}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>IP Address</label>
          <input className="pf-v5-c-form-control" value={ip} onChange={e => set("ip", e.target.value)} placeholder="10.5.1.21" style={{ width: "100%" }} />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Prefix Length</label>
          <input className="pf-v5-c-form-control" value={prefixLength} onChange={e => set("prefixLength", e.target.value)} placeholder="24" style={{ width: "100%" }} />
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>Default Gateway</label>
          <input className="pf-v5-c-form-control" value={gateway} onChange={e => set("gateway", e.target.value)} placeholder="10.5.1.1" style={{ width: "100%" }} />
        </div>

        {/* VLAN toggle */}
        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "1rem", marginTop: "0.25rem" }}>
          <label style={{ fontSize: "0.8rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <input type="checkbox" checked={!!vlan} onChange={e => set("vlan", e.target.checked)} />
            VLAN
          </label>
          {vlan && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>VLAN ID</label>
              <input
                className="pf-v5-c-form-control"
                value={vlanId}
                onChange={e => set("vlanId", e.target.value)}
                placeholder="100"
                style={{ width: "80px" }}
              />
              {vlanIfaceName && (
                <span style={{ fontSize: "0.75rem", color: "#6a6e73", fontFamily: "monospace" }}>
                  → interface: {vlanIfaceName}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Per-node network config panel ---
function NodeNetworkPanel({ node, netState, onChange, clusterDns }) {
  const m = node.manifest || {};
  const allNics = m.interfaces || [];

  const [showPreview, setShowPreview] = useState(false);

  const dns = (clusterDns || "").split(",").map(s => s.trim()).filter(Boolean);

  // Compute which NICs are claimed by any bond
  const claimedNics = new Set((netState.bonds || []).flatMap(b => b.members || []));
  const availableNics = allNics.filter(i => !claimedNics.has(i.name));

  const setMode = (mode) => onChange({ ...netState, mode });

  const setSimple = (field, value) =>
    onChange({ ...netState, simple: { ...(netState.simple || {}), [field]: value } });

  const updateBond = (idx, updated) => {
    const bonds = [...(netState.bonds || [])];
    bonds[idx] = updated;
    onChange({ ...netState, bonds });
  };

  const removeBond = (idx) => {
    const bonds = [...(netState.bonds || [])];
    const removed = bonds[idx];
    bonds.splice(idx, 1);
    const defaultRouteBond = netState.defaultRouteBond === removed?.name ? "" : netState.defaultRouteBond;
    onChange({ ...netState, bonds, defaultRouteBond });
  };

  const addBond = () => {
    const idx = (netState.bonds || []).length;
    const newBond = {
      name: `bond${idx}`,
      mode: "active-backup",
      members: [],
      ip: "",
      prefixLength: "24",
      gateway: "",
      vlan: false,
      vlanId: "",
    };
    onChange({ ...netState, bonds: [...(netState.bonds || []), newBond] });
  };

  const nmstate = buildNmstate(node, { ...netState, dnsServers: dns });

  return (
    <div style={{
      border: "1px solid #d2d2d2",
      borderRadius: "4px",
      marginBottom: "1rem",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        background: "#f0f0f0",
        padding: "0.6rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}>
        <Label color={roleColor(node.role)}>{node.role}</Label>
        <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{node.hostname}</span>
        <span style={{ fontSize: "0.8rem", color: "#6a6e73", marginLeft: "auto" }}>
          {node.ip} · {m.system?.manufacturer} {m.system?.model} · {allNics.length} NICs
        </span>
      </div>

      <div style={{ padding: "1rem" }}>
        {/* Mode selector */}
        <div style={{ marginBottom: "1rem", display: "flex", gap: "1.5rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>Network Mode</span>
          {["simple", "bond"].map(m => (
            <label key={m} style={{ fontSize: "0.875rem", cursor: "pointer" }}>
              <input
                type="radio"
                name={`mode-${node.id}`}
                value={m}
                checked={netState.mode === m}
                onChange={() => setMode(m)}
                style={{ marginRight: "0.4rem" }}
              />
              {m === "simple" ? "Simple (single NIC)" : "Bond (LAG)"}
            </label>
          ))}
        </div>

        {/* Simple mode */}
        {netState.mode === "simple" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Interface</label>
              <select
                className="pf-v5-c-form-control"
                value={netState.simple?.nic || ""}
                onChange={e => setSimple("nic", e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">— select —</option>
                {allNics.map(i => (
                  <option key={i.name} value={i.name}>
                    {i.name} ({i.mac}{i.speed ? ` · ${i.speed}Mbps` : ""}{i.state === "up" ? " · up" : " · down"})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>IP Address</label>
              <input className="pf-v5-c-form-control" value={netState.simple?.ip || ""} onChange={e => setSimple("ip", e.target.value)} placeholder="10.5.1.21" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Prefix Length</label>
              <input className="pf-v5-c-form-control" value={netState.simple?.prefixLength || "24"} onChange={e => setSimple("prefixLength", e.target.value)} placeholder="24" style={{ width: "100%" }} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Default Gateway</label>
              <input className="pf-v5-c-form-control" value={netState.simple?.gateway || ""} onChange={e => setSimple("gateway", e.target.value)} placeholder="10.5.1.1" style={{ width: "100%" }} />
            </div>
          </div>
        )}

        {/* Bond mode */}
        {netState.mode === "bond" && (
          <div style={{ marginBottom: "0.75rem" }}>
            {(netState.bonds || []).map((bond, idx) => (
              <BondEntry
                key={idx}
                bond={bond}
                index={idx}
                allNics={allNics}
                availableNics={availableNics}
                onUpdate={updated => updateBond(idx, updated)}
                onRemove={() => removeBond(idx)}
              />
            ))}
            <Button
              variant="secondary"
              onClick={addBond}
              isDisabled={availableNics.length === 0 && (netState.bonds || []).length > 0}
            >
              + Add Bond
            </Button>
            {availableNics.length === 0 && (netState.bonds || []).length > 0 && (
              <span style={{ marginLeft: "0.75rem", fontSize: "0.8rem", color: "#6a6e73" }}>
                All NICs assigned
              </span>
            )}

            {/* Default route selector — shown when there are 2+ bonds */}
            {(netState.bonds || []).filter(b => b.name).length >= 1 && (
              <div style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                background: "#f0f4f8",
                border: "1px solid #b8bbbe",
                borderRadius: "4px",
              }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                  Default Route Interface (0.0.0.0/0)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  {(netState.bonds || []).filter(b => b.name).map(b => (
                    <label key={b.name} style={{ fontSize: "0.875rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <input
                        type="radio"
                        name={`default-route-${node.id}`}
                        value={b.name}
                        checked={netState.defaultRouteBond === b.name}
                        onChange={() => onChange({ ...netState, defaultRouteBond: b.name })}
                      />
                      <span style={{ fontFamily: "monospace" }}>{b.name}</span>
                      {b.vlan && b.vlanId
                        ? <span style={{ color: "#6a6e73", fontSize: "0.8rem" }}>→ via {b.name}.{b.vlanId}</span>
                        : null}
                      {b.gateway
                        ? <span style={{ color: "#6a6e73", fontSize: "0.8rem" }}>gateway: {b.gateway}</span>
                        : <span style={{ color: "#c9190b", fontSize: "0.8rem" }}>no gateway set</span>}
                    </label>
                  ))}
                  <label style={{ fontSize: "0.875rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="radio"
                      name={`default-route-${node.id}`}
                      value=""
                      checked={!netState.defaultRouteBond}
                      onChange={() => onChange({ ...netState, defaultRouteBond: "" })}
                    />
                    <span style={{ color: "#6a6e73" }}>None (no default route)</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* DNS (read-only, inherited from cluster) */}
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
            DNS (inherited from cluster config)
          </label>
          <input
            className="pf-v5-c-form-control"
            value={clusterDns || ""}
            readOnly
            style={{ width: "100%", background: "#f5f5f5", color: "#6a6e73" }}
          />
        </div>

        {/* NMState preview */}
        <Button variant="link" isInline onClick={() => setShowPreview(v => !v)}>
          {showPreview ? "Hide" : "Show"} NMState preview
        </Button>
        {showPreview && (
          <pre style={{
            marginTop: "0.5rem",
            padding: "0.75rem",
            background: "#1e1e1e",
            color: "#d4d4d4",
            fontSize: "0.75rem",
            borderRadius: "4px",
            overflowX: "auto",
            whiteSpace: "pre",
          }}>
            {nmstate ? toYaml(nmstate) : "# Fill in interface and IP to preview NMState"}
          </pre>
        )}
      </div>
    </div>
  );
}

// --- Cluster config section ---
function ClusterConfigSection({ config, ocpVersions, onChange }) {
  const versions = ocpVersions?.versions || [];
  const set = (field, value) => onChange({ ...config, [field]: value });
  const [showProxy, setShowProxy] = useState(!!(config.http_proxy || config.https_proxy || config.no_proxy));

  return (
    <div style={{ marginBottom: "2rem" }}>
      <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem", borderBottom: "1px solid #d2d2d2", paddingBottom: "0.5rem" }}>
        Cluster Configuration
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>OCP Version</label>
          <select className="pf-v5-c-form-control" value={config.ocp_version || ""} onChange={e => set("ocp_version", e.target.value)} style={{ width: "100%" }}>
            <option value="">— select version —</option>
            {versions.map(v => (
              <option key={v.version} value={v.version}>{v.description || v.version}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Cluster Name</label>
          <input className="pf-v5-c-form-control" value={config.cluster_name || ""} onChange={e => set("cluster_name", e.target.value)} placeholder="my-cluster" style={{ width: "100%" }} />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Base Domain</label>
          <input className="pf-v5-c-form-control" value={config.base_domain || ""} onChange={e => set("base_domain", e.target.value)} placeholder="example.com" style={{ width: "100%" }} />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Rendezvous IP</label>
          <input className="pf-v5-c-form-control" value={config.rendezvous_ip || ""} onChange={e => set("rendezvous_ip", e.target.value)} placeholder="10.5.1.21" style={{ width: "100%" }} />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>API VIP</label>
          <input className="pf-v5-c-form-control" value={config.api_vip || ""} onChange={e => set("api_vip", e.target.value)} placeholder="10.5.1.10" style={{ width: "100%" }} />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Ingress VIP</label>
          <input className="pf-v5-c-form-control" value={config.ingress_vip || ""} onChange={e => set("ingress_vip", e.target.value)} placeholder="10.5.1.11" style={{ width: "100%" }} />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Machine Network CIDR</label>
          <input className="pf-v5-c-form-control" value={config.machine_network_cidr || ""} onChange={e => set("machine_network_cidr", e.target.value)} placeholder="10.5.1.0/24" style={{ width: "100%" }} />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Pod Network CIDR</label>
          <input className="pf-v5-c-form-control" value={config.pod_network_cidr || ""} onChange={e => set("pod_network_cidr", e.target.value)} placeholder="10.128.0.0/14" style={{ width: "100%" }} />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Service Network CIDR</label>
          <input className="pf-v5-c-form-control" value={config.service_network_cidr || ""} onChange={e => set("service_network_cidr", e.target.value)} placeholder="172.30.0.0/16" style={{ width: "100%" }} />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>NTP Servers (comma-separated)</label>
          <input className="pf-v5-c-form-control" value={config.ntp_servers || ""} onChange={e => set("ntp_servers", e.target.value)} placeholder="10.5.1.1" style={{ width: "100%" }} />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>DNS Servers (comma-separated)</label>
          <input className="pf-v5-c-form-control" value={config.dns_servers || ""} onChange={e => set("dns_servers", e.target.value)} placeholder="10.5.1.1" style={{ width: "100%" }} />
        </div>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <Button variant="link" isInline onClick={() => setShowProxy(v => !v)}>
          {showProxy ? "Hide" : "Configure"} proxy settings
        </Button>
        {showProxy && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.75rem" }}>
            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>HTTP Proxy</label>
              <input className="pf-v5-c-form-control" value={config.http_proxy || ""} onChange={e => set("http_proxy", e.target.value)} placeholder="http://proxy.example.com:3128" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>HTTPS Proxy</label>
              <input className="pf-v5-c-form-control" value={config.https_proxy || ""} onChange={e => set("https_proxy", e.target.value)} placeholder="http://proxy.example.com:3128" style={{ width: "100%" }} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>No Proxy (comma-separated)</label>
              <input className="pf-v5-c-form-control" value={config.no_proxy || ""} onChange={e => set("no_proxy", e.target.value)} placeholder=".cluster.local,.svc,localhost,127.0.0.1" style={{ width: "100%" }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main ConfigureView ---
export default function ConfigureView({ nodes, clusterConfig, ocpVersions, onClusterConfigChange, nodeNetworks, onNodeNetworkChange }) {
  const [saveStatus, setSaveStatus] = useState(null);
  const saveTimer = useRef(null);
  const classified = sortedClassified(nodes);

  const handleClusterChange = useCallback((updated) => {
    onClusterConfigChange(updated);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.putClusterConfig(updated);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(null), 2000);
      } catch {
        setSaveStatus("error");
      }
    }, 800);
  }, [onClusterConfigChange]);

  const handleNetworkChange = useCallback(async (nodeId, netState) => {
    onNodeNetworkChange(nodeId, netState);
    const dnsServers = (clusterConfig.dns_servers || "").split(",").map(s => s.trim()).filter(Boolean);
    const nmstate = buildNmstate(nodes.find(n => n.id === nodeId), { ...netState, dnsServers });
    if (nmstate) {
      try {
        await api.saveNodeNetwork(nodeId, nmstate);
      } catch { /* best-effort */ }
    }
  }, [onNodeNetworkChange, clusterConfig, nodes]);

  if (classified.length === 0) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#6a6e73" }}>
        No classified nodes yet. Classify nodes first, then configure the cluster here.
      </div>
    );
  }

  return (
    <div>
      {saveStatus === "saved" && (
        <Alert variant="success" title="Cluster config saved." style={{ marginBottom: "1rem" }} />
      )}
      {saveStatus === "error" && (
        <Alert variant="danger" title="Failed to save cluster config." style={{ marginBottom: "1rem" }} />
      )}

      <ClusterConfigSection
        config={clusterConfig}
        ocpVersions={ocpVersions}
        onChange={handleClusterChange}
      />

      <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem", borderBottom: "1px solid #d2d2d2", paddingBottom: "0.5rem" }}>
        Per-Node Network Configuration
      </h3>
      <p style={{ fontSize: "0.875rem", color: "#6a6e73", marginBottom: "1rem" }}>
        {classified.length} classified node{classified.length !== 1 ? "s" : ""}
      </p>

      {classified.map(node => (
        <NodeNetworkPanel
          key={node.id}
          node={node}
          netState={nodeNetworks[node.id] || {
            mode: "simple",
            simple: { nic: node.interface_selected || "", ip: "", prefixLength: "24", gateway: "" },
            bonds: [],
            defaultRouteBond: "",
          }}
          onChange={netState => handleNetworkChange(node.id, netState)}
          clusterDns={clusterConfig.dns_servers || ""}
        />
      ))}
    </div>
  );
}
