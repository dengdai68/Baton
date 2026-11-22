import { createServer as httpsServer } from "node:https";
import { createServer as httpServer } from "node:http";
import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import { workspaceIdentity, localUser } from "./workspace-identity.mjs";
import { diagnostic } from "./diagnostics.mjs";

const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/workspace/request-id.mjs", ["request-id.mjs", "text/javascript"]],
  ["/workspace-ui.js", ["app.js", "text/javascript"]],
  ["/workspace-ui.css", ["style.css", "text/css"]],
]);
const publicFailure = Symbol("workspace public error");
const fail = (status, message) => Object.assign(Error(message), { status, [publicFailure]: true });
const defaultAccess = (ownerId) => ({
  createdBy: ownerId,
  ownerId,
  grants: {},
});
function accessOf(resource) {
  return resource.access || defaultAccess(localUser);
}
function permission(resource, user) {
  const access = accessOf(resource);
  if (access.ownerId === user.id || access.createdBy === user.id)
    return "manage";
  return access.grants[user.id] || null;
}
function authorize(resource, user, write = false) {
  const role = permission(resource, user);
  if (!role || (write && role === "view")) throw fail(403, "没有此操作的权限");
  return role;
}
const pick = (object, keys) =>
  Object.fromEntries(
    keys.filter((k) => Object.hasOwn(object, k)).map((k) => [k, object[k]]),
  );
const taskFields = [
  "title",
  "objective",
  "memberAgentIds",
  "teamIds",
  "managerAgentId",
  "workflowTemplateId",
  "acceptanceCriteria",
];
const taskSummary = (task, role, runId) => ({
  ...pick(task, ["id", "title", "objective", "status", "kind"]),
  runId,
  role,
  access: accessOf(task),
});
const actorOf = (user) => ({ type: "human", id: user.id, name: user.name });

// A paired local device is the instance owner, so it reaches the same desktop API
// as the Mac client. Only these route families are forwarded (deny by default):
// data-directory moves, data reset, desktop login and pairing stay on the Mac.
const deviceApiRoutes = [
  /^\/api\/workspace\/events$/,
  /^\/api\/(bootstrap|overview|notifications|catalog-references|health)$/,
  /^\/api\/(tasks|runs|communications|automations|agents|roles|teams|workflow-templates)(\/|$)/,
  /^\/api\/runtime\/(marketplace|mcp-marketplace|git-credentials)(\/|$)/,
  /^\/api\/settings\/(runtime-profiles|log-files|execution-logs|workspace)(\/|$)/,
];
// Phones read configuration but never change it: plugins, MCP, Git credentials,
// Runtime and the employee directory. Reading an MCP server's tools is a POST
// that changes nothing, so it stays allowed.
const mobileReadOnly = [
  /^\/api\/runtime\/(marketplace|mcp-marketplace|git-credentials)(\/|$)/,
  /^\/api\/settings\/runtime-profiles(\/|$)/,
  /^\/api\/(agents|roles|teams|workflow-templates)(\/|$)/,
];
const mcpToolsRead = /^\/api\/runtime\/mcp-marketplace\/[^/]+\/tools$/;
/** Whether a paired device of this scope may call this desktop API route. */
export function deviceApiAllowed(method, path, scope = "mobile") {
  if (path.startsWith("/api/settings/workspace") && method !== "GET") return false;
  if (!deviceApiRoutes.some((route) => route.test(path))) return false;
  const write = !["GET", "HEAD"].includes(method);
  if (scope === "mobile" && write && mobileReadOnly.some((route) => route.test(path)) && !(method === "POST" && mcpToolsRead.test(path))) return false;
  return true;
}

function normalizeAddress(value) {
  if (typeof value !== "string" || value.includes("%")) return null;
  const address = value.replace(/^::ffff:/i, "");
  if (isIP(address) === 4) return address;
  if (isIP(value) === 6) return new URL("http://[" + value + "]").hostname.slice(1, -1);
  return null;
}

/** Use the rightmost forwarded address only for a configured immediate proxy peer. */
export function clientAddress(req, trustedProxies = new Set()) {
  const peer = normalizeAddress(req.socket?.remoteAddress);
  const forwarded = req.headers["x-forwarded-for"];
  if (trustedProxies.has(peer) && typeof forwarded === "string") {
    return normalizeAddress(forwarded.split(",").at(-1).trim()) || peer;
  }
  return peer || "unknown";
}

/**
 * Failed authentication per client address: `limit` failures within `windowMs`
 * block that address for `blockMs` (tokens are 256-bit, so this bounds noise,
 * password guessing and log flooding rather than token guessing).
 */
export function createAuthThrottle({ limit = 20, windowMs = 600000, blockMs = 600000, maxClients = 5000, now = Date.now } = {}) {
  const clients = new Map();
  return {
    /** Seconds until this address may try again (0 = not blocked). */
    blocked(key) {
      const item = clients.get(key);
      return item && item.blockedUntil > now() ? Math.ceil((item.blockedUntil - now()) / 1000) : 0;
    },
    fail(key) {
      const time = now();
      let item = clients.get(key);
      if (!item || (item.blockedUntil <= time && time - item.since > windowMs)) item = { since: time, count: 0, blockedUntil: 0 };
      clients.delete(key); clients.set(key, item);
      item.count += 1;
      const justBlocked = item.count >= limit && item.blockedUntil <= time;
      if (justBlocked) item.blockedUntil = time + blockMs;
      while (clients.size > maxClients) clients.delete(clients.keys().next().value);
      return { count: item.count, blocked: justBlocked };
    },
  };
}

/** Only messages explicitly defined by the public gateway may cross this boundary. */
export function publicErrorMessage(error) {
  return error?.[publicFailure] ? error.message : "请求处理失败";
}
const streamsPerDevice = 8;
const attachmentUpload =
  /^\/api\/(?:communications\/chat_|runs\/run_)[A-Za-z0-9_-]+\/attachments$/;
const bearerPattern = /^Bearer ([A-Za-z0-9_-]{20,200})$/;
const apiMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
/** Native clients send an explicit bearer token; browsers use the HttpOnly cookie. */
function credentialsOf(req, sessionCookie) {
  const header = req.headers.authorization;
  if (header !== undefined)
    return { token: bearerPattern.exec(header)?.[1] || null, bearer: true };
  const cookie = (req.headers.cookie || "")
    .split(/;\s*/)
    .find((v) => v.startsWith(sessionCookie + "="));
  return { token: cookie?.slice(sessionCookie.length + 1) || null, bearer: false };
}
/** A short printable device name for the Mac's device list. */
function deviceLabel(value) {
  const label =
    typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60)
      : "";
  return label || "iOS";
}

export async function startWorkspace({
  config,
  root,
  ensureBusiness,
  readJson,
  sendJson,
  execute,
  wake,
  pause,
  resume,
  canWrite,
  isReady = () => true,
  api,
  administrator,
  desktopAssets,
  hostDevice,
}) {
  const origin = new URL(config.origin);
  if (
    !["cloud", "local"].includes(config.mode) ||
    !["https:", "http:"].includes(origin.protocol) ||
    origin.origin !== config.origin
  )
    throw Error("工作空间需要准确的 HTTP 或 HTTPS origin");
  const secure = origin.protocol === "https:";
  const cookieName = https => https ? "__Host-baton_workspace" : "baton_workspace_http";
  const proxyAddresses = config.trustedProxyAddresses ?? [];
  if (!Array.isArray(proxyAddresses) || proxyAddresses.some(address => !normalizeAddress(address)))
    throw Error("工作空间可信代理需要有效的 IP 地址列表");
  const trustedProxies = new Set(proxyAddresses.map(normalizeAddress));
  const identity = workspaceIdentity(root, config.mode, administrator);
  const issueCookie = (res, token, days, https) =>
    res.setHeader(
      "Set-Cookie",
      cookieName(https) +
        "=" +
        token +
        (https ? "; Secure" : "") + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" +
        days * 86400,
    );
  /** Forward an allowed /api request of a paired local device to the desktop API. */
  async function deviceApi(req, res, url, credentials, address, requestOrigin) {
    if (config.mode !== "local" || !api) throw fail(404, "未找到");
    if (!apiMethods.includes(req.method)) throw fail(405, "不支持的操作");
    const user = identity.session(credentials.token, { address });
    if (!user) throw fail(401, "请重新登录");
    if (!deviceApiAllowed(req.method, url.pathname, user.scope))
      throw fail(403, "此操作仅可在 Mac 上进行");
    if (!["GET", "HEAD"].includes(req.method)) {
      const type = req.headers["content-type"] || "";
      const upload =
        req.method === "POST" &&
        attachmentUpload.test(url.pathname) &&
        /^application\/octet-stream(?:;|$)/i.test(type);
      // Cookies are ambient, so only same-origin pages may write with them.
      if (!credentials.bearer && req.headers.origin !== requestOrigin.origin)
        throw fail(403, "需要同源请求");
      if (!upload && !/^application\/json(?:;|$)/i.test(type))
        throw fail(403, "需要 JSON 请求");
    }
    // Long-lived event streams are bounded per device.
    if (req.method === "GET" && /\/events$/.test(url.pathname)) {
      const open = streams.get(user.deviceId) || 0;
      if (open >= streamsPerDevice) throw fail(429, "同时打开的实时连接过多，请关闭部分页面后重试");
      streams.set(user.deviceId, open + 1);
      res.once("close", () => {
        const left = (streams.get(user.deviceId) || 1) - 1;
        if (left > 0) streams.set(user.deviceId, left); else streams.delete(user.deviceId);
      });
    }
    await api(req, res, url, {
      remote: true,
      sessionValid: () => Boolean(identity.session(credentials.token)),
    });
  }
  const throttle = createAuthThrottle();
  let pendingPasswordChecks = 0;
  const streams = new Map();
  const authFailed = (address, path) => {
    const { count, blocked } = throttle.fail(address);
    if (count === 1 || blocked) diagnostic(blocked ? "workspace.auth_throttled" : "workspace.auth_failed", { address, path, count });
  };
  const createServer = secure ? httpsServer : httpServer;
  const server = createServer(
    {
      ...(secure && {key:readFileSync(config.key), cert:readFileSync(config.cert), minVersion:"TLSv1.2"}),
      // Attachment uploads (up to 20 MiB) may cross a slow mobile link or Relay.
      requestTimeout: 300000,
      headersTimeout: 15000,
    },
    async (req, res) => {
      const address = clientAddress(req, trustedProxies);
      let path = "";
      try {
        // TLS can terminate at the registered public origin while Baton listens on HTTP.
        const external = config.accessOrigin || config.pairingOrigin;
        const publicOrigin = external ? new URL(external) : null;
        const requestOrigin = publicOrigin && publicOrigin.host === req.headers.host ? publicOrigin : origin;
        const https = requestOrigin.protocol === "https:";
        // Hardening headers go on every response, including rejected ones.
        if (secure || https) res.setHeader("Strict-Transport-Security", "max-age=31536000");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
        );
        if (requestOrigin.host !== req.headers.host) throw fail(403, "Host 不匹配");
        const url = new URL(req.url, requestOrigin);
        path = url.pathname;
        if (path === '/healthz' && req.method === 'GET') {
          const ready = isReady();
          return sendJson(res, ready ? 200 : 503, {service:'baton-workspace', status:ready ? 'ready' : 'unavailable'});
        }
        const credentials = credentialsOf(req, cookieName(https));
        const desktopUser = !credentials.bearer && credentials.token && identity.session(credentials.token, {address});
        if (desktopUser?.scope === 'desktop' && config.mode === 'local' && desktopAssets && req.method === 'GET' &&
            (path === '/tasks' || path.startsWith('/settings/') || (!path.startsWith('/api/') && path !== '/' && !assets.has(path) && !['/device-info','/workspace','/login','/logout','/signed-out'].includes(path)))) {
          // The remote renderer runs on this HTTPS origin and has no native host bridge.
          res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'");
          await desktopAssets(res,path);
          return;
        }
        if (req.method === 'GET' && (assets.has(path) || ['/login','/signed-out'].includes(path))) {
          const [file,type] = assets.get(path) || assets.get('/');
          res.setHeader('Content-Type', type + '; charset=utf-8');
          res.end(readFileSync(new URL('../web/workspace/' + file, import.meta.url)));
          return;
        }
        if (path === '/api/auth/session' && req.method === 'GET' && desktopUser)
          return sendJson(res, 200, {username:desktopUser.name});
        if (path === '/api/auth/logout' && req.method === 'POST') path = '/logout';
        if (path.startsWith('/api/') && path !== '/api/settings/current-workspace')
          return await deviceApi(req, res, url, credentials, address, requestOrigin);
        if (path === '/pair') throw fail(404, '未找到');
        const write = req.method === "POST";
        if (req.method !== "GET" && !write) throw fail(405, "不支持的操作");
        if (
          write &&
          !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")
        )
          throw fail(403, "需要同源 JSON 请求");
        const signingIn = write && path === "/login";
        const user = !signingIn && (desktopUser || identity.session(credentials.token, {address}));
        if (!signingIn && !user) throw fail(401, "请重新登录");
        if (signingIn && Number(req.headers["content-length"]) > 8192)
          throw fail(413, "登录请求过大");
        let data;
        try { data = write ? await readJson(req, signingIn ? 8192 : undefined) : {}; }
        catch (error) {
          if (error.name === "RequestBodyTooLargeError" || error.status === 413) throw fail(413, "请求体过大");
          throw fail(400, "请求体不是有效 JSON");
        }
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw fail(400, "需要 JSON 对象");
        // A native client asks for its token in the body and receives no cookie,
        // so a cross-site page can neither read the token nor plant a session.
        const native =
          write && path === "/login" && data.bearer === true;
        if (
          write &&
          !native &&
          !credentials.bearer &&
          req.headers.origin !== requestOrigin.origin
        )
          throw fail(403, "需要同源 JSON 请求");
        if (signingIn) {
          const name = typeof data.name === "string" ? data.name.trim() : "";
          const recordAccount = name.length > 0 && name.length <= 80;
          const accountWait = () => recordAccount ? identity.loginRetryAfter(name, address) : 0;
          const rejectLogin = (seconds) => {
            res.setHeader("Retry-After", String(seconds));
            throw fail(429, "尝试次数过多，请稍后再试");
          };
          const wait = Math.max(accountWait(), throttle.blocked(address));
          if (wait) rejectLogin(wait);
          const label = deviceLabel(data.device || (native ? 'iPhone' : 'Mac'));
          if (pendingPasswordChecks >= 4) {
            res.setHeader("Retry-After", "1");
            throw fail(429, "登录请求繁忙，请稍后再试");
          }
          let token;
          pendingPasswordChecks++;
          try {
            token = await identity.login(data.name, data.password, {
              label, scope: native ? "mobile" : "desktop", address, canIssue: () => !accountWait(),
            });
          }
          finally { pendingPasswordChecks--; }
          if (!token) {
            authFailed(address, "/login");
            const wait = recordAccount && identity.recordLoginFailure(name, address);
            if (wait) {
              diagnostic("workspace.account_ip_throttled", { address, retryAfter: wait });
              rejectLogin(wait);
            }
            throw fail(401, "用户名或密码错误");
          }
          if (recordAccount) identity.clearLoginFailures(name, address);
          if (credentials.token) {
            const previous = identity.session(credentials.token);
            if (previous) identity.revoke(previous.deviceId);
          }
          diagnostic('workspace.member_signed_in', {address, label});
          const facts = {workspace:config.name, mode:config.mode};
          if (native) return sendJson(res, 200, { ...facts, ok:true, token });
          issueCookie(res, token, 30, https);
          return sendJson(res, 200, { ...facts, ok:true });
        }
        if (!write && ['/device-info','/api/settings/current-workspace'].includes(path)) {
          return sendJson(res,200,{name:config.name, origin:requestOrigin.origin, username:user.name,
            deviceId:user.deviceId, local:false, ...(user.scope === 'desktop' && {
              devices:[...(config.mode === 'local' ? hostDevice?.() || [] : []), ...identity.accountDevices(user.id)]})});
        }
        if (write && path === "/logout") {
          identity.revoke(user.deviceId);
          if (!credentials.bearer) issueCookie(res, "", 0, https);
          return sendJson(res, 200, { ok: true });
        }
        const store = await ensureBusiness();
        if (write && !identity.session(credentials.token))
          throw fail(401, "设备已撤销");
        if (write && (!canWrite() || store.configurationBlocked()))
          throw fail(503, "服务正在维护");
        const access = defaultAccess(user.id);
        const once = (command) =>
          store.workspaceRequest(
            user,
            data.clientRequestId,
            path,
            data,
            command,
          );
        let result;
        if (!write && path === "/workspace") {
          const { agents, teams, workflowTemplates } =
            store.getCatalogReferences();
          const tasks = store
            .listTasks()
            .filter((t) => !t.archivedAt && permission(t, user))
            .map((t) =>
              taskSummary(
                t,
                permission(t, user),
                store.taskRunIds(t.id).at(-1),
              ),
            );
          const automations = store
            .workspaceAutomations()
            .filter((a) => permission(a, user))
            .map((a) => ({
              ...pick(a, ["id", "title", "enabled", "cron", "latestTrigger"]),
              access: accessOf(a),
              role: permission(a, user),
            }));
          const automationRoles = new Map(
            automations.map((a) => [a.id, a.role]),
          );
          const exceptions = store
            .workspaceAutomationAttention()
            .filter((t) =>
              ["manage", "operate"].includes(
                automationRoles.get(t.automationId),
              ),
            )
            .map((t) =>
              taskSummary(
                t,
                automationRoles.get(t.automationId),
                store.taskRunIds(t.id).at(-1),
              ),
            );
          const chats = store
            .listCommunications()
            .filter((c) => permission(c, user))
            .map((c) => ({
              ...pick(c, ["id", "name", "preview", "kind"]),
              access: accessOf(c),
              role: permission(c, user),
            }));
          result = {
            name: config.name,
            mode: config.mode,
            user: pick(user, ["id", "name"]),
            members: identity.members(),
            agents,
            teams,
            workflowTemplates,
            tasks,
            automations,
            chats,
            inbox: tasks
              .filter(
                (t) =>
                  t.role !== "view" &&
                  [
                    "awaiting_acceptance",
                    "awaiting_human",
                    "failed",
                    "blocked",
                    "paused",
                  ].includes(t.status),
              )
              .concat(exceptions),
          };
        } else if (write && path === "/tasks") {
          result = once(() => ({
            id: store.createTask(pick(data, taskFields), access).id,
          })).value;
        } else if (write && path === "/automations") {
          result = once(() => ({
            id: store.saveAutomation(
              pick(data, [...taskFields, "cron", "enabled"]),
              null,
              new Date(),
              access,
            ).id,
          })).value;
        } else if (write && path === "/chats") {
          result = once(() => ({
            id: store.openCommunication(
              pick(data, ["kind", "targetId", "name", "memberAgentIds"]),
              access,
            ).id,
          })).value;
        } else {
          const parts =
            /^\/(tasks|automations|chats)\/([a-z]+_[a-zA-Z0-9_-]+)(?:\/([a-z-]+))?$/.exec(
              path,
            );
          if (!parts) throw fail(404, "未找到");
          const [, collection, id, action] = parts;
          const resource =
            collection === "tasks"
              ? store.getTask(id)
              : collection === "automations"
                ? store.getAutomation(id)
                : store.getCommunication(id, { limit: 1 }).conversation;
          const governed = resource.automationId
            ? store.getAutomation(resource.automationId)
            : resource;
          const role = authorize(governed, user, write);
          if (write && action === "share") {
            if (
              role !== "manage" ||
              resource.automationId ||
              (collection === "chats" && resource.kind === "agent")
            )
              throw fail(403, "此资源不能共享");
            const known = new Set(identity.members().map((m) => m.id));
            if (
              !known.has(data.ownerId) ||
              !data.grants ||
              typeof data.grants !== "object" ||
              Array.isArray(data.grants) ||
              Object.entries(data.grants).some(
                ([key, value]) =>
                  !known.has(key) || !["view", "operate"].includes(value),
              )
            )
              throw fail(400, "无效的成员或权限");
            store.updateWorkspaceAccess(
              { tasks: "task", automations: "automation", chats: "chat" }[
                collection
              ],
              id,
              {
                ...accessOf(resource),
                ownerId: data.ownerId,
                grants: data.grants,
              },
            );
            result = { ok: true };
          } else if (collection === "chats") {
            if (!write && !action) {
              const { messages, hasMore, nextBefore } = store.getCommunication(
                id,
                { before: url.searchParams.get("before"), limit: 100 },
              );
              result = {
                messages: messages.map((m) =>
                  pick(m, ["id", "sender", "content", "createdAt"]),
                ),
                hasMore,
                nextBefore,
              };
            } else if (write && action === "messages") {
              result = store.sendCommunication(
                id,
                pick(data, ["content", "clientRequestId"]),
                actorOf(user),
              );
              wake(id);
            }
          } else if (collection === "automations") {
            if (!write && !action) result = store.listAutomationTriggers(id);
            if (write && action === "enabled")
              result = pick(
                store.saveAutomation({ enabled: data.enabled }, id),
                ["id", "enabled"],
              );
            if (write && action === "trigger") {
              const receipt = once(() => {
                const trigger = store.triggerAutomation(id, {
                  actor: actorOf(user),
                });
                return pick(trigger, [
                  "taskId",
                  "runId",
                  "id",
                  "outcome",
                  "reason",
                ]);
              });
              result = receipt.value;
              if (
                !receipt.replayed &&
                result.runId &&
                result.outcome === "started"
              )
                execute(result.runId);
            }
          } else {
            const runId = store.taskRunIds(id).at(-1);
            if (!write && !action) {
              const page = runId
                ? store.getRunCollaboration(runId, {
                    before: url.searchParams.get("before"),
                    limit: 60,
                  })
                : null;
              result = {
                ...taskSummary(resource, role, runId),
                runStatus: runId ? store.getRun(runId).status : null,
                messages: (page?.workspace.messages || [])
                  .filter((m) => page.selected.includes(m.id))
                  .map((m) =>
                    pick(m, ["id", "sender", "content", "createdAt"]),
                  ),
                nextBefore: page?.nextBefore,
                hasMore: page?.hasMore,
                questions: runId
                  ? store
                      .pendingQuestions(runId)
                      .filter((q) => q.recipient.type === "human")
                  : [],
              };
            } else if (write && action === "start") {
              const receipt = once(() => {
                if (runId) throw fail(409, "任务已启动");
                return { id: store.createRun(id).id };
              });
              result = receipt.value;
              if (!receipt.replayed) execute(result.id);
            } else if (write && runId) {
              if (data.runId !== runId)
                throw fail(409, "任务状态已更新，请刷新");
              if (action === "confirm") {
                const run = store.confirmRunCompletion(runId, actorOf(user));
                result = { status: run.status };
              }
              if (action === "messages") {
                result = store.submitHumanMessage(
                  runId,
                  pick(data, [
                    "content",
                    "replyToMessageId",
                    "clientRequestId",
                  ]),
                  { initialize: true, actor: actorOf(user) },
                );
                if (!result.replayed) execute(runId);
              }
              if (action === "retry") {
                const run = store.getRun(runId);
                if (run.status !== "failed") throw Error("只可重试失败轮次");
                store.workspaceRetry(runId);
                execute(runId);
                result = { ok: true };
              }
              if (action === "pause") {
                result = { status: pause(runId).status };
              }
              if (action === "resume") {
                result = { status: resume(runId).status };
                execute(runId);
              }
            }
          }
        }
        if (result === undefined) throw fail(404, "未找到操作");
        sendJson(res, 200, result);
      } catch (error) {
        const status = error.status || 400;
        if (!error.status && publicErrorMessage(error) !== error.message) diagnostic("workspace.request_failed", { address, path, error });
        sendJson(res, status, { error: publicErrorMessage(error) });
      }
    },
  );
  // A personal instance needs far fewer; this bounds connection floods.
  server.maxConnections = 256;
  await new Promise((ok, bad) => {
    server.once("error", error => {identity.close();bad(error);});
    server.listen(config.port, config.bind || "127.0.0.1", ok);
  });
  server.on("close", () => identity.close());
  return server;
}
