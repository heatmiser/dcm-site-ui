// Copyright (c) 2025 Bill Strauss — MIT License
/**
 * Prometheus metrics.
 *
 * Adapted from openshift-airgap-architect (MIT) by Bill Strauss.
 */
import client from "prom-client";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

export const discoveryReportsTotal = new client.Counter({
  name: "discovery_reports_total",
  help: "Total node discovery reports received",
  labelNames: ["status"],
  registers: [register],
});

export const discoveredNodesGauge = new client.Gauge({
  name: "discovered_nodes_current",
  help: "Number of discovered nodes in the database",
  registers: [register],
});

export function recordHttpRequest(method, route, statusCode, durationSeconds) {
  httpRequestsTotal.inc({ method, route, status_code: statusCode });
  httpRequestDuration.observe({ method, route, status_code: statusCode }, durationSeconds);
}

export async function getMetrics() {
  return register.metrics();
}

export function getMetricsContentType() {
  return register.contentType;
}

export { register };
