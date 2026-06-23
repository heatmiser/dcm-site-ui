// Copyright (c) 2025 Bill Strauss — MIT License
/**
 * Structured logging via Pino.
 *
 * Adapted from openshift-airgap-architect (MIT) by Bill Strauss.
 */
import pino from "pino";
import crypto from "node:crypto";

const isDevelopment = process.env.NODE_ENV !== "production";
const isTest = process.env.NODE_ENV === "test";
const logLevel = process.env.LOG_LEVEL || (isTest ? "silent" : isDevelopment ? "debug" : "info");
const logFormat = process.env.LOG_FORMAT || (isDevelopment ? "pretty" : "json");

const logger = pino({
  level: logLevel,
  transport:
    logFormat === "pretty" && isDevelopment && !isTest
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});

export function generateErrorId() {
  return `err_${crypto.randomUUID()}`;
}

export default logger;
