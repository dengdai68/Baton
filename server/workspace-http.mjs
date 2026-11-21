import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { workspaceIdentity, localUser } from "./workspace-identity.mjs";

const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/style.css", ["style.css", "text/css"]],
]);
const sessionCookie = "__Host-baton_workspace";
const fail = (status, message) => Object.assign(Error(message), { status });
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
  /^\/api\/(bootstrap|overview|notifications|catalog-references|health)$/,
  /^\/api\/(tasks|runs|communications|automations|agents|roles|teams|workflow-templates)(\/|$)/,
  /^\/api\/runtime\/(marketplace|mcp-marketplace|git-credentials)(\/|$)/,
  /^\/api\/settings\/(runtime-profiles|log-files|execution-logs|workspace)(\/|$)/,
];
/** Whether a paired device may call this desktop API route. */
export function deviceApiAllowed(method, path) {
  if (path.startsWith("/api/settings/workspace") && method !== "GET") return false;
  return deviceApiRoutes.some((route) => route.test(path));
}
const attachmentUpload =
  /^\/api\/(?:communications\/chat_|runs\/run_)[A-Za-z0-9_-]+\/attachments$/;
const bearerPattern = /^Bearer ([A-Za-z0-9_-]{20,200})$/;
const apiMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
/** Native clients send an explicit bearer token; browsers use the HttpOnly cookie. */
function credentialsOf(req) {
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
  api,
}) {
  const origin = new URL(config.origin);
  if (
    !["cloud", "local"].includes(config.mode) ||
    origin.protocol !== "https:" ||
    origin.origin !== config.origin
  )
    throw Error("工作空间需要准确的 HTTPS origin");
  const identity = workspaceIdentity(root, config.mode);
  const issueCookie = (res, token, days) =>
    res.setHeader(
      "Set-Cookie",
      sessionCookie +
        "=" +
        token +
        "; Secure; Path=/; HttpOnly; SameSite=Strict; Max-Age=" +
        days * 86400,
    );
  /** Forward an allowed /api request of a paired local device to the desktop API. */
  async function deviceApi(req, res, url, credentials) {
    if (config.mode !== "local" || !api) throw fail(404, "未找到");
    if (!apiMethods.includes(req.method)) throw fail(405, "不支持的操作");
    if (!identity.session(credentials.token))
      throw fail(401, "请登录或重新配对");
    if (!deviceApiAllowed(req.method, url.pathname))
      throw fail(403, "此操作仅可在 Mac 上进行");
    if (!["GET", "HEAD"].includes(req.method)) {
      const type = req.headers["content-type"] || "";
      const upload =
        req.method === "POST" &&
        attachmentUpload.test(url.pathname) &&
        /^application\/octet-stream(?:;|$)/i.test(type);
      // Cookies are ambient, so only same-origin pages may write with them.
      if (!credentials.bearer && req.headers.origin !== origin.origin)
        throw fail(403, "需要同源请求");
      if (!upload && !/^application\/json(?:;|$)/i.test(type))
        throw fail(403, "需要 JSON 请求");
    }
    await api(req, res, url, {
      sessionValid: () => Boolean(identity.session(credentials.token)),
    });
  }
  const server = createServer(
    {
      key: readFileSync(config.key),
      cert: readFileSync(config.cert),
      minVersion: "TLSv1.2",
      // Attachment uploads (up to 20 MiB) may cross a slow mobile link or Relay.
      requestTimeout: 300000,
      headersTimeout: 15000,
    },
    async (req, res) => {
      try {
        if (req.headers.host !== origin.host) throw fail(403, "Host 不匹配");
        const url = new URL(req.url, origin),
          path = url.pathname;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
        );
        if (req.method === "GET" && assets.has(path)) {
          const [file, type] = assets.get(path);
          res.setHeader("Content-Type", type + "; charset=utf-8");
          res.end(
            readFileSync(new URL("../web/workspace/" + file, import.meta.url)),
          );
          return;
        }
        const credentials = credentialsOf(req);
        if (path.startsWith("/api/"))
          return await deviceApi(req, res, url, credentials);
        const write = req.method === "POST";
        if (req.method !== "GET" && !write) throw fail(405, "不支持的操作");
        if (
          write &&
          !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")
        )
          throw fail(403, "需要同源 JSON 请求");
        const data = write ? await readJson(req) : {};
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw fail(400, "需要 JSON 对象");
        // A native client asks for its token in the body and receives no cookie,
        // so a cross-site page can neither read the token nor plant a session.
        const native =
          write && ["/login", "/pair"].includes(path) && data.bearer === true;
        if (
          write &&
          !native &&
          !credentials.bearer &&
          req.headers.origin !== origin.origin
        )
          throw fail(403, "需要同源 JSON 请求");
        if (write && ["/login", "/pair"].includes(path)) {
          const token =
            path === "/pair"
              ? identity.pair(data.code, deviceLabel(data.device))
              : await identity.login(data.name, data.password);
          if (!token) throw fail(401, "凭据无效或已过期");
          if (native) return sendJson(res, 200, { ok: true, token });
          issueCookie(res, token, 30);
          return sendJson(res, 200, { ok: true });
        }
        const user = identity.session(credentials.token);
        if (!user) throw fail(401, "请登录或重新配对");
        if (write && path === "/logout") {
          identity.revoke(user.deviceId);
          if (!credentials.bearer) issueCookie(res, "", 0);
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
        sendJson(res, error.status || 400, { error: error.message });
      }
    },
  );
  await new Promise((ok, bad) => {
    server.once("error", error => {identity.close();bad(error);});
    server.listen(config.port, config.bind || "127.0.0.1", ok);
  });
  server.on("close", () => identity.close());
  return server;
}
