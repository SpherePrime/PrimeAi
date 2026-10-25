import { readFileSync } from "node:fs";
import { join } from "node:path";

export const primeIconSvg = readFileSync(join(__dirname, "..", "icon.svg"), "utf8");
