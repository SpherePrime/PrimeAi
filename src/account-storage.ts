import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

async function protect(value: Buffer, decrypt: boolean): Promise<Buffer> {
  if (process.platform !== "win32") return value;
  const method = decrypt ? "Unprotect" : "Protect";
  const script = `Add-Type -AssemblyName System.Security; $v=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${method}($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`;
  return new Promise((resolve, reject) => {
    const child = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
      if (error) reject(new Error("Не удалось открыть защищённую сессию"));
      else resolve(Buffer.from(stdout.trim(), "base64"));
    });
    child.stdin?.end(value.toString("base64"));
  });
}

export async function loadAccount(path: string): Promise<{ token?: unknown }> {
  return JSON.parse((await protect(await readFile(path), true)).toString("utf8"));
}

export async function saveAccount(path: string, token: string): Promise<void> {
  const content = await protect(Buffer.from(JSON.stringify({ token })), false);
  await writeFile(path, content, { mode: 0o600 });
}
