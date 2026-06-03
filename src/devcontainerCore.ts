import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import * as net from "net";
import JSON5 from "json5";

export function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "";
}

export function getDevcontainerConfig(wsUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(wsUri, '.devcontainer', 'devcontainer.json');
}

export function getDevcontainerDir(wsUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(wsUri, '.devcontainer');
}

export async function workspaceFileExists(fileUri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(fileUri);
    return true;
  } catch {
    return false;
  }
}

export async function hasDevcontainerConfig(wsUri: vscode.Uri): Promise<boolean> {
  const devContainerConfig = getDevcontainerConfig(wsUri);
  return await workspaceFileExists(devContainerConfig);
}

let outputChannel: vscode.OutputChannel | undefined;
let logFileStream: fs.WriteStream | undefined;
let logFilePath: string | undefined;

function getLogDir(): string {
  const dir = path.join(os.tmpdir(), "open-remote-devcontainer");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function initLog(slug: string, role: "client" | "server"): void {
  if (logFileStream) {
    logFileStream.end();
    logFileStream = undefined;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  logFilePath = path.join(getLogDir(), `${role}-${slug}-${ts}.txt`);
}

function getLogStream(): fs.WriteStream {
  if (!logFileStream) {
    if (!logFilePath) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      logFilePath = path.join(getLogDir(), `session-${ts}.txt`);
    }
    logFileStream = fs.createWriteStream(logFilePath, { flags: "a" });
  }
  return logFileStream;
}

export function getOutput(): vscode.OutputChannel {
  if (!outputChannel) {
    const real = vscode.window.createOutputChannel("Open Remote - Devcontainer");
    outputChannel = {
      name: real.name,
      append(value: string) {
        real.append(value);
        getLogStream().write(value);
      },
      appendLine(value: string) {
        real.appendLine(value);
        getLogStream().write(value + "\n");
      },
      clear() { real.clear(); },
      show(preserveFocus?: any) { real.show(preserveFocus); },
      hide() { real.hide(); },
      replace(value: string) { real.replace(value); },
      dispose() {
        real.dispose();
        logFileStream?.end();
        logFileStream = undefined;
      },
    } as vscode.OutputChannel;
  }
  return outputChannel;
}

export async function openLogFile(): Promise<void> {
  const dir = getLogDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith(".txt")).sort().reverse();
  } catch {
    return;
  }
  if (files.length === 0) { return; }

  for (const f of files.slice(0, 2)) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(dir, f)));
    await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
  }
}

function logCommand(command: string, args: string[]) {
  const out = getOutput();
  const truncated = args.map(a => a.length > 200 ? a.slice(0, 200) + "…(truncated)" : a);
  const printable = [command, ...truncated].join(" ");
  out.appendLine("");
  out.appendLine(`$ ${printable}`);
}

export async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.on("error", () => {
      resolve(2222);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 2222;
      server.close(() => resolve(port));
    });
  });
}

export function getProjectName(wsUri: vscode.Uri): string {
  return path.basename(wsUri.fsPath);
}

export function getWorkspaceName(wsUri: vscode.Uri): string {
  return getProjectName(wsUri).toLowerCase();
}

export function makeWorkspaceSlug(wsUri: vscode.Uri): string {
  const name = getWorkspaceName(wsUri);
  let slug = name.replace(/[^a-z0-9._-]+/g, "-");
  slug = slug.replace(/^[._-]+|[._-]+$/g, "");
  return slug || "workspace";
}

export function getContainerImagePrefix(wsUri: vscode.Uri): string {
  const slug = makeWorkspaceSlug(wsUri);
  return `vsc-${slug}`;
}

export function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string }
): Promise<void> {
  const out = getOutput();
  logCommand(command, args);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    if (options?.input) {
      child.stdin.write(options.input);
      child.stdin.end();
    }
    child.stdout.on("data", (d) => out.append(d.toString()));
    child.stderr.on("data", (d) => out.append(d.toString()));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

export function getContainerBinary(): string {
  const config = vscode.workspace.getConfiguration("remote.devcontainer");
  return config.get<string>("containerBinary") || "docker";
}

export function getContainerExtraArgs(): string[] {
  const config = vscode.workspace.getConfiguration("remote.devcontainer");
  return config.get<string[]>("containerExtraArgs") ?? [];
}

export function getDevcontainerBinary(): string {
  const config = vscode.workspace.getConfiguration("remote.devcontainer");
  return config.get<string>("devcontainerBinary") || "devcontainer";
}

export function getDevcontainerExtraArgs(): string[] {
  const config = vscode.workspace.getConfiguration("remote.devcontainer");
  return config.get<string[]>("devcontainerExtraArgs") ?? [];
}

export function getDevcontainerBinaryPath(): string {
  const config = vscode.workspace.getConfiguration("remote.devcontainer");
  return config.get<string>("devcontainerBinaryPath") || path.join(getHomeDir(), ".devcontainers", "bin");
}

export async function runContainerCommand(
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string }
): Promise<void> {
  return await runCommand(getContainerBinary(), [...getContainerExtraArgs(), ...args], options);
}

export async function runContainerCommandCapture(
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string; code: number }> {
  return await runCommandCapture(getContainerBinary(), [...getContainerExtraArgs(), ...args], options);
}

export async function runDevcontainerCommand(
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string }
): Promise<void> {
  const absolutePath = path.join(getDevcontainerBinaryPath(), getDevcontainerBinary());
  return await runCommand(absolutePath, [...getDevcontainerExtraArgs(), ...args], options);
}

export async function runDevcontainerCommandCapture(
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string; code: number }> {
  const absolutePath = path.join(getDevcontainerBinaryPath(), getDevcontainerBinary());
  return await runCommandCapture(absolutePath, [...getDevcontainerExtraArgs(), ...args], options);
}

export async function runCommandCapture(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string; code: number }> {
  const out = getOutput();
  logCommand(command, args);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      out.append(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      out.append(s);
    });
    child.on("error", () => resolve({ stdout: "", stderr: "error", code: 1 }));
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

async function devcontainerUp(wsUri: vscode.Uri, noCache?: boolean) {
  const args = ["up"];
  if (noCache) {
    args.push("--build-no-cache");
  }
  vscode.window.showInformationMessage("Building devcontainer image...");
  getOutput().show(true);
  const res = await runDevcontainerCommandCapture(args, { cwd: wsUri.fsPath });
  if (res.code !== 0) {
    throw new Error(`Could not start container: ${res.stderr}`);
  }
  return JSON5.parse(res.stdout).containerId;
}

export async function getMappedPort(id: string, containerPort: number): Promise<number> {
  const res = await runContainerCommandCapture([
    "port", id, `${containerPort}/tcp`
  ]);
  if (res.code !== 0) {
    throw new Error(`Could not get port mapping for ${id}: ${res.stderr.trim()}`);
  }
  // Output is like "0.0.0.0:12345" or "127.0.0.1:12345"
  const match = res.stdout.trim().match(/:(\d+)$/m);
  if (!match) {
    throw new Error(`No port mapping found for ${containerPort}/tcp on ${id}`);
  }
  return Number(match[1]);
}

export async function ensureContainerStarted(id: string): Promise<void> {
  await runContainerCommand(["start", id]).catch(async () => {
    await runContainerCommand(["restart", id]).catch(() => {});
  });
}

export async function containerExists(id: string): Promise<boolean> {
  try {
    await runContainerCommand(["inspect", id]);
    return true;
  } catch {
    return false;
  }
}

async function getDevcontainerMtimeMs(wsUri: vscode.Uri): Promise<number | undefined> {
  try {
    const devContainerConfig = getDevcontainerConfig(wsUri);
    const st = await vscode.workspace.fs.stat(devContainerConfig);
    return st.mtimeMs;
  } catch {
    return undefined;
  }
}

async function getContainerCreatedMs(name: string): Promise<number | undefined> {
  const res = await runContainerCommandCapture([
    "container", "inspect",
    "-f",
    "{{.Created}}",
    name
  ]);
  if (res.code !== 0) return undefined;
  const iso = res.stdout.trim();
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

export async function shouldRebuildForDevcontainer(wsUri: vscode.Uri, name: string): Promise<boolean> {
  const dcMtime = await getDevcontainerMtimeMs(wsUri);
  const createdMs = await getContainerCreatedMs(name);
  return dcMtime !== undefined && createdMs !== undefined && dcMtime > createdMs;
}

export async function rebuildContainerDirect(wsUri: vscode.Uri, id: string | undefined, noCache?: boolean): Promise<string> {
  if (id) {
    getOutput().appendLine(`Ensuring container ${id} is stopped...`);
    getOutput().show(true);
    await runContainerCommand(["stop", id]);
    await runContainerCommand(["rm", "-f", id]);
  }
  getOutput().appendLine(`Starting container...`);
  getOutput().show(true);
  return await devcontainerUp(wsUri, noCache);
}
