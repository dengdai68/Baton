// The Mac's resident service as a launchd user agent (install, start, restart,
// remove) and the app's client for the daemon's private socket. The agent runs
// the app's own executable in Node mode, so it keeps the app's code identity
// (and the file-access permissions granted to Baton).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createConnection } from "node:net";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { realpathSync, statSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";

const run = promisify(execFile);
const xml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Canonical form of a configuration root: symlinks resolved, and a root that does not
 * exist yet resolved through its parent. The agent label and arguments derive from it,
 * so they are the same on the first launch and on later ones.
 */
export function canonicalPath(path) {
  try { return realpathSync(path); }
  catch { try { return join(realpathSync(dirname(path)), basename(path)); } catch { return path; } }
}

/** launchd label of the resident service: fixed for the standard instance, per root otherwise. */
export function daemonLabel(controlRoot, standard) {
  return "com.baton.daemon" + (standard ? "" : "." + createHash("sha256").update(canonicalPath(controlRoot)).digest("hex").slice(0, 10));
}

/**
 * Build identity of the installed app: version plus the executable's modification
 * time. Signing rewrites the executable, so it changes with every build, also when
 * local builds keep the same version number.
 */
export function buildIdentity(executable, version) {
  try { return `${version}+${Math.trunc(statSync(executable).mtimeMs)}`; } catch { return String(version); }
}

/** launchd property list: start at login, restart after a failure (not after a clean stop). */
// HOME is the home of the app that installed the agent, so an isolated instance
// (tests, a separate HOME) keeps its daemon, logs and defaults inside that home.
export function daemonPlist({ label, program, script, controlRoot, instance = "desktop", dev = false, bundleId = "com.baton.desktop", home = homedir() }) {
  const args = [program, script, "--control-root", controlRoot, "--instance", instance, "--login-agent", join(home,"Library","LaunchAgents",label+".plist"), ...(dev ? ["--dev"] : [])];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
  <key>EnvironmentVariables</key><dict><key>ELECTRON_RUN_AS_NODE</key><string>1</string><key>HOME</key><string>${xml(home)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>AssociatedBundleIdentifiers</key><array><string>${xml(bundleId)}</string></array>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>${xml(join(controlRoot, "daemon.err.log"))}</string>
</dict>
</plist>
`;
}

/** Manage one LaunchAgent; `launchctl` is injectable so tests never touch the real launchd. */
export function createDaemonService({ label, program, script, controlRoot, instance = "desktop", dev = false, uid = userInfo().uid, home = homedir(), launchctl = (args) => run("/bin/launchctl", args), pollMs = 250, unloadTimeoutMs = 30000 }) {
  const plistPath = join(home, "Library", "LaunchAgents", `${label}.plist`);
  const domain = `gui/${uid}`, target = `${domain}/${label}`;
  const loaded = async () => { try { await launchctl(["print", target]); return true; } catch { return false; } };
  const definition = () => daemonPlist({ label, program, script, controlRoot, instance, dev, home });
  // bootout returns while launchd is still stopping the job; bootstrapping the label
  // again (or reporting it removed) must wait until the job is really gone.
  const bootout = async () => {
    await launchctl(["bootout", target]).catch(() => {});
    const deadline = Date.now() + unloadTimeoutMs;
    while (await loaded()) {
      if (Date.now() > deadline) throw Object.assign(new Error("本机服务未退出"), { code: "DAEMON_STILL_LOADED" });
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  };
  const temporaryPlist = join(controlRoot, 'desktop-service.plist');
  const read = path => readFile(path,'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  async function writeDefinition(path) {
    const desired = definition();
    if (await read(path) === desired) return;
    await mkdir(dirname(path), {recursive:true, mode:0o700});
    const next = path + '.' + randomBytes(6).toString('hex');
    try { await writeFile(next, desired, {mode:0o600, flag:'wx'}); await rename(next,path); }
    finally { await unlink(next).catch(() => {}); }
  }
  async function setPersistence(persistent) {
    if (persistent) await writeDefinition(plistPath);
    else {
      await writeDefinition(temporaryPlist);
      await unlink(plistPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  const definitionChanged = async () => ((await read(plistPath)) ?? await read(temporaryPlist)) !== definition();
  return {
    label, plistPath, definitionChanged, setPersistence,
    async ensure(persistent = true) {
      const changed = await definitionChanged();
      if (changed && await loaded()) await bootout();
      await setPersistence(persistent);
      if (!await loaded()) await launchctl(["bootstrap",domain,persistent ? plistPath : temporaryPlist]);
      await launchctl(["kickstart",target]).catch(() => {});
      return {changed};
    },
    /** Restart the running service (e.g. to load new code after an app update). */
    async restart() { await launchctl(["kickstart", "-k", target]); },
    /** Stop and remove the agent (the app then owns the service again). */
    async remove() {
      await bootout();
      await unlink(plistPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
    },
    async installed() { return Boolean(await readFile(plistPath, "utf8").catch(() => null)); },
    async state() {
      try {
        const { stdout } = await launchctl(["print", target]);
        return { loaded: true, running: /\bstate = running\b/.test(stdout), pid: Number(/\bpid = (\d+)/.exec(stdout)?.[1]) || null };
      } catch { return { loaded: false, running: false, pid: null }; }
    },
  };
}

/** One request/response on the daemon socket (JSON lines). */
export function daemonRequest(socketPath, message, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const id = randomBytes(6).toString("hex");
    const socket = createConnection(socketPath);
    let buffer = "";
    const timer = setTimeout(() => { socket.destroy(); reject(Object.assign(new Error("本机服务无响应"), { code: "DAEMON_TIMEOUT" })); }, timeoutMs);
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(JSON.stringify({ ...message, id }) + "\n"));
    socket.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let value; try { value = JSON.parse(line); } catch { continue; }
        if (value.id !== id) continue;
        clearTimeout(timer); socket.end(); resolve(value); return;
      }
    });
    socket.once("error", (error) => { clearTimeout(timer); reject(Object.assign(new Error("无法连接本机服务"), { code: error.code || "DAEMON_UNAVAILABLE" })); });
  });
}

/** Stream daemon events (notifications, service state) until closed. */
export function daemonSubscribe(socketPath, onEvent, { onClose = () => {}, desktop = false } = {}) {
  const socket = createConnection(socketPath);
  let buffer = "", closed = false;
  socket.setEncoding("utf8");
  socket.once("connect", () => socket.write(JSON.stringify({ id: "subscribe", type: "subscribe", desktop }) + "\n"));
  socket.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      let value; try { value = JSON.parse(line); } catch { continue; }
      if (value.type) onEvent(value);
    }
  });
  socket.once("close", () => { if (!closed) onClose(); });
  socket.on("error", () => {});
  return { close() { closed = true; socket.destroy(); } };
}

/** Poll the daemon until it reports a ready service (or the deadline passes). */
export async function waitForDaemon(socketPath, { timeoutMs = 60000, intervalMs = 500, until = (status) => status.state === "ready" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try { last = await daemonRequest(socketPath, { type: "status" }, { timeoutMs: 2000 }); if (last.ok && until(last)) return last; }
    catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw Object.assign(new Error(last ? `本机服务未就绪（${last.state}）` : "本机服务未启动"), { code: "DAEMON_NOT_READY", status: last });
}
