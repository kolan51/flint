import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { paths } from "./store.js";

const tokenFile = path.join(paths.dataDir, "api-token");

let token = "";

function ensureToken() {
  const fromEnv = String(process.env.FLINT_API_TOKEN || "").trim();
  if (fromEnv) {
    token = fromEnv;
    return token;
  }
  if (token) return token;
  try {
    const existing = fs.readFileSync(tokenFile, "utf8").trim();
    if (existing.length >= 24) {
      token = existing;
      return token;
    }
  } catch {
    /* create a new token */
  }
  token = crypto.randomBytes(24).toString("hex");
  try {
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.writeFileSync(tokenFile, token, { encoding: "utf8", mode: 0o600 });
  } catch {
    /* memory-only token still protects this process */
  }
  return token;
}

export function apiToken() {
  return ensureToken();
}

export function isLocalHost(hostHeader) {
  const host = String(hostHeader || "").trim().toLowerCase();
  if (!host) return false;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    const name = end > 0 ? host.slice(1, end) : host;
    return name === "::1";
  }
  const name = host.split("%")[0].split(":")[0];
  return name === "127.0.0.1" || name === "localhost" || name === "::1";
}

export function isLocalOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return isLocalHost(url.host) || isLocalHost(url.hostname);
  } catch {
    return false;
  }
}

export function requestToken(req) {
  const header = String(req.headers["x-flint-token"] || "").trim();
  if (header) return header;
  const auth = String(req.headers.authorization || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  const query = String(req.query?.token || "").trim();
  return query;
}

export function hasValidToken(req) {
  const got = requestToken(req);
  return Boolean(got) && got === ensureToken();
}

export function allowBoot(req) {
  if (!isLocalHost(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !isLocalOrigin(origin)) return false;
  const site = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (site && site !== "same-origin" && site !== "none") return false;
  return true;
}

export function corsOptions() {
  return {
    origin(origin, callback) {
      if (!origin || isLocalOrigin(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: false,
    allowedHeaders: ["Content-Type", "Authorization", "X-Flint-Token"],
  };
}

export function guardApi(req, res, next) {
  if (!String(req.path || "").startsWith("/api")) return next();
  if (!isLocalHost(req.headers.host)) {
    return res.status(403).json({ error: "Flint only answers on localhost." });
  }
  const origin = req.headers.origin;
  if (origin && !isLocalOrigin(origin)) {
    return res.status(403).json({ error: "Cross-origin requests to Flint are blocked." });
  }
  if (req.path === "/api/health") return next();
  if (req.path === "/api/boot") return next();
  if (!hasValidToken(req)) {
    return res.status(401).json({ error: "Flint API token required." });
  }
  return next();
}
