import { recordHttpRequest } from "../metrics.js";

export function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    recordHttpRequest(req.method, req.route?.path || req.path, res.statusCode, durationSeconds);
  });
  next();
}
