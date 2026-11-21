import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import https from "node:https";
import { createStore } from "../server/store.mjs";
import { workspaceIdentity } from "../server/workspace-identity.mjs";
import { startWorkspace } from "../server/workspace-http.mjs";

async function setup(t, mode, { api } = {}) {
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
  const origin = "https://localhost",
    config = { mode, name: "Test", origin, key, cert, port: 0 };
  const store = createStore({
    databasePath: join(root, "business.sqlite"),
    workspaceRoot: root,
    configurationDirectory: root,
  });
  const identity = workspaceIdentity(root, mode);
  const server = await startWorkspace({
    root,
    config,
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
    identity.close();
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
      const req = https.request(
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
  return { store, identity, request };
}
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
test("local pairing is one-use, stored as revocable device, grants cannot create accounts", async (t) => {
  const { identity, request } = await setup(t, "local");
  const code = identity.invite();
  const answer = await request("/pair", { code });
  assert.equal(answer.s, 200);
  assert.equal((await request("/pair", { code })).s, 401);
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
  const paired = await request("/pair", { code: identity.invite(), bearer: true, device: "iPhone\u0007 Kai" }, "", native);
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
  assert.equal((await call("/api/agents/agent_x", { name: "Kai" }, { method: "PUT" })).s, 200);
  // Node's client sends DELETE bodies without framing unless Content-Length is explicit.
  assert.equal((await call("/api/tasks/task_x", {}, { method: "DELETE", "content-length": "2" })).s, 200);
  assert.equal((await call("/api/teams/team_x", undefined, { method: "DELETE" })).s, 200, "DELETE without body");
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
  assert.equal(calls.length, 7, "denied routes never reach the desktop API");
  assert.equal((await request("/api/tasks", undefined, "", native)).s, 401, "no credentials");
  assert.equal((await request("/api/tasks", undefined, "", { ...native, authorization: "Bearer short" })).s, 401, "malformed token");
  // Browser cookies are ambient: writes need the workspace Origin.
  const browser = (await request("/pair", { code: identity.invite() })).cookie;
  assert.equal((await request("/api/tasks", {}, browser, native)).s, 403, "cookie write without Origin");
  assert.equal((await request("/api/tasks", {}, browser)).s, 200, "same-origin cookie write");
  // Revoking the device ends forwarded streams and later requests.
  identity.revoke(identity.devices().find((device) => device.label === "iPhone Kai").id);
  assert.equal(lastContext.sessionValid(), true, "the browser device stays valid");
  assert.equal((await call("/api/tasks")).s, 401, "revoked token");
  console.log("revoked device rejected; calls", calls.length);
});
test("native pairing token is exchanged once and ends with logout", async (t) => {
  const { identity, request } = await setup(t, "local", { api: async (req, res) => { res.writeHead(200); res.end("{}"); } });
  const native = { origin: null };
  const { token } = (await request("/pair", { code: identity.invite(), bearer: true }, "", native)).b;
  const bearer = { ...native, authorization: "Bearer " + token };
  assert.equal((await request("/workspace", undefined, "", bearer)).b.user.id, "human_operator", "legacy endpoints accept the token");
  assert.equal(identity.devices()[0].label, "iOS", "default device label");
  assert.equal((await request("/logout", {}, "", bearer)).s, 200);
  assert.equal((await request("/api/tasks", undefined, "", bearer)).s, 401, "logout revokes the token");
  console.log("token logout verified");
});
