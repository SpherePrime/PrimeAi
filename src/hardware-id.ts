import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const commandTimeoutMs = 4_000;
let cachedHardwareUuid: Promise<string> | undefined;

async function readCommand(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: commandTimeoutMs,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function readFileContent(path: string): Promise<string> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return "";
  }
}

async function resolveHardwareUuid(): Promise<string> {
  if (platform() === "win32") {
    const output = await readCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID"]);
    return output.split(/\r?\n/).find((value) => value.trim() && value.trim() !== "UUID")?.trim() ?? "";
  }
  if (platform() === "linux") return readFileContent("/sys/class/dmi/id/product_uuid");
  if (platform() === "darwin") {
    const output = await readCommand("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
    return output.match(/"IOPlatformUUID" = "([^"]+)"/)?.[1] ?? "";
  }
  return "";
}

function hardwareUuid(): Promise<string> {
  if (!cachedHardwareUuid) {
    cachedHardwareUuid = resolveHardwareUuid();
  }
  return cachedHardwareUuid;
}

export function hashHardwareId(source: string): string {
  return createHash("sha256").update(source.trim().toLowerCase()).digest("hex");
}

export async function getHardwareId(fallbackId: string): Promise<string> {
  return hashHardwareId((await hardwareUuid()) || fallbackId);
}
