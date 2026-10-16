import { build } from "esbuild";

async function main(): Promise<void> {
  await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: "dist/index.js",
    sourcemap: false,
  });
}

void main();
