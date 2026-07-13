const BASE = import.meta.env.VITE_API_BASE || "";

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

async function put(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
  return res.json();
}

export const api = {
  health: () => get("/healthz"),
  listNodes: () => get("/api/discovery/nodes"),
  reportNode: (payload) => post("/api/discovery/report", payload),
  drainNode: () => get("/api/discovery/drain"),
  classifyNodes: (nodes) => post("/api/discovery/classify", { nodes }),
  generate: (params) => post("/api/discovery/generate", params),
  resetNodes: () => post("/api/discovery/reset", {}),
  saveNodeNetwork: (id, networkConfig) => put(`/api/discovery/nodes/${id}/network-config`, networkConfig),
  getBootstrapConfig: () => get("/api/bootstrap-config"),
  getOcpVersions: () => get("/api/ocp-versions"),
  getClusterConfig: () => get("/api/cluster-config"),
  putClusterConfig: (config) => put("/api/cluster-config", config),
  triggerInstall: (cluster_name, cluster_vars_yaml) =>
    post("/api/install", { cluster_name, cluster_vars_yaml }),
  getInstallStatus: (name) => get(`/api/install/${name}/status`),
  getInstallLog: (name) => get(`/api/install/${name}/log`),
};
