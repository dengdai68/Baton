// Resident Baton service (the Mac's local daemon). launchd runs it as a user
// LaunchAgent; it owns the business service exactly as the desktop app does in
// owned mode (same environment, storage and IPC protocol, desktop semantics),
// so the service keeps running when the app quits and the phone can still
// connect. The Mac app talks to it over a private Unix socket in the
// configuration root (0600, same user only): status, notifications and the
// update/idle reservation. Data-directory moves are carried out here.
import { fork } from "node:child_process";
import { createServer, createConnection } from "node:net";
import { readFileSync } from "node:fs";
import { lstat, mkdir, rename, unlink, writeFile, chmod } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { readStorageLocation, writeStorageLocation } from "../../server/storage-layout.mjs";
import { diagnostic, installProcessDiagnostics } from "../../server/diagnostics.mjs";
import { desktopControlPlaneEnvironment, desktopStoragePaths, defaultDesktopLocation } from "./runtime-paths.mjs";
import { loadLoginShellEnvironment } from "./login-shell-env.mjs";
import { relocateStorage } from "./storage-relocation.mjs";
import { buildIdentity } from "./daemon-service.mjs";

export const daemonSocketName = "daemon.sock";
const maxLine = 65536;
const version = (() => { try { return JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version; } catch { return "unknown"; } })();
// Fixed at start: after the app is replaced the app sees a different build and restarts the daemon.
const build = buildIdentity(process.execPath, version);

/** Whether a daemon already answers on this socket (single instance per configuration root). */
export function socketAnswers(socketPath, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function writePrivate(path, value) {
  const existing = await lstat(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error("连接信息文件不是常规文件");
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}

/**
 * Run the resident service for one configuration root. Returns { close, status }.
 * `serverEntry` and `shellEnvironment` are injectable for tests; launchd uses the defaults.
 */
export async function startDaemon({
  controlRoot, instance = "desktop", packaged = true, home = homedir(),
  serverEntry = fileURLToPath(new URL("../../server/index.mjs", import.meta.url)),
  execPath = process.execPath, shellEnvironment = null, readyTimeoutMs = 300000,
  /** Called when the service exits on its own; launchd then restarts the whole daemon. */
  onServiceLost = () => {},
  stopWithDesktop = async () => false,
}) {
  const socketPath = join(controlRoot, daemonSocketName), endpointFile = join(controlRoot, "desktop-endpoint.json");
  if (await socketAnswers(socketPath)) throw Object.assign(new Error("本机服务已在运行"), { code: "DAEMON_RUNNING" });
  await mkdir(controlRoot, { recursive: true, mode: 0o700 });
  await unlink(socketPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
  const location = await readStorageLocation(controlRoot, defaultDesktopLocation({ home, packaged }));
  let storage = desktopStoragePaths(controlRoot, { home, controlRoot, instance, workspaceRoot: location.workspaceRoot, previousRuntimeRoots: location.previousRuntimeRoots });
  // Same protection as the app: a saved locator whose data root is unreachable
  // (a disconnected data disk) must never start an empty instance.
  const savedLocator = await lstat(join(controlRoot, "storage.json")).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
  if (savedLocator && !(await lstat(storage.dataRoot).catch(() => null))?.isDirectory())
    throw Object.assign(new Error("配置的数据盘或实例目录不可访问，未启动本机服务"), { code: "DATA_ROOT_MISSING" });
  await mkdir(storage.dataRoot, { recursive: true, mode: 0o700 });
  await writeStorageLocation(controlRoot, location);
  const environment = shellEnvironment || await loadLoginShellEnvironment({ onDiagnostic: (fields) => diagnostic("daemon.shell_environment", fields) });

  let child = null, origin = null, instanceId = null, bootstrapToken = null, startedAt = null, relocating = false, stopping = false;
  const subscribers = new Set();
  const desktops = new Set();
  const pendingLeases = new Map();
  const broadcast = (event) => { const line = JSON.stringify(event) + "\n"; for (const socket of subscribers) socket.write(line); };

  async function startService() {
    bootstrapToken = randomBytes(32).toString("hex");
    const env = { ...desktopControlPlaneEnvironment({ environment, storage, electronExecutable: execPath, bootstrapToken }), ELECTRON_RUN_AS_NODE: "1", BATON_AUTO_WORKSPACE:packaged && instance === "desktop" ? "1" : "0" };
    const owned = fork(serverEntry, [], { cwd: controlRoot, env, execPath, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    child = owned; origin = null; instanceId = null;
    for (const stream of ["stdout", "stderr"]) createInterface({ input: owned[stream] }).on("line", (text) => diagnostic(`daemon.server_${stream}`, { text, childPid: owned.pid }));
    owned.on("message", (message) => {
      if (owned !== child) return;
      if (message?.type === "baton-notification") broadcast({ type: "notification", notice: message.notice });
      else if (message?.type === "baton-storage-restart" && typeof message.workspaceRoot === "string") void relocate(owned, message);
      else if (message?.type === "baton-update-readiness") pendingLeases.get(message.id)?.(message);
    });
    owned.once("exit", (code, signal) => {
      diagnostic("daemon.service_exit", { code, signal });
      if (owned !== child) return;
      child = null; origin = null;
      broadcast({ type: "service", state: "stopped" });
      if (!stopping && !relocating) onServiceLost({ code, signal });
    });
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("本机服务启动超时")), readyTimeoutMs);
      const onMessage = (message) => { if (message?.type === "baton-ready") finish(null, message); };
      const onExit = () => finish(new Error("本机服务启动失败"));
      const finish = (error, message) => { clearTimeout(timer); owned.off("message", onMessage); owned.off("exit", onExit); error ? reject(error) : resolve(message); };
      owned.on("message", onMessage); owned.once("exit", onExit);
    }).catch((error) => { owned.kill(); throw error; });
    if (!Number.isInteger(ready.port) || typeof ready.instanceId !== "string") { owned.kill(); throw new Error("本机服务返回了无效连接信息"); }
    origin = `http://127.0.0.1:${ready.port}`; instanceId = ready.instanceId; startedAt = new Date().toISOString();
    await writePrivate(endpointFile, { origin, instanceId });
    diagnostic("daemon.service_ready", { origin, servicePid: owned.pid });
    broadcast({ type: "service", state: "ready", origin, instanceId });
  }

  const stopChild = (owned, ms = 15000) => new Promise((resolve, reject) => {
    if (!owned || owned.exitCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error("本机服务未退出")), ms);
    owned.once("exit", () => { clearTimeout(timer); resolve(); });
    owned.kill();
  });

  /** Same steps as the app's changeStorageRoot: stop, move, restart; on failure keep the original location. */
  async function relocate(owned, message) {
    if (relocating) return;
    relocating = true; broadcast({ type: "service", state: "relocating" });
    const previous = storage; let moved;
    try {
      await stopChild(owned);
      moved = await relocateStorage({ sourceRoot: previous.dataRoot, controlRoot, workspaceRoot: message.workspaceRoot, instance, previousRuntimeRoots: JSON.parse(previous.BATON_RUNTIME_PREVIOUS_ROOTS), onProgress: (entry) => diagnostic("daemon.storage_copy", { entry }) });
      storage = desktopStoragePaths(controlRoot, { home, controlRoot, instance, workspaceRoot: moved.location.workspaceRoot, previousRuntimeRoots: moved.location.previousRuntimeRoots });
      await startService();
      await moved.cleanup().catch((error) => diagnostic("daemon.storage_source_cleanup_failed", { error }));
    } catch (error) {
      diagnostic("daemon.storage_move_failed", { error });
      if (moved && child) await stopChild(child, 5000).catch(() => {});
      if (moved) { await writeStorageLocation(controlRoot, { version: 1, workspaceRoot: previous.BATON_WORKSPACE_ROOT, previousRuntimeRoots: JSON.parse(previous.BATON_RUNTIME_PREVIOUS_ROOTS) }); storage = previous; }
      if (!child) await startService().catch((restartError) => diagnostic("daemon.restart_failed", { error: restartError }));
      else if (child.connected) child.send({ type: "baton-update-release", id: message.id }, () => {});
    } finally { relocating = false; }
  }

  /** Ask the service whether it is idle and hold writes (the app's update/restart reservation). */
  function prepare() {
    const owned = child;
    if (!owned?.connected) return Promise.resolve({ ok: false, error: "无法确认当前执行状态" });
    const lease = randomBytes(18).toString("hex");
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pendingLeases.delete(lease); if (owned.connected) owned.send({ type: "baton-update-release", id: lease }, () => {}); resolve({ ok: false, error: "无法确认后台已空闲" }); }, 5000);
      pendingLeases.set(lease, (message) => { clearTimeout(timer); pendingLeases.delete(lease); resolve(message.ready === true ? { ok: true, lease } : { ok: false, busy: true, error: "仍有任务、沟通或保存操作正在执行" }); });
      owned.send({ type: "baton-update-prepare", id: lease }, (error) => { if (error) { clearTimeout(timer); pendingLeases.delete(lease); resolve({ ok: false, error: "后台连接已断开" }); } });
    });
  }

  const status = () => ({
    state: relocating ? "relocating" : child ? (origin ? "ready" : "starting") : "stopped",
    origin, instanceId, bootstrapToken, pid: process.pid, servicePid: child?.pid ?? null, startedAt, version, build,
  });

  async function handle(socket, request) {
    const reply = (value) => socket.write(JSON.stringify({ id: request.id, ...value }) + "\n");
    if (request.type === "status") return reply({ ok: true, ...status() });
    if (request.type === "subscribe") {
      subscribers.add(socket);
      if (request.desktop === true) desktops.add(socket);
      socket.once("close", async () => {
        subscribers.delete(socket);
        if (desktops.delete(socket) && !desktops.size && !stopping && await stopWithDesktop() && !desktops.size) void close();
      });
      return reply({ok:true});
    }
    if (request.type === "update-prepare") return reply(await prepare());
    if (request.type === "update-release") { if (typeof request.lease === "string" && child?.connected) child.send({ type: "baton-update-release", id: request.lease }, () => {}); return reply({ ok: true }); }
    if (request.type === "shutdown") { reply({ ok: true }); setImmediate(() => void close()); return; }
    reply({ ok: false, error: "未知请求" });
  }

  const server = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > maxLine) { socket.destroy(); return; }
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let request; try { request = JSON.parse(line); } catch { socket.destroy(); return; }
        void handle(socket, request && typeof request === "object" ? request : {}).catch((error) => diagnostic("daemon.request_failed", { error }));
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);

  async function close() {
    if (stopping) return;
    stopping = true;
    for (const socket of subscribers) socket.destroy();
    await new Promise((resolve) => server.close(() => resolve()));
    await stopChild(child).catch(() => child?.kill("SIGKILL"));
    await unlink(socketPath).catch(() => {});
  }

  await startService();
  const unattended = setTimeout(async () => {
    if (!stopping && !desktops.size && await stopWithDesktop() && !desktops.size) void close();
  }, 60000);
  unattended.unref();
  return { close, status, socketPath };
}

/** launchd entry: `daemon.mjs --control-root DIR --instance desktop [--dev]`. */
async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2), value = (name) => { const index = args.indexOf("--" + name); return index >= 0 ? args[index + 1] : undefined; };
  const controlRoot = value("control-root");
  if (!controlRoot) { console.error("usage: daemon.mjs --control-root DIR [--instance desktop] [--dev]"); process.exit(64); }
  installProcessDiagnostics("daemon", { instancePath: join(controlRoot, "auth.sqlite") });
  let daemon;
  // An unexpected service exit ends the daemon with a failure; launchd (KeepAlive) starts it again.
  const onServiceLost = () => { void daemon?.close().finally(() => process.exit(1)); };
  const stopWithDesktop = async () => {
    const file = value('login-agent');
    return file ? !(await lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; })) : false;
  };
  try { daemon = await startDaemon({ controlRoot, stopWithDesktop, instance: value("instance") || "desktop", packaged: !args.includes("--dev"), onServiceLost }); }
  catch (error) {
    diagnostic("daemon.start_failed", { error });
    // Another daemon already owns this root: stop quietly (launchd treats exit 0 as done).
    process.exit(error.code === "DAEMON_RUNNING" ? 0 : 1);
  }
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { void daemon.close().finally(() => process.exit(0)); });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
