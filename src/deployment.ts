import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DeploymentConfig {
  serverUrl: string;
  pluginToken: string;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function loadDeployment(pluginDirectory: string): DeploymentConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(pluginDirectory, "deployment.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { serverUrl: "https://sphereprime.online", pluginToken: "" };
    }
    throw new Error("PrimeAI deployment.json is missing or invalid");
  }
  return validateDeployment(parsed);
}

function validateDeployment(parsed: unknown): DeploymentConfig {
  if (!parsed || typeof parsed !== "object") throw new Error("PrimeAI deployment.json is invalid");
  const value = parsed as Record<string, unknown>;
  if (typeof value.serverUrl !== "string" || typeof value.pluginToken !== "string") {
    throw new Error("PrimeAI deployment.json is invalid");
  }
  let url: URL;
  try {
    url = new URL(value.serverUrl);
  } catch {
    throw new Error("PrimeAI serverUrl is invalid");
  }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname)))) {
    throw new Error("PrimeAI serverUrl must use HTTPS");
  }
  return { serverUrl: url.origin + url.pathname.replace(/\/$/, ""), pluginToken: value.pluginToken.trim() };
}
