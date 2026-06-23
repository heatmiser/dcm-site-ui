// Copyright (c) 2025 Bill Strauss — MIT License
/**
 * Request correlation and structured logging middleware.
 *
 * Adapted from openshift-airgap-architect (MIT) by Bill Strauss.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import logger from "../logger.js";

const asyncLocalStorage = new AsyncLocalStorage();

const SKIP_LOG_PATTERN = /^\/(healthz|api\/metrics)$/;

export function loggingMiddleware(req, res, next) {
  const requestId =
    req.headers["x-request-id"] ||
    `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  req.requestId = requestId;

  asyncLocalStorage.run({ requestId }, () => {
    const skip = SKIP_LOG_PATTERN.test(req.path);

    if (!skip) {
      logger.info(
        { tag: "request:start", requestId, method: req.method, path: req.path },
        "Request started"
      );
    }

    const start = Date.now();
    res.on("finish", () => {
      if (skip) return;
      const duration = Date.now() - start;
      const logFn =
        res.statusCode >= 500
          ? logger.error.bind(logger)
          : res.statusCode >= 400
            ? logger.warn.bind(logger)
            : logger.info.bind(logger);
      logFn(
        { tag: "request:complete", requestId, method: req.method, path: req.path, statusCode: res.statusCode, duration },
        "Request completed"
      );
    });

    next();
  });
}

export function getCurrentRequestId() {
  return asyncLocalStorage.getStore()?.requestId;
}
