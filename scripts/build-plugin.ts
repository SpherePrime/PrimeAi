import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function main(): Promise<void> {
  let deployment = { serverUrl: "https://sphereprime.online", pluginToken: "" };
  try {
    deployment = JSON.parse(await readFile(resolve("deployment.json"), "utf8")) as typeof deployment;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: "dist/index.js",
    sourcemap: false,
    define: {
      __PRIMEAI_SERVER_URL__: JSON.stringify(String(deployment.serverUrl || "https://sphereprime.online").trim()),
      __PRIMEAI_PLUGIN_TOKEN__: JSON.stringify(String(deployment.pluginToken ?? "").trim()),
    },
  });
}

void main();
