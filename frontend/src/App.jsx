import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  AlertActionCloseButton,
  Badge,
  Spinner,
  Tab,
  Tabs,
  TabTitleText,
} from "@patternfly/react-core";
import { api } from "./api.js";
import DiscoveryView from "./DiscoveryView.jsx";
import ClassifyView from "./ClassifyView.jsx";
import ConfigureView from "./ConfigureView.jsx";
import ReviewView from "./ReviewView.jsx";

const POLL_MS = 5000;
const ROLE_ORDER = { "control-plane": 0, "infra": 1, "worker": 2, "storage": 3 };

function toYamlScalar(v) {
  if (v === null || v === undefined) return "~";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (v.includes(":") || v.includes("#") || v === "" || /^\s|\s$/.test(v)) return `"${v}"`;
    return v;
  }
  return String(v);
}

function yamlList(items, indent = 2) {
  const pad = " ".repeat(indent);
  return items.map(item => `${pad}- ${toYamlScalar(item)}`).join("\n");
}

function buildNmstateYaml(networkConfig, indent = 6) {
  if (!networkConfig) return null;
  const pad = " ".repeat(indent);
  const lines = [];
  function walk(obj, depth) {
    const p = " ".repeat(depth);
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (typeof item === "object" && item !== null) {
          const entries = Object.entries(item);
          const [first, ...rest] = entries;
          lines.push(`${p}- ${first[0]}: ${toYamlScalar(first[1])}`);
          for (const [k, v] of rest) {
            if (typeof v === "object" && v !== null) {
              lines.push(`${p}  ${k}:`);
              walk(v, depth + 4);
            } else {
              lines.push(`${p}  ${k}: ${toYamlScalar(v)}`);
            }
          }
        } else {
          lines.push(`${p}- ${toYamlScalar(item)}`);
        }
      }
    } else if (typeof obj === "object" && obj !== null) {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "object" && v !== null) {
          lines.push(`${p}${k}:`);
          walk(v, depth + 2);
        } else {
          lines.push(`${p}${k}: ${toYamlScalar(v)}`);
        }
      }
    }
  }
  walk(networkConfig, indent);
  return lines.join("\n");
}

export default function App() {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [activeTab, setActiveTab] = useState("discovery");
  const [selections, setSelections] = useState({});
  const [alert, setAlert] = useState(null);
  const [clusterConfig, setClusterConfig] = useState({});
  const [ocpVersions, setOcpVersions] = useState({ default: "", versions: [] });
  const [nodeNetworks, setNodeNetworks] = useState({});

  const fetchNodes = useCallback(async () => {
    try {
      const data = await api.listNodes();
      const fetched = data.nodes || [];
      setNodes(fetched);
      setSelections(prev => {
        const merged = { ...prev };
        for (const node of fetched) {
          if (node.role && !merged[node.id]) {
            merged[node.id] = {
              role: node.role,
              hostname: node.hostname || "",
              interface_selected: node.interface_selected || "",
              disk_selected: node.disk_selected || "",
            };
          }
        }
        return merged;
      });
      setFetchError(null);
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load cluster config, ocp versions, and bootstrap pre-population on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const [bootstrap, versions, saved] = await Promise.all([
          api.getBootstrapConfig(),
          api.getOcpVersions(),
          api.getClusterConfig(),
        ]);
        setOcpVersions(versions);
        // Merge: built-in defaults → bootstrap → saved DB (each layer overrides the prior)
        const defaults = {
          machine_network_cidr: "10.0.0.0/16",
          pod_network_cidr: "10.128.0.0/14",
          service_network_cidr: "172.30.0.0/16",
        };
        setClusterConfig({ ...defaults, ...bootstrap, ...saved });
        if (!saved.ocp_version && versions.default) {
          setClusterConfig(prev => ({ ...prev, ocp_version: versions.default }));
        }
      } catch { /* non-fatal — form still usable */ }
    }
    loadConfig();
  }, []);

  useEffect(() => { fetchNodes(); }, [fetchNodes]);

  useEffect(() => {
    if (activeTab !== "discovery") return;
    const id = setInterval(fetchNodes, POLL_MS);
    return () => clearInterval(id);
  }, [activeTab, fetchNodes]);

  const handleSelect = (nodeId, field, value) => {
    setSelections(prev => ({
      ...prev,
      [nodeId]: { ...(prev[nodeId] || {}), [field]: value },
    }));
  };

  const handleClassify = useCallback(async () => {
    const payload = Object.entries(selections)
      .map(([id, fields]) => ({ id, ...fields }))
      .filter(n => n.role && n.hostname);
    if (payload.length === 0) {
      setAlert({ variant: "warning", title: "Assign at least one node with a role and hostname." });
      return;
    }
    try {
      await api.classifyNodes(payload);
      await fetchNodes();
      setAlert({ variant: "success", title: `${payload.length} node(s) classified successfully.` });
      setActiveTab("configure");
    } catch (err) {
      setAlert({ variant: "danger", title: "Classification failed.", body: err.message });
    }
  }, [selections, fetchNodes]);

  const handleReset = useCallback(async () => {
    if (!window.confirm("Reset all classifications? All role, hostname, and NIC/disk selections will be cleared.")) return;
    try {
      await api.resetNodes();
      setSelections({});
      setNodeNetworks({});
      await fetchNodes();
      setAlert({ variant: "info", title: "All classifications reset." });
      setActiveTab("classify");
    } catch (err) {
      setAlert({ variant: "danger", title: "Reset failed.", body: err.message });
    }
  }, [fetchNodes]);

  const handleExport = useCallback(async () => {
    const classified = nodes
      .filter(n => n.role)
      .slice()
      .sort((a, b) => {
        const ra = ROLE_ORDER[a.role] ?? 99;
        const rb = ROLE_ORDER[b.role] ?? 99;
        if (ra !== rb) return ra - rb;
        return (a.hostname || "").localeCompare(b.hostname || "");
      });

    if (classified.length === 0) {
      setAlert({ variant: "warning", title: "No classified nodes to export." });
      return;
    }

    try {
      await api.generate({ nodes: classified.map(n => ({ id: n.id })) });

      const cc = clusterConfig;
      const ntpList = (cc.ntp_servers || "").split(",").map(s => s.trim()).filter(Boolean);
      const dnsList = (cc.dns_servers || "").split(",").map(s => s.trim()).filter(Boolean);

      const lines = [
        "# cluster-vars.yaml — generated by dcm-site-ui",
        "# Usage: ansible-playbook install_abi.yml -e @cluster-vars.yaml -e @secrets.yaml",
        "",
      ];

      if (cc.ocp_version) lines.push(`ocp_version: "${cc.ocp_version}"`);
      if (cc.cluster_name) lines.push(`cluster_name: ${cc.cluster_name}`);
      if (cc.base_domain) lines.push(`base_domain: ${cc.base_domain}`);
      if (cc.api_vip) lines.push(`api_vip: ${cc.api_vip}`);
      if (cc.ingress_vip) lines.push(`ingress_vip: ${cc.ingress_vip}`);
      if (cc.machine_network_cidr) lines.push(`machine_network_cidr: ${cc.machine_network_cidr}`);
      if (cc.pod_network_cidr) lines.push(`pod_network_cidr: ${cc.pod_network_cidr}`);
      if (cc.service_network_cidr) lines.push(`service_network_cidr: ${cc.service_network_cidr}`);
      lines.push(`network_type: OVNKubernetes`);
      if (cc.rendezvous_ip) lines.push(`rendezvous_ip: ${cc.rendezvous_ip}`);

      if (ntpList.length > 0) {
        lines.push("ntp_servers:");
        lines.push(yamlList(ntpList));
      }
      if (dnsList.length > 0) {
        lines.push("dns_servers:");
        lines.push(yamlList(dnsList));
      }

      if (cc.http_proxy) lines.push(`http_proxy: ${cc.http_proxy}`);
      if (cc.https_proxy) lines.push(`https_proxy: ${cc.https_proxy}`);
      if (cc.no_proxy) lines.push(`no_proxy: "${cc.no_proxy}"`);

      lines.push("");
      lines.push("ocp_nodes:");

      for (const node of classified) {
        const roleOut = node.role === "control-plane" ? "master" : "worker";
        lines.push(`  - hostname: ${node.hostname}`);
        lines.push(`    role: ${roleOut}`);
        if (node.disk_selected) lines.push(`    root_device_hints:`);
        if (node.disk_selected) lines.push(`      deviceName: "${node.disk_selected}"`);

        // interfaces: name→MAC from manifest for all physical NICs in use
        const m = node.manifest || {};
        const allIfaces = m.interfaces || [];
        const netCfg = node.network_config;
        const netState = nodeNetworks[node.id];

        let ifaceNames = [];
        if (netState?.mode === "bond") {
          // collect all member NICs across all bonds
          ifaceNames = (netState.bonds || []).flatMap(b => b.members || []);
        } else if (netState?.mode === "simple" && netState.simple?.nic) {
          ifaceNames = [netState.simple.nic];
        } else if (node.interface_selected) {
          ifaceNames = [node.interface_selected];
        }

        if (ifaceNames.length > 0) {
          lines.push(`    interfaces:`);
          for (const name of ifaceNames) {
            const ifc = allIfaces.find(i => i.name === name);
            lines.push(`      - name: ${name}`);
            if (ifc?.mac) lines.push(`        macAddress: ${ifc.mac}`);
          }
        }

        if (netCfg) {
          lines.push(`    networkConfig:`);
          const yamlBlock = buildNmstateYaml(netCfg, 6);
          if (yamlBlock) lines.push(yamlBlock);
        }
      }

      const blob = new Blob([lines.join("\n") + "\n"], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cluster-vars.yaml";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setAlert({ variant: "danger", title: "Export failed.", body: err.message });
    }
  }, [nodes, clusterConfig, nodeNetworks]);

  const classifiedCount = nodes.filter(n => n.role).length;
  const pendingCount = nodes.filter(n => !n.role).length;

  return (
    <div>
      <div style={{
        background: "#151515",
        color: "#fff",
        padding: "0.75rem 1.5rem",
        display: "flex",
        alignItems: "center",
        gap: "1rem",
      }}>
        <span style={{ fontWeight: 600, fontSize: "1.1rem" }}>dcm-site-ui</span>
        <span style={{ color: "#8a8d90", fontSize: "0.875rem" }}>
          OCP cluster discovery and classification — Phase 3
        </span>
      </div>

      <div style={{ padding: "1.5rem" }}>
        {fetchError && (
          <Alert
            variant="danger"
            title="Backend unreachable"
            actionClose={<AlertActionCloseButton onClose={() => setFetchError(null)} />}
            style={{ marginBottom: "1rem" }}
          >
            {fetchError}
          </Alert>
        )}
        {alert && (
          <Alert
            variant={alert.variant}
            title={alert.title}
            actionClose={<AlertActionCloseButton onClose={() => setAlert(null)} />}
            style={{ marginBottom: "1rem" }}
          >
            {alert.body}
          </Alert>
        )}

        <Tabs
          activeKey={activeTab}
          onSelect={(_, key) => setActiveTab(key)}
          style={{ marginBottom: "1.5rem" }}
        >
          <Tab
            eventKey="discovery"
            title={
              <TabTitleText>
                Discovery <Badge isRead style={{ marginLeft: "0.25rem" }}>{nodes.length}</Badge>
              </TabTitleText>
            }
          >
            {loading
              ? <div style={{ textAlign: "center", padding: "3rem" }}><Spinner /></div>
              : <DiscoveryView nodes={nodes} onNavigate={() => setActiveTab("classify")} />
            }
          </Tab>

          <Tab
            eventKey="classify"
            title={
              <TabTitleText>
                Classify <Badge isRead style={{ marginLeft: "0.25rem" }}>{pendingCount} pending</Badge>
              </TabTitleText>
            }
          >
            <ClassifyView
              nodes={nodes}
              selections={selections}
              onSelect={handleSelect}
              onClassify={handleClassify}
              onReset={handleReset}
            />
          </Tab>

          <Tab
            eventKey="configure"
            title={
              <TabTitleText>
                Configure <Badge isRead style={{ marginLeft: "0.25rem" }}>{classifiedCount} nodes</Badge>
              </TabTitleText>
            }
          >
            <ConfigureView
              nodes={nodes}
              clusterConfig={clusterConfig}
              ocpVersions={ocpVersions}
              onClusterConfigChange={setClusterConfig}
              nodeNetworks={nodeNetworks}
              onNodeNetworkChange={(nodeId, netState) =>
                setNodeNetworks(prev => ({ ...prev, [nodeId]: netState }))
              }
            />
          </Tab>

          <Tab
            eventKey="review"
            title={
              <TabTitleText>
                Review + Export <Badge isRead style={{ marginLeft: "0.25rem" }}>{classifiedCount} ready</Badge>
              </TabTitleText>
            }
          >
            <ReviewView nodes={nodes} onExport={handleExport} onReset={handleReset} />
          </Tab>
        </Tabs>
      </div>
    </div>
  );
}
