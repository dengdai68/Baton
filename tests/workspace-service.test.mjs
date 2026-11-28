import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import https from "node:https";
import { createStore } from "../server/store.mjs";
import { provisionWorkspace } from "../server/workspace-config.mjs";
import { workspaceIdentity } from "../server/workspace-identity.mjs";
import {createAuth} from "../server/auth.mjs";
const credentials = {name:"operator",password:"workspace test password"};
import { clientAddress, startWorkspace } from "../server/workspace-http.mjs";

async function setup(t, mode, { api, isReady, protocol = "https:", trustedProxyAddresses = ["127.0.0.1"] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "baton-workspace-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const key = join(root, "key"),
    cert = join(root, "cert");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  const origin = protocol + "//localhost",
    config = { mode, name: "Test", origin, key, cert, port: 0, trustedProxyAddresses };
  const store = createStore({
    databasePath: join(root, "business.sqlite"),
    workspaceRoot: root,
    configurationDirectory: root,
  });
  const administrator = createAuth({databasePath:join(root,'auth.sqlite')});
  if(mode === 'local') await administrator.setAdministrator(credentials.name,credentials.password);
  const identity = workspaceIdentity(root, mode,administrator);
  const server = await startWorkspace({
    root,
    config, administrator, isReady,
    ensureBusiness: async () => store,
    canWrite: () => true,
    execute: () => {},
    wake: () => {},
    api,
    readJson: async (req) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      return JSON.parse(Buffer.concat(chunks));
    },
    sendJson: (res, status, data) => {
      res.writeHead(status);
      res.end(JSON.stringify(data));
    },
  });
  t.after(async () => {
    await new Promise((ok) => server.close(ok));
    identity.close(); administrator.close();
    store.close();
  });
  // extra.method overrides the verb; a null header value removes that header
  // (a native client sends no Origin); Buffer bodies are sent as raw bytes.
  const request = (path, body, cookie = "", extra = {}) =>
    new Promise((resolve, reject) => {
      const { method, ...overrides } = extra;
      const headers = {
        host: "localhost",
        origin,
        "content-type": "application/json",
        cookie,
        ...overrides,
      };
      for (const [key, value] of Object.entries(headers))
        if (value == null) delete headers[key];
      const req = (protocol === "https:" ? https : http).request(
        {
          host: "127.0.0.1",
          port: server.address().port,
          servername: "localhost",
          ca: readFileSync(cert),
          method: method || (body ? "POST" : "GET"),
          path,
          headers,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString();
            let parsed;
            try {
              parsed = JSON.parse(text);
            } catch {
              reject(new Error(`${headers.method || method || "?"} ${path} → ${res.statusCode} non-JSON body: ${JSON.stringify(text.slice(0, 120))}`));
              return;
            }
            resolve({
              s: res.statusCode,
              b: parsed,
              h: res.headers,
              cookie: res.headers["set-cookie"]?.[0].split(";")[0],
            });
          });
        },
      );
      req.on("error", reject);
      req.end(
        Buffer.isBuffer(body) ? body : body ? JSON.stringify(body) : undefined,
      );
    });
  return { config, store, identity, administrator, request, root, port: server.address().port };
}
test("explicit HTTP workspace supports mobile and desktop login with same-origin logout", async t => {
  const {request} = await setup(t, "local", {protocol:"http:"});
  assert.equal((await request("/healthz")).b.status, "ready");
  const desktop = await request("/login", {...credentials, device:"Mac"});
  assert.equal(desktop.s, 200);
  assert.match(desktop.h["set-cookie"][0], /HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(desktop.h["set-cookie"][0], /Secure|__Host-/);
  const mobile = await request("/login", {...credentials, bearer:true, device:"iPhone"});
  assert.equal((await request("/device-info", null, "", {authorization:"Bearer "+mobile.b.token})).s, 200);
  const info = await request("/device-info", null, desktop.cookie);
  assert.equal(info.b.origin, "http://localhost");
  assert.ok(info.b.devices.some(d => d.label === "iPhone" && d.lastAddress === "127.0.0.1"));
  assert.equal((await request("/logout", {}, desktop.cookie, {origin:"http://elsewhere"})).s, 403);
  assert.equal((await request("/logout", {}, desktop.cookie)).s, 200);
  assert.equal((await request("/device-info", null, desktop.cookie)).s, 401);
});
test("public HTTPS login and writes use the registered public origin behind an HTTP listener", async t => {
  const api = (_req, res) => { res.writeHead(200); res.end('{"ok":true}'); };
  const {config, request} = await setup(t, "local", {protocol:"http:", api});
  config.accessOrigin = "https://baton.example";
  const external = {host:"baton.example", origin:config.accessOrigin};
  const login = await request("/login", credentials, "", external);
  assert.equal(login.s, 200);
  assert.match(login.h["set-cookie"][0], /^__Host-baton_workspace=.*; Secure;/);
  assert.ok(login.h["strict-transport-security"]);
  const info = await request("/device-info", undefined, login.cookie, external);
  assert.equal(info.b.origin, config.accessOrigin);
  assert.equal((await request("/api/tasks", {}, login.cookie, external)).s, 200);
  assert.equal((await request("/api/tasks", {}, login.cookie, {...external, origin:config.origin})).s, 403);
  const logout = await request("/logout", {}, login.cookie, external);
  assert.equal(logout.s, 200);
  assert.match(logout.h["set-cookie"][0], /^__Host-baton_workspace=; Secure;/);
  assert.equal((await request("/healthz", undefined, "", {host:"other.example"})).s, 403);
  assert.equal((await request("/login", credentials, "", {...external, host:"localhost", "x-forwarded-proto":"https"})).s, 403);
});
test("the sign-in selector can distinguish a ready workspace from an unavailable service before login", async t => {
  let ready = true;
  const {request} = await setup(t, "local", {isReady: () => ready});
  for (const state of [true,false,true]) {
    ready = state;
    const result = await request("/healthz");
    assert.equal(result.s, state ? 200 : 503);
    assert.deepEqual(result.b, {service:"baton-workspace",status:state ? "ready" : "unavailable"});
    assert.equal(result.cookie, undefined);
  }
});
test("cloud: separate private chats, grants, actionable inbox, atomic acceptance and automation inheritance", async (t) => {
  const { identity, store, request } = await setup(t, "cloud");
  const cookies = {};
  for (const name of ["Alice", "Bao", "Chen"]) {
    await identity.add(name, "password for " + name);
    cookies[name] = (
      await request("/login", { name, password: "password for " + name })
    ).cookie;
  }
  const [owner, other, reader] = identity.members();
  const call = (name, path, body) => request(path, body, cookies[name]);
  const agent = store.createAgent({ name: "项目编辑" }),
    input = {
      title: "周报",
      objective: "整理交付",
      managerAgentId: agent.id,
      memberAgentIds: [agent.id],
    };
  const creation = { ...input, clientRequestId: "create-task-receipt" };
  const task = (await call("Alice", "/tasks", creation)).b;
  assert.equal((await call("Alice", "/tasks", creation)).b.id, task.id);
  assert.equal(
    (await call("Alice", "/tasks", { ...creation, title: "不同任务" })).s,
    400,
  );
  assert.ok(task.id);
  const path = "/tasks/" + task.id;
  assert.equal((await call("Bao", path)).s, 403);
  const grants = {
    ownerId: owner.id,
    grants: { [other.id]: "operate", [reader.id]: "view" },
  };
  assert.equal((await call("Alice", path + "/share", grants)).s, 200);
  assert.equal((await call("Chen", path + "/start", {})).s, 403);
  const run = store.createRun(task.id);
  store.initializeDispatches(run.id);
  store.completeDispatch(store.claimDispatch(run.id).id);
  store.requestHumanAcceptance(run.id);
  assert.equal((await call("Bao", "/workspace")).b.inbox.length, 1);
  assert.equal((await call("Chen", "/workspace")).b.inbox.length, 0);
  const accepted = await Promise.all(
    ["Bao", "Alice"].map((n) => call(n, path + "/confirm", { runId: run.id })),
  );
  assert.equal(accepted.filter((r) => r.s === 200).length, 1);
  assert.equal(
    store.getRun(run.id).confirmedBy,
    accepted[0].s === 200 ? other.id : owner.id,
  );
  assert.equal((await call("Alice", "/workspace")).b.inbox.length, 0);
  const chatInput = { kind: "agent", targetId: agent.id },
    chatA = (await call("Alice", "/chats", chatInput)).b.id,
    chatB = (await call("Bao", "/chats", chatInput)).b.id;
  assert.notEqual(chatA, chatB);
  assert.equal((await call("Alice", "/chats/" + chatB)).s, 403);
  const message = {
    content: "发给编辑",
    clientRequestId: "message-retry-01234",
  };
  const first = await call("Alice", "/chats/" + chatA + "/messages", message),
    second = await call("Alice", "/chats/" + chatA + "/messages", message);
  assert.equal(first.b.sender.id, owner.id);
  assert.equal(first.b.id, second.b.id);
  const auto = (
    await call("Alice", "/automations", {
      ...input,
      enabled: false,
      cron: "0 9 * * *",
    })
  ).b.id;
  assert.ok(auto);
  await call("Alice", "/automations/" + auto + "/share", grants);
  const trigger = (await call("Bao", "/automations/" + auto + "/trigger", {}))
    .b;
  assert.ok(trigger.taskId, JSON.stringify(trigger));
  await call("Alice", "/automations/" + auto + "/share", {
    ownerId: owner.id,
    grants: {},
  });
  assert.equal((await call("Bao", "/tasks/" + trigger.taskId)).s, 403);
  assert.equal(
    (await request("/api/bootstrap", undefined, cookies.Bao)).s,
    404,
  );
});
test("local workspace uses administrator credentials and revocable device sessions", async (t) => {
  const { identity, request } = await setup(t, "local");
  const answer = await request("/login", credentials);
  assert.equal(answer.s, 200);
  assert.equal((await request("/pair", { code:"obsolete" })).s, 404);
  assert.equal(
    (await request("/workspace", undefined, answer.cookie)).b.user.id,
    "human_operator",
  );
  assert.equal(
    (await request("/login", { name: "foo", password: "password" })).s,
    401,
  );
  assert.equal(
    (
      await request("/tasks", {}, answer.cookie, {
        origin: "https://invalid.example",
      })
    ).s,
    403,
  );
  identity.revoke(identity.devices()[0].id);
  assert.equal((await request("/workspace", undefined, answer.cookie)).s, 401);
});
test("local gateway forwards allowed desktop API routes for an explicit device token", async (t) => {
  const calls = [];
  let lastContext;
  const api = async (req, res, url, context) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    lastContext = context;
    calls.push({ method: req.method, path: url.pathname + url.search, body: Buffer.concat(chunks).toString(), live: context.sessionValid() });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ forwarded: url.pathname }));
  };
  const { identity, request } = await setup(t, "local", { api });
  const native = { origin: null };
  // Native pairing: token in the body, no cookie, no Origin required.
  const paired = await request("/login", { ...credentials, bearer: true, device: "iPhone\u0007 Kai" }, "", native);
  console.log("native pairing", paired.s, Object.keys(paired.b), "cookie:", paired.cookie ?? "none");
  assert.equal(paired.s, 200);
  assert.match(paired.b.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(paired.cookie, undefined, "native pairing must not plant a cookie");
  assert.equal(identity.devices()[0].label, "iPhone Kai", "device label is printable and trimmed");
  const bearer = { ...native, authorization: "Bearer " + paired.b.token };
  const call = (path, body, extra = {}) => request(path, body, "", { ...bearer, ...extra });
  // Reads and every write verb reach the desktop API unchanged.
  assert.deepEqual((await call("/api/tasks?status=all")).b, { forwarded: "/api/tasks" });
  assert.equal((await call("/api/tasks", { title: "手机任务" })).s, 200);
  assert.equal(calls.at(-1).body, JSON.stringify({ title: "手机任务" }), "the JSON body is forwarded unread");
  // Node's client sends DELETE bodies without framing unless Content-Length is explicit.
  assert.equal((await call("/api/tasks/task_x", {}, { method: "DELETE", "content-length": "2" })).s, 200);
  assert.equal((await call("/api/tasks/task_y", undefined, { method: "DELETE" })).s, 200, "DELETE without body");
  assert.equal((await call("/api/settings/workspace")).s, 200, "storage location stays readable");
  const upload = await call("/api/runs/run_abc/attachments?name=a.png", Buffer.from([1, 2, 3]), { "content-type": "application/octet-stream" });
  assert.equal(upload.s, 200, "binary attachment upload is forwarded");
  assert.equal(calls.at(-1).body.length, 3);
  assert.equal((await call("/api/tasks", Buffer.from("x"), { "content-type": "text/plain" })).s, 403, "other bodies need JSON");
  assert.ok(calls.every((entry) => entry.live), "forwarded requests carry a live device session");
  console.log("forwarded", calls.map((entry) => entry.method + " " + entry.path));
  // Host maintenance, desktop login and pairing stay on the Mac; unknown routes are denied.
  for (const [path, method] of [["/api/settings/reset", "POST"], ["/api/settings/workspace", "PUT"], ["/api/auth/login", "POST"], ["/api/phone/devices", "GET"], ["/api/unknown", "GET"]]) {
    const denied = await call(path, method === "GET" ? undefined : {}, { method });
    console.log("denied", method, path, denied.s, denied.b.error);
    assert.equal(denied.s, 403, method + " " + path);
  }
  assert.equal(calls.length, 6, "denied routes never reach the desktop API");
  assert.equal((await request("/api/tasks", undefined, "", native)).s, 401, "no credentials");
  assert.equal((await request("/api/tasks", undefined, "", { ...native, authorization: "Bearer short" })).s, 401, "malformed token");
  // Browser cookies are ambient: writes need the workspace Origin.
  const browser = (await request("/login", { ...credentials })).cookie;
  assert.equal((await request("/api/tasks", {}, browser, native)).s, 403, "cookie write without Origin");
  assert.equal((await request("/api/tasks", {}, browser)).s, 200, "same-origin cookie write");
  // Revoking the device ends forwarded streams and later requests.
  identity.revoke(identity.devices().find((device) => device.label === "iPhone Kai").id);
  assert.equal(lastContext.sessionValid(), true, "the browser device stays valid");
  assert.equal((await call("/api/tasks")).s, 401, "revoked token");
  console.log("revoked device rejected; calls", calls.length);
});
test("native account login ends with logout", async (t) => {
  const { identity, request } = await setup(t, "local", { api: async (req, res) => { res.writeHead(200); res.end("{}"); } });
  const native = { origin: null };
  const { token } = (await request("/login", { ...credentials, bearer: true }, "", native)).b;
  const bearer = { ...native, authorization: "Bearer " + token };
  assert.equal((await request("/workspace", undefined, "", bearer)).b.user.id, "human_operator", "legacy endpoints accept the token");
  assert.equal(identity.devices()[0].label, "iPhone", "default device label");
  assert.equal((await request("/logout", {}, "", bearer)).s, 200);
  assert.equal((await request("/api/tasks", undefined, "", bearer)).s, 401, "logout revokes the token");
  console.log("token logout verified");
});

test("desktop readiness does not wait for business data when phone connection is enabled", () => {
  // The desktop host kills a service that has not reported "baton-ready" within 30 s;
  // a large or networked business database can take longer to open.
  const source = readFileSync(new URL("../server/index.mjs", import.meta.url), "utf8");
  const start = source.indexOf("server.listen(port, host");
  const beforeReady = source.slice(start, source.indexOf('process.send({ type: "baton-ready"', start));
  const awaited = [...beforeReady.matchAll(/^.*await ensureBusiness\(\).*$/gm)].map((match) => match[0].trim());
  console.log("business waits before baton-ready:", awaited);
  assert.deepEqual(awaited, ["if(daemon) await ensureBusiness();"], "only the standalone daemon waits for business data");
  assert.equal(beforeReady.match(/ensureBusiness\(\)/g).length, 1, "the desktop opens business data on its first API request, not during the host handshake");
});

test("security: phones read configuration but cannot change it; a desktop pairing can", async (t) => {
  const calls = [];
  const api = async (req, res, url) => { for await (const _ of req); calls.push(req.method + " " + url.pathname); res.writeHead(200); res.end("{}"); };
  const { identity, request } = await setup(t, "local", { api });
  const native = { origin: null };
  const phone = (await request("/login", { ...credentials, bearer: true, device: "iPhone" }, "", native)).b.token;
  const mac = (await request("/login", { ...credentials, device:"Mac" })).cookie;
  const as = (token) => (path, body, method) => request(path, body, "", { ...native, authorization: "Bearer " + token, method });
  const cases = [
    ["GET", "/api/agents", undefined, 200], ["GET", "/api/runtime/marketplace", undefined, 200],
    ["POST", "/api/runtime/mcp-marketplace/mcp_x/tools", {}, 200, "reading MCP tools changes nothing"],
    ["POST", "/api/tasks", { title: "x" }, 200, "tasks stay writable"],
    ["PUT", "/api/agents/agent_x", { name: "x" }, 403], ["DELETE", "/api/teams/team_x", undefined, 403],
    ["POST", "/api/runtime/marketplace", { url: "https://example.invalid/p.git" }, 403, "no plugin installs"],
    ["PUT", "/api/runtime/mcp-marketplace/mcp_x", {}, 403], ["PUT", "/api/runtime/git-credentials/github", {}, 403],
    ["PUT", "/api/settings/runtime-profiles/runtime_x", {}, 403],
  ];
  for (const [method, path, body, status, why] of cases) {
    const result = await as(phone)(path, body, method);
    console.log("phone", method, path, "→", result.s);
    assert.equal(result.s, status, (why || "") + " " + method + " " + path);
  }
  const desktop = await request("/api/agents/agent_x", { name:"x" }, mac, {method:"PUT"});
  console.log("desktop PUT /api/agents/agent_x →", desktop.s);
  assert.equal(desktop.s, 200, "a desktop client keeps configuration writes");
  assert.deepEqual(identity.devices().map((device) => device.scope).sort(), ["desktop", "mobile"]);

});

test("security: failed authentication is throttled per client address", async (t) => {
  const { identity, request } = await setup(t, "local", { api: async (req, res) => { res.writeHead(200); res.end("{}"); } });
  const from = (address) => ({ origin: null, "x-forwarded-for": address });
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const result = await request("/login", { ...credentials, password:"wrong-" + attempt, bearer: true }, "", from("203.0.113.5"));
    assert.equal(result.s, attempt < 20 ? 401 : 429);
  }
  const blocked = await request("/login", { ...credentials, bearer: true }, "", from("203.0.113.5"));
  console.log("after 20 failures:", blocked.s, blocked.b.error, "Retry-After", blocked.h["retry-after"]);
  assert.equal(blocked.s, 429, "even a valid code waits out the block");
  assert.ok(Number(blocked.h["retry-after"]) > 86390);
  const other = await request("/login", { ...credentials, bearer: true }, "", from("203.0.113.6"));
  console.log("another client:", other.s);
  assert.equal(other.s, 200, "other clients are unaffected");
});

test("only configured proxy peers provide a valid client address", () => {
  const req = {socket:{remoteAddress:"::ffff:192.0.2.3"}, headers:{"x-forwarded-for":"203.0.113.99, 2001:0db8::8"}};
  assert.equal(clientAddress(req), "192.0.2.3");
  const proxies = new Set(["192.0.2.3"]);
  assert.equal(clientAddress(req, proxies), "2001:db8::8");
  req.headers["x-forwarded-for"] = "invalid";
  assert.equal(clientAddress(req, proxies), "192.0.2.3");
});

test("the account and IP lockout counts spaced failures and survives reopening the login database", async t => {
  let time = Date.now();
  t.mock.method(Date, "now", () => time);
  const {administrator, request, root} = await setup(t, "local", {protocol:"http:"});
  const from = {"x-forwarded-for":"203.0.113.5"};
  const wrong = {...credentials, password:"incorrect password"};
  const day = 86400000;
  for (let attempt = 1; attempt <= 20; attempt++) {
    time += 30 * 60000;
    const reply = await request("/login", wrong, "", from);
    assert.equal(reply.s, attempt < 20 ? 401 : 429);
    if (attempt === 20) assert.equal(reply.h["retry-after"], "86400");
  }
  const reopened = workspaceIdentity(root, "local", administrator);
  try {
    assert.equal(reopened.loginRetryAfter(credentials.name, "203.0.113.5"), 86400);
    assert.equal(reopened.loginRetryAfter("another-account", "203.0.113.5"), 0);
    assert.equal(reopened.loginRetryAfter(credentials.name, "203.0.113.6"), 0);
  } finally { reopened.close(); }
  time += day - 1000;
  const denied = await request("/login", credentials, "", from);
  assert.equal(denied.s, 429);
  assert.equal(denied.h["retry-after"], "1");
  time += 1000;
  assert.equal((await request("/login", credentials, "", from)).s, 200);
});

test("a successful login resets the failure count for that account and address", async t => {
  const {identity,request} = await setup(t, "local", {protocol:"http:"});
  const address = "203.0.113.5";
  const from = {"x-forwarded-for":address};
  for (let i = 0; i < 19; i++) identity.recordLoginFailure(credentials.name, address);
  assert.equal((await request("/login", credentials, "", from)).s, 200);
  assert.equal((await request("/login", {...credentials,password:"invalid"}, "", from)).s, 401);
});

test("password verification capacity frees up after pending logins finish", async t => {
  const {administrator, request} = await setup(t, "local", {protocol:"http:"});
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  let calls = 0;
  t.mock.method(administrator, "verifyAdministrator", async () => {
    if (++calls === 4) started.resolve();
    await release.promise;
    return null;
  });
  const pending = Promise.all(Array.from({length:4}, () => request("/login", credentials)));
  try {
    await started.promise;
    const busy = await request("/login", credentials);
    assert.equal(busy.s, 429);
    assert.ok(Number(busy.h["retry-after"]) > 0);
    assert.equal(calls, 4);
  } finally {
    release.resolve();
    await pending;
  }
  assert.equal((await request("/login", credentials)).s, 401);
  assert.equal(calls, 5);
});

test("login throttling preserves existing sessions and bounds unauthenticated input", async t => {
  const {request} = await setup(t, "local", {protocol:"http:"});
  const login = await request("/login", credentials);
  assert.equal(login.s, 200);
  const oversized = await request("/login", {name:"operator", password:"x".repeat(8192)});
  assert.equal(oversized.s, 413);
  for (let i = 0; i < 21; i++) assert.equal((await request("/device-info")).s, 401);
  assert.equal((await request("/login", credentials)).s, 200);
  for (let i = 0; i < 20; i++) await request("/login", {name:"operator",password:"invalid"});
  assert.equal((await request("/login", credentials)).s, 429);
  assert.equal((await request("/device-info", undefined, login.cookie)).s, 200);
  assert.equal((await request("/healthz")).s, 200);
});
test("security: device sessions record use, expire after 30 idle days, stay private", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const { statSync } = await import("node:fs");
  const { identity, request, root } = await setup(t, "local", { api: async (req, res) => { res.writeHead(200); res.end("{}"); } });
  const native = { origin: null, "x-forwarded-for": "198.51.100.7" };
  const token = (await request("/login", { ...credentials, bearer: true, device: "iPhone" }, "", native)).b.token;
  const [device] = identity.devices();
  console.log("device", { created: Boolean(device.created), lastSeen: Boolean(device.lastSeen), lastAddress: device.lastAddress, scope: device.scope });
  assert.equal(device.lastAddress, "198.51.100.7");
  assert.ok(device.expires - Date.now() > 29 * 86400000, "30 days from the last use");
  const mode = statSync(join(root, "workspace-access.sqlite")).mode & 0o777;
  console.log("access database mode", mode.toString(8));
  assert.equal(mode, 0o600, "token and password hashes are private");
  // An old session that is used again slides forward; one idle past 30 days is gone.
  const db = new DatabaseSync(join(root, "workspace-access.sqlite"));
  db.prepare("UPDATE devices SET lastSeen=?, expires=? WHERE id=?").run(Date.now() - 20 * 86400000, Date.now() + 10 * 86400000, device.id);
  assert.equal((await request("/api/tasks", undefined, "", { ...native, authorization: "Bearer " + token })).s, 200);
  const renewed = identity.devices()[0];
  console.log("renewed expiry in days", Math.round((renewed.expires - Date.now()) / 86400000));
  assert.ok(renewed.expires - Date.now() > 29 * 86400000, "use renews the idle expiry");
  db.prepare("UPDATE devices SET expires=? WHERE id=?").run(Date.now() - 1000, device.id);
  db.close();
  assert.equal((await request("/api/tasks", undefined, "", { ...native, authorization: "Bearer " + token })).s, 401, "an idle session ends");
});

test("security: internal errors stay private; headers harden every response; streams are bounded per device", async (t) => {
  const held = [];
  const api = async (req, res, url) => {
    for await (const _ of req);
    if (url.pathname === "/api/tasks/boom") throw new TypeError("内部错误 /Users/secret/path");
    if (url.pathname.endsWith("/events")) { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": open\n\n"); held.push(res); return; }
    res.writeHead(200); res.end("{}");
  };
  const { identity, request, root, port } = await setup(t, "local", { api });
  const native = { origin: null };
  const token = (await request("/login", { ...credentials, bearer: true }, "", native)).b.token;
  const auth = { ...native, authorization: "Bearer " + token };
  const boom = await request("/api/tasks/boom", undefined, "", auth);
  console.log("internal error response:", boom.s, boom.b);
  assert.equal(boom.b.error, "请求处理失败");
  assert.doesNotMatch(JSON.stringify(boom.b), /secret|Cannot read/);
  const ok = await request("/api/tasks", undefined, "", auth);
  const hardening = ["strict-transport-security", "x-frame-options", "cross-origin-opener-policy", "cross-origin-resource-policy", "x-content-type-options", "content-security-policy"];
  for (const header of hardening) assert.ok(ok.h[header], header);
  // Rejected requests (wrong Host) carry the same headers.
  const wrongHost = await new Promise((resolve, reject) => {
    const req = https.request({ host: "127.0.0.1", port, servername: "localhost", ca: readFileSync(join(root, "cert")), path: "/api/tasks", headers: { host: "attacker.example" } }, (res) => { res.resume(); resolve(res); });
    req.on("error", reject); req.end();
  });
  console.log("wrong Host:", wrongHost.statusCode, hardening.filter((header) => wrongHost.headers[header]).length + "/" + hardening.length, "hardening headers");
  assert.equal(wrongHost.statusCode, 403);
  for (const header of hardening) assert.ok(wrongHost.headers[header], "rejected response has " + header);
  // Nine concurrent event streams from one device: the ninth is refused.
  const streams = [];
  const certificate = readFileSync(join(root, "cert"));
  for (let index = 0; index < 9; index += 1) {
    streams.push(await new Promise((resolve, reject) => {
      const req = https.request({ host: "127.0.0.1", port, servername: "localhost", ca: certificate, path: "/api/runs/run_x/events", headers: { host: "localhost", authorization: "Bearer " + token } }, (res) => resolve({ status: res.statusCode, req, res }));
      req.on("error", reject); req.end();
    }));
  }
  console.log("stream statuses:", streams.map((stream) => stream.status).join(","));
  assert.deepEqual(streams.map((stream) => stream.status), [200, 200, 200, 200, 200, 200, 200, 200, 429]);
  for (const stream of streams) stream.req.destroy();
  for (const res of held) res.end();
});

test("account devices are scoped to the signed-in member and disappear on logout", async t => {
  const {identity,request}=await setup(t,"cloud");
  await identity.add("one","password for one"); await identity.add("two","password for two");
  const first=await request('/login',{name:"one",password:"password for one",device:"Mac A"});
  const phone=await request('/login',{name:"one",password:"password for one",device:"Phone A",bearer:true});
  await request('/login',{name:"two",password:"password for two",device:"Mac B"});
  const list=()=>request('/device-info',undefined,first.cookie);
  assert.deepEqual((await list()).b.devices.map(d=>d.label).sort(),['Mac A','Phone A']);
  await request('/logout',{},'',{authorization:'Bearer '+phone.b.token});
  assert.deepEqual((await list()).b.devices.map(d=>d.label),['Mac A']);
});

test("resetting the local owner invalidates signed-in devices and their list entries", async t => {
  const {request, root} = await setup(t, "local", {api:(_req,res)=>{res.writeHead(200);res.end("{}");}});
  const previous = await request('/login', {...credentials,bearer:true}, '', {origin:null});
  const token = previous.b.token;
  const administrator = createAuth({databasePath:join(root,'auth.sqlite')});
  try { await administrator.setAdministrator(credentials.name, "changed workspace password"); }
  finally { administrator.close(); }
  const bearer = {origin:null,authorization:'Bearer '+token};
  assert.equal((await request('/api/tasks',undefined,'',bearer)).s,401);
  const current = await request('/login',{name:credentials.name,password:"changed workspace password",device:"Current Mac"});
  assert.deepEqual((await request('/device-info',undefined,current.cookie)).b.devices.map(item=>item.label),['Current Mac']);
});

test("supplied workspace certificates require HTTPS and a complete readable pair", t => {
  const root = mkdtempSync(join(tmpdir(), "baton-external-certs-"));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const input = {mode:"local", port:9443, origin:"https://localhost:9443"};
  assert.throws(() => provisionWorkspace(root, {...input, cert:"/tls/chain.pem"}), /绝对路径/);
  assert.throws(() => provisionWorkspace(root, {...input, cert:"relative.pem", key:"/tls/key.pem"}), /绝对路径/);
  assert.throws(() => provisionWorkspace(root, {...input, origin:"http://localhost:9443", cert:"/tls/chain.pem", key:"/tls/key.pem"}), /HTTPS/);
  assert.throws(() => provisionWorkspace(root, {...input, cert:join(root,"missing"), key:join(root,"key.pem")}), {code:"ENOENT"});
  const http = provisionWorkspace(root, {...input, origin:"http://localhost:9443"});
  assert.equal(http.cert, undefined);
  assert.equal(http.key, undefined);
});
