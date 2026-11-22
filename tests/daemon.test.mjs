// Resident Mac service (apps/electron/daemon.mjs) and its launchd agent
// manager: isolated roots, a stand-in service speaking the real IPC protocol,
// and a fake launchctl (the real launchd is never touched).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../apps/electron/daemon.mjs";
import { buildIdentity, canonicalPath, createDaemonService, daemonLabel, daemonPlist, daemonRequest, daemonSubscribe } from "../apps/electron/daemon-service.mjs";

// Speaks the service side of the protocol: ready, idle readiness, notifications on request.
const standIn = `
process.send({ type: "baton-ready", port: 54321, instanceId: "instance-" + process.pid });
process.on("message", (message) => {
  if (message.type === "baton-update-prepare") process.send({ type: "baton-update-readiness", id: message.id, ready: process.env.STAND_IN_BUSY !== "1" });
});
setTimeout(() => process.send({ type: "baton-notification", notice: { type: "run.completed", title: "done" } }), Number(process.env.STAND_IN_NOTIFY_MS || 300));
if (process.env.STAND_IN_CRASH_MS) setTimeout(() => process.exit(3), Number(process.env.STAND_IN_CRASH_MS));
process.on("disconnect", () => process.exit(0));
setInterval(() => {}, 1 << 30);
`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "baton-daemon-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const control = join(root, "control"), entry = join(root, "stand-in.mjs");
  await mkdir(control, { recursive: true, mode: 0o700 });
  await writeFile(entry, standIn);
  const environment = { PATH: process.env.PATH, HOME: root };
  // home keeps every default location inside the fixture (never the real ~/.baton).
  const options = { controlRoot: control, home: root, packaged: false, instance: "desktop-dev", serverEntry: entry, shellEnvironment: environment, readyTimeoutMs: 15000 };
  return { root, control, entry, options };
}

test("the resident daemon runs the service, reports status, forwards notifications and holds the idle reservation", async (t) => {
  const { control, options } = await fixture(t);
  const daemon = await startDaemon(options);
  t.after(() => daemon.close());
  const socket = join(control, "daemon.sock");
  const mode = (await stat(socket)).mode & 0o777;
  const status = await daemonRequest(socket, { type: "status" });
  console.log("status", { state: status.state, origin: status.origin, bootstrapToken: status.bootstrapToken?.length, socketMode: mode.toString(8) });
  assert.equal(status.state, "ready");
  assert.equal(status.origin, "http://127.0.0.1:54321");
  assert.match(status.bootstrapToken, /^[a-f0-9]{64}$/, "the local app gets the first-run setup token");
  assert.equal(status.build, buildIdentity(process.execPath, status.version), "the app compares builds to restart an outdated daemon");
  assert.equal(mode, 0o600, "only this user can talk to the daemon");
  const endpoint = JSON.parse(await readFile(join(control, "desktop-endpoint.json"), "utf8"));
  assert.deepEqual(endpoint, { origin: status.origin, instanceId: status.instanceId }, "CLI and app find the service where they always did");
  assert.equal((await stat(join(control, "desktop-endpoint.json"))).mode & 0o777, 0o600);
  const notices = [];
  const subscription = daemonSubscribe(socket, (event) => { if (event.type === "notification") notices.push(event.notice); });
  await new Promise((resolve) => setTimeout(resolve, 600));
  subscription.close();
  console.log("notifications", notices);
  assert.deepEqual(notices, [{ type: "run.completed", title: "done" }]);
  const lease = await daemonRequest(socket, { type: "update-prepare" });
  console.log("update-prepare", lease);
  assert.equal(lease.ok, true);
  assert.equal((await daemonRequest(socket, { type: "update-release", lease: lease.lease })).ok, true);
  await assert.rejects(startDaemon(options), (error) => error.code === "DAEMON_RUNNING", "one daemon per configuration root");
});

test("a busy service refuses the reservation; an unreachable data disk never starts an empty instance", async (t) => {
  const { root, control, options } = await fixture(t);
  process.env.STAND_IN_BUSY = "1";
  t.after(() => { delete process.env.STAND_IN_BUSY; });
  const daemon = await startDaemon({ ...options, shellEnvironment: { ...options.shellEnvironment, STAND_IN_BUSY: "1" } });
  const busy = await daemonRequest(join(control, "daemon.sock"), { type: "update-prepare" });
  console.log("busy reservation", busy);
  assert.equal(busy.ok, false);
  assert.equal(busy.busy, true);
  await daemon.close();
  assert.equal(existsSync(join(control, "daemon.sock")), false, "the socket goes away with the daemon");
  await writeFile(join(control, "storage.json"), JSON.stringify({ version: 1, workspaceRoot: join(root, "unplugged-disk", "Baton"), previousRuntimeRoots: [] }), { mode: 0o600 });
  await assert.rejects(startDaemon(options), (error) => { console.log("missing data root:", error.code, error.message); return error.code === "DATA_ROOT_MISSING"; });
});

test("an unexpected service exit is reported so launchd can restart the daemon", async (t) => {
  const { options } = await fixture(t);
  let lost = null;
  const daemon = await startDaemon({ ...options, shellEnvironment: { ...options.shellEnvironment, STAND_IN_CRASH_MS: "200" }, onServiceLost: (exit) => { lost = exit; } });
  t.after(() => daemon.close());
  for (let wait = 0; wait < 40 && !lost; wait += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  console.log("service lost", lost, "state", daemon.status().state);
  assert.deepEqual(lost, { code: 3, signal: null });
  assert.equal(daemon.status().state, "stopped");
});

test("launchd agent: escaped definition; installed once; reloaded only when the definition changes; removable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "baton-agent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plist = daemonPlist({ label: "com.baton.test", program: "/Applications/Baton & Co.app/Contents/MacOS/Baton", script: "/x/daemon.mjs", controlRoot: "/Users/u/.baton", instance: "desktop", home: "/Users/u" });
  assert.match(plist, /Baton &amp; Co\.app/);
  for (const part of ["<key>RunAtLoad</key><true/>", "<key>SuccessfulExit</key><false/>", "<key>ELECTRON_RUN_AS_NODE</key><string>1</string>", "<key>HOME</key><string>/Users/u</string>", "com.baton.desktop"]) assert.ok(plist.includes(part), part);
  const calls = [];
  // Like launchd: bootout returns at once while the job lingers (SIGTERMed) for a few
  // polls; bootstrapping a label that is still loaded fails.
  let loaded = false, lingering = 0;
  const launchctl = async (args) => {
    calls.push(args.join(" "));
    if (args[0] === "print") {
      if (lingering > 0) { lingering -= 1; if (lingering === 0) loaded = false; return { stdout: "state = SIGTERMed\n" }; }
      if (!loaded) throw new Error("not loaded");
      return { stdout: "state = running\npid = 4242\n" };
    }
    if (args[0] === "bootstrap") { if (loaded) throw new Error("Bootstrap failed: 5: Input/output error"); loaded = true; }
    if (args[0] === "bootout") { if (!loaded) throw new Error("Boot-out failed: 3: No such process"); lingering = 3; }
    return { stdout: "" };
  };
  const service = (program) => createDaemonService({ label: "com.baton.test", program, script: "/x/daemon.mjs", controlRoot:join(root,"control"), uid: 501, home: root, launchctl, pollMs: 5 });
  assert.equal(await service("/Applications/Baton.app/Contents/MacOS/Baton").definitionChanged(), true, "not installed yet");
  assert.deepEqual(await service("/Applications/Baton.app/Contents/MacOS/Baton").ensure(), { changed: true });
  assert.equal(await service("/Applications/Baton.app/Contents/MacOS/Baton").definitionChanged(), false);
  assert.equal(await service("/Applications/Moved/Baton.app/Contents/MacOS/Baton").definitionChanged(), true, "the app checks this before replacing a running agent (only when idle)");
  console.log("first ensure:", calls.splice(0));
  assert.deepEqual(await service("/Applications/Baton.app/Contents/MacOS/Baton").ensure(), { changed: false });
  const unchanged = calls.splice(0);
  console.log("unchanged ensure:", unchanged);
  assert.ok(!unchanged.some((call) => call.startsWith("bootout") || call.startsWith("bootstrap")), "a running unchanged agent is never interrupted");
  const same = service("/Applications/Baton.app/Contents/MacOS/Baton");
  await same.setPersistence(false);
  assert.equal(await same.installed(), false);
  assert.equal(await same.definitionChanged(), false);
  assert.equal((await same.state()).pid, 4242);
  await same.setPersistence(true);
  assert.equal(await same.installed(), true);
  assert.ok(calls.splice(0).every(command => command.startsWith("print ")), "switching must keep the running server and its connections");
  await service("/Applications/Moved/Baton.app/Contents/MacOS/Baton").ensure();
  const moved = calls.splice(0);
  console.log("moved app ensure:", moved);
  assert.ok(moved.some((call) => call.startsWith("bootout")) && moved.some((call) => call.startsWith("bootstrap")), "a moved app reloads its agent");
  assert.deepEqual(await service("/Applications/Moved/Baton.app/Contents/MacOS/Baton").state(), { loaded: true, running: true, pid: 4242 }, "the reloaded agent runs (bootout is asynchronous)");
  await service("/x").remove();
  console.log("after remove:", JSON.stringify(await service("/x").state()));
  assert.deepEqual(await service("/x").state(), { loaded: false, running: false, pid: null }, "remove returns once the job is gone");
  assert.equal(existsSync(join(root, "Library", "LaunchAgents", "com.baton.test.plist")), false);
});

test("build identity changes with every build of the same version and falls back to the version", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "baton-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, "Baton");
  await writeFile(executable, "binary");
  await utimes(executable, new Date("2026-11-20T10:00:00Z"), new Date("2026-11-20T10:00:00Z"));
  const first = buildIdentity(executable, "0.1.11-beta.3");
  await utimes(executable, new Date("2026-11-22T10:00:00Z"), new Date("2026-11-22T10:00:00Z"));
  const rebuilt = buildIdentity(executable, "0.1.11-beta.3");
  console.log("builds:", first, "→", rebuilt, "| missing executable →", buildIdentity(join(root, "gone"), "0.1.11-beta.3"));
  assert.notEqual(first, rebuilt, "a rebuilt app at the same version is a different build");
  assert.match(first, /^0\.1\.11-beta\.3\+\d+$/);
  assert.equal(buildIdentity(join(root, "gone"), "0.1.11-beta.3"), "0.1.11-beta.3");
});

test("the agent label is the same before and after the root exists, also through symlinks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "baton-label-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "real-home"));
  await symlink(join(root, "real-home"), join(root, "home-link"));
  const viaLink = join(root, "home-link", ".baton");
  const before = daemonLabel(viaLink, false);                 // first launch: the root does not exist yet
  await mkdir(join(root, "real-home", ".baton"));
  const after = daemonLabel(viaLink, false);                  // later launches: it exists
  const resolved = daemonLabel(canonicalPath(viaLink), false); // the app realpaths an existing root
  console.log("labels:", { before, after, resolved, canonical: canonicalPath(viaLink) });
  assert.equal(before, after);
  assert.equal(after, resolved);
  assert.equal(daemonLabel(viaLink, true), "com.baton.daemon", "the standard instance keeps the fixed label");
  assert.equal(canonicalPath(join(root, "missing", "deeper")), join(root, "missing", "deeper"), "unresolvable paths stay as given");
});
