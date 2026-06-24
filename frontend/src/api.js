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

export const api = {
  health: () => get("/healthz"),
  listNodes: () => get("/api/discovery/nodes"),
  reportNode: (payload) => post("/api/discovery/report", payload),
  drainNode: () => get("/api/discovery/drain"),
  classifyNodes: (nodes) => post("/api/discovery/classify", { nodes }),
  generate: (params) => post("/api/discovery/generate", params),
  resetNodes: () => post("/api/discovery/reset", {}),
};
