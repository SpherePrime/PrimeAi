import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outPath = join(root, "dwertyfa-prime-ai-0.2.1-noarch.astraplugin");

const included = [
  "icon.svg",
  "package.json",
  "plugin.toml",
  "dist/index.js",
  "ui/app.js",
  "ui/index.html",
  "ui/main.ts",
  "ui/model-picker.ts",
  "ui/styles.css",
];

function crc32(data: Uint8Array): number {
  let table = (crc32 as { table?: number[] }).table;
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table.push(c >>> 0);
    }
    (crc32 as { table?: number[] }).table = table;
  }
  let value = 0xffffffff;
  for (const byte of data) value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");
const files: Array<{ path: string; sha256: string; size: number; mode: string }> = [];
for (const name of included) {
  const data = readFileSync(join(root, name));
  files.push({ path: name, sha256: sha256(data), size: data.length, mode: "0644" });
}
files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
const sortedIncluded = files.map((file) => file.path);

const manifest = {
  schema: "astra.bundle/2",
  plugin_id: "dwertyfa-prime-ai",
  version: "0.2.1",
  platform: { os: "any", arch: "any" },
  protocol: 1,
  min_astra_version: "",
  capabilities: ["ai_provider", "tools", "ui_contributions"],
  permissions: {},
  permissions_hash: "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  entry: { command: "node", args: ["dist/index.js"] },
  files,
};

const manifestData = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
const allEntries: Array<{ name: string; data: Buffer; offset: number }> = [];
let offset = 0;
allEntries.push({ name: "MANIFEST.json", data: manifestData, offset });
offset += 30 + Buffer.from("MANIFEST.json", "utf8").length + manifestData.length;
for (const name of sortedIncluded) {
  const data = readFileSync(join(root, name));
  allEntries.push({ name, data, offset });
  offset += 30 + Buffer.from(name, "utf8").length + data.length;
}
const localHeaders: Buffer[] = [];
const centralHeaders: Buffer[] = [];
const localData: Buffer[] = [];
for (const entry of allEntries) {
  const nameBuf = Buffer.from(entry.name, "utf8");
  const crc = crc32(entry.data);
  const lfh = Buffer.alloc(30 + nameBuf.length);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(0, 6);
  lfh.writeUInt16LE(0, 8);
  lfh.writeUInt16LE(0, 10);
  lfh.writeUInt16LE(0, 12);
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(entry.data.length, 18);
  lfh.writeUInt32LE(entry.data.length, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);
  nameBuf.copy(lfh, 30);
  localHeaders.push(lfh);
  localData.push(entry.data);

  const ch = Buffer.alloc(46 + nameBuf.length);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0, 8);
  ch.writeUInt16LE(0, 10);
  ch.writeUInt16LE(0, 12);
  ch.writeUInt16LE(0, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(entry.data.length, 20);
  ch.writeUInt32LE(entry.data.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt16LE(0, 30);
  ch.writeUInt16LE(0, 32);
  ch.writeUInt16LE(0, 34);
  ch.writeUInt32LE(0, 36);
  ch.writeUInt32LE(entry.offset, 42);
  nameBuf.copy(ch, 46);
  centralHeaders.push(ch);
}
const centralStart = localHeaders.reduce((total, header, index) => total + header.length + localData[index].length, 0);
const central = Buffer.concat(centralHeaders);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(allEntries.length, 8);
eocd.writeUInt16LE(allEntries.length, 10);
eocd.writeUInt32LE(central.length, 12);
eocd.writeUInt32LE(centralStart, 16);
eocd.writeUInt16LE(0, 20);
const out = Buffer.concat(Array.from({ length: allEntries.length }, (_, index) => [localHeaders[index], localData[index]]).flat().concat(central, eocd));
writeFileSync(outPath, out);
console.log("Wrote", outPath, out.length, "bytes");
console.log("MANIFEST.json first (stored), astra.bundle/2, " + files.length + " files");
