import { requestId as newRequestId } from '/workspace/request-id.mjs';
const byId = (id) => document.getElementById(id);
const content = byId("content"),
  tabs = byId("tabs"),
  status = byId("status");
let model,
  tab = "inbox",
  selection = null,
  screen = 0,
  busy = false,
  changed = "",
  editing = false;
const names = {
  inbox: "待我处理",
  tasks: "任务",
  automations: "自动化",
  chats: "沟通",
  settings: "工作空间",
};
const states = {
  backlog: "未开始",
  planning: "规划中",
  running: "进行中",
  awaiting_acceptance: "待验收",
  awaiting_human: "待回复",
  blocked: "执行受阻",
  paused: "已暂停",
  done: "已完成",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
function el(tag, text) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
}
function report(error) {
  status.textContent = error.message || String(error);
}
function button(label, fn, primary = false) {
  const b = el("button", label);
  b.type = "button";
  if (primary) b.className = "primary";
  b.onclick = async () => {
    if (busy) return;
    busy = true;
    b.disabled = true;
    status.textContent = "";
    try {
      await fn();
    } catch (e) {
      report(e);
    } finally {
      b.disabled = false;
      busy = false;
    }
  };
  return b;
}
function confirmAction(label) {
  return new Promise((resolve) => {
    const dialog = el("dialog"),
      ok = el("button", "确认"),
      cancel = el("button", "取消");
    ok.onclick = () => dialog.close("yes");
    cancel.onclick = () => dialog.close();
    dialog.onclose = () => {
      dialog.remove();
      resolve(dialog.returnValue === "yes");
    };
    dialog.append(el("p", label + "？"), cancel, ok);
    document.body.append(dialog);
    dialog.showModal();
  });
}
function field(label, type = "text", value = "") {
  const l = el("label", label),
    input = el(type === "area" ? "textarea" : "input");
  if (type !== "area") input.type = type;
  input.value = value;
  l.append(input);
  content.append(l);
  return input;
}
function select(label, items, initial) {
  const l = el("label", label),
    s = el("select");
  for (const item of items) {
    const o = el("option", item.name);
    o.value = item.id;
    s.append(o);
  }
  if (initial !== undefined) s.value = initial;
  l.append(s);
  content.append(l);
  return s;
}
function choices(label, items) {
  content.append(el("h2", label));
  const inputs = [];
  for (const i of items) {
    const l = el("label");
    l.className = "choice";
    const c = el("input");
    c.type = "checkbox";
    c.value = i.id;
    l.append(c, document.createTextNode(i.name));
    content.append(l);
    inputs.push(c);
  }
  return () => inputs.filter((c) => c.checked).map((c) => c.value);
}
async function api(path, data) {
  let receiptKey;
  if (
    model &&
    data &&
    !data.clientRequestId &&
    (/^\/(tasks|chats|automations)$/.test(path) ||
      /\/(trigger|start)$/.test(path))
  ) {
    receiptKey = "pending:" + model.user.id + ":" + path;
    const body = JSON.stringify(data),
      previous = JSON.parse(sessionStorage.getItem(receiptKey) || "null");
    const key = previous?.body === body ? previous.key : newRequestId();
    sessionStorage.setItem(receiptKey, JSON.stringify({ body, key }));
    data = { ...data, clientRequestId: key };
  }
  const response = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) {
    const e = new Error(result.error);
    e.status = response.status;
    throw e;
  }
  if (receiptKey) sessionStorage.removeItem(receiptKey);
  return result;
}
function clear() {
  content.replaceChildren();
  editing = false;
  screen++;
  changed = "";
  status.textContent = "";
}
function login() {
  clear();
  editing = true;
  model = null;
  selection = null;
  tabs.replaceChildren();
  byId("identity").textContent = "";
  byId("logout").hidden = true;
  content.append(el("h1", "登录工作空间"));
  const name = field("用户名"),
    password = field("密码", "password");
  name.autocomplete = "username";
  password.autocomplete = "current-password";
  content.append(
    button(
      "登录",
      async () => {
        const result = await api("/login", { name:name.value, password:password.value,
          device:new URLSearchParams(location.search).get('device') || 'Mac' });
        password.value = '';
        if (result.mode === 'local') { location.replace('/tasks'); return; }
        await reload();
      },
      true,
    ),
  );
}
async function reload() {
  const generation = ++screen;
  let data;
  try {
    data = await api("/workspace");
  } catch (e) {
    if (generation !== screen) return;
    if (e.status === 401) login();
    throw e;
  }
  if (generation !== screen) return;
  model = data;
  byId("identity").textContent = data.name + " · " + data.user.name;
  byId("logout").hidden = false;
  tabs.replaceChildren(
    ...Object.entries(names).map(([key, label]) => {
      const b = button(label, async () => {
        tab = key;
        selection = null;
        await reload();
      });
      b.setAttribute("aria-current", String(tab === key));
      return b;
    }),
  );
  if (tab === 'settings') {
    const info = await api('/device-info');
    if (generation !== screen) return;
    clear(); content.append(el('h1','工作空间'),el('p',data.name),el('p',location.origin),el('p',data.user.name));
    content.append(el('h2','当前账号登录的设备'));
    for (const device of info.devices || []) content.append(el('p',[device.label, device.lastAddress?.replace(/^::ffff:/i,'')].filter(Boolean).join(' · ')+(device.id === info.deviceId ? ' · 当前设备' : '')));
    return;
  }
  if (selection) await detail();
  else listing();
}
byId("logout").onclick = async () => {
  try {
    if (!(await confirmAction("确定退出当前账号"))) return;
    await api("/logout", {});
    location.replace("/signed-out");
  } catch (e) {
    report(e);
  }
};
function listing() {
  clear();
  content.append(el("h1", names[tab]));
  if (tab !== "inbox")
    content.append(
      button(
        tab === "chats"
          ? "发起沟通"
          : tab === "tasks"
            ? "创建任务"
            : "创建自动化",
        compose,
        true,
      ),
    );
  if (!model[tab].length)
    content.append(
      el("p", tab === "inbox" ? "当前没有需要你处理的事项。" : "暂无记录。"),
    );
  for (const row of model[tab]) {
    const b = button(row.title || row.name, async () => {
      selection = { type: tab === "inbox" ? "tasks" : tab, id: row.id };
      await detail();
    });
    b.className = "row";
    b.append(
      el(
        "small",
        states[row.status] ||
          row.status ||
          row.preview ||
          (row.cron
            ? row.cron + (row.enabled ? " · 已启用" : " · 已停用")
            : ""),
      ),
    );
    content.append(b);
  }
}
function compose() {
  clear();
  editing = true;
  const type = tab;
  content.append(
    button("返回", listing),
    el(
      "h1",
      type === "chats"
        ? "发起沟通"
        : type === "tasks"
          ? "创建任务"
          : "创建自动化",
    ),
  );
  const agents = model.agents.filter((a) => a.status === "active");
  if (type === "chats") {
    const kind = select("会话", [
      { id: "agent", name: "私聊" },
      { id: "group", name: "群聊" },
    ]);
    const employee = select("私聊员工", agents),
      name = field("群聊名称"),
      members = choices("群聊员工", agents);
    content.append(
      button(
        "打开会话",
        async () => {
          const chat = await api(
            "/chats",
            kind.value === "agent"
              ? { kind: "agent", targetId: employee.value }
              : { kind: "group", name: name.value, memberAgentIds: members() },
          );
          selection = { type, id: chat.id };
          await reload();
        },
        true,
      ),
    );
    return;
  }
  const title = field("名称"),
    objective = field("目标", "area"),
    manager = select("负责协调的数字员工", agents);
  const people = choices("参与员工", agents),
    teams = choices(
      "参与团队",
      model.teams.filter((t) => t.status === "active"),
    );
  const flow = select("工作流", [
      { id: "", name: "默认协作" },
      ...model.workflowTemplates,
    ]),
    criteria = field("验收标准（每行一条）", "area");
  const cron =
    type === "automations"
      ? field("执行计划（Cron）", "text", "0 9 * * *")
      : null;
  content.append(
    button(
      "创建",
      async () => {
        const input = {
          title: title.value,
          objective: objective.value,
          managerAgentId: manager.value,
          memberAgentIds: [...new Set([manager.value, ...people()])],
          teamIds: teams(),
          workflowTemplateId: flow.value || null,
          acceptanceCriteria: criteria.value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        };
        if (cron) {
          input.cron = cron.value;
          input.enabled = true;
        }
        const item = await api("/" + type, input);
        selection = { type, id: item.id };
        await reload();
      },
      true,
    ),
  );
}
function share(resource) {
  clear();
  editing = true;
  const path = "/" + selection.type + "/" + selection.id;
  content.append(button("返回", detail), el("h1", "成员权限"));
  const owner = select("负责人", model.members, resource.access.ownerId);
  const controls = model.members
    .filter((m) => m.id !== resource.access.createdBy)
    .map((m) => [
      m.id,
      select(
        m.name,
        [
          { id: "", name: "未授权" },
          { id: "view", name: "仅查看" },
          { id: "operate", name: "可处理" },
        ],
        resource.access.grants[m.id] || "",
      ),
    ]);
  content.append(
    button(
      "保存权限",
      async () => {
        await api(path + "/share", {
          ownerId: owner.value,
          grants: Object.fromEntries(
            controls.filter(([, s]) => s.value).map(([id, s]) => [id, s.value]),
          ),
        });
        await reload();
      },
      true,
    ),
  );
}
async function detail() {
  const { type, id } = selection,
    gen = ++screen,
    path = "/" + type + "/" + id;
  const data = await api(path);
  if (gen !== screen) return;
  const resource = model[type].find((r) => r.id === id) || data;
  clear();
  content.append(
    button("返回列表", async () => {
      selection = null;
      await reload();
    }),
    el("h1", resource.title || resource.name),
  );
  const op = (name, action, args = {}, confirmFirst = false) =>
    button(name, async () => {
      if (confirmFirst && !(await confirmAction(name))) return;
      await api(path + "/" + action, { runId: data.runId, ...args });
      await reload();
    });
  if (
    resource.role === "manage" &&
    model.mode === "cloud" &&
    resource.kind !== "agent" &&
    resource.kind !== "automation"
  )
    content.append(button("成员权限", () => share(resource)));
  if (type === "automations") {
    content.append(el("p", resource.cron));
    if (resource.role !== "view")
      content.append(
        op(resource.enabled ? "停用" : "启用", "enabled", {
          enabled: !resource.enabled,
        }),
        op("立即执行", "trigger", {}, true),
      );
    for (const run of data.items || []) {
      if (run.taskId)
        content.append(
          button(run.taskTitle || run.createdAt, async () => {
            selection = { type: "tasks", id: run.taskId };
            await detail();
          }),
        );
    }
    return;
  }
  const canWrite = resource.role !== "view";
  if (type === "tasks") {
    content.append(
      el("p", data.objective),
      el("small", states[data.status] || data.status),
    );
    if (canWrite) {
      if (!data.runId) content.append(op("启动任务", "start"));
      if (data.status === "awaiting_acceptance")
        content.append(op("确认验收", "confirm", {}, true));
      if (
        ["planning", "running", "awaiting_human", "review"].includes(
          data.status,
        )
      )
        content.append(op("暂停", "pause"));
      if (data.runStatus === "failed")
        content.append(op("重试", "retry", {}, true));
      if (data.status === "paused") content.append(op("继续", "resume"));
    }
  }
  const history = el("section"),
    seen = new Set();
  const renderMessages = (items) =>
    items
      .filter((m) => !seen.has(m.id))
      .map((msg) => {
        seen.add(msg.id);
        const article = el("article");
        article.append(
          el("small", msg.sender?.name || ""),
          el("div", msg.content),
        );
        return article;
      });
  let cursor = data.nextBefore;
  const older = button("更早的消息", async () => {
    const page = await api(path + "?before=" + encodeURIComponent(cursor));
    history.prepend(...renderMessages(page.messages));
    cursor = page.nextBefore;
    older.hidden = !page.hasMore;
    editing = true;
  });
  older.hidden = !data.hasMore;
  history.append(...renderMessages(data.messages || []));
  content.append(older, history);
  if (
    canWrite &&
    (type === "chats" || (data.runId && data.kind !== "automation"))
  ) {
    const questions = data.questions || [];
    const target = questions.length
      ? select(
          "回复问题",
          questions.map((q) => ({ id: q.id, name: q.content })),
        )
      : null;
    const draftKey = "draft:" + model.user.id + ":" + path;
    const draft = field("消息", "area", sessionStorage.getItem(draftKey) || "");
    let requestId =
      sessionStorage.getItem(draftKey + ":id") || newRequestId();
    draft.oninput = () => {
      sessionStorage.setItem(draftKey, draft.value);
      requestId = newRequestId();
      sessionStorage.setItem(draftKey + ":id", requestId);
    };
    content.append(
      button(
        "发送",
        async () => {
          sessionStorage.setItem(draftKey + ":id", requestId);
          await api(path + "/messages", {
            runId: data.runId,
            content: draft.value,
            clientRequestId: requestId,
            ...(target ? { replyToMessageId: target.value } : {}),
          });
          sessionStorage.removeItem(draftKey);
          sessionStorage.removeItem(draftKey + ":id");
          await reload();
        },
        true,
      ),
    );
  }
}
async function refresh() {
  if (
    !model ||
    editing ||
    busy ||
    document.hidden ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
  )
    return;
  try {
    const generation = screen;
    const snapshot = await api(
      selection ? "/" + selection.type + "/" + selection.id : "/workspace",
    );
    if (screen !== generation) return;
    const key = JSON.stringify(snapshot);
    if (changed !== key) {
      await reload();
      changed = key;
    }
    status.textContent = "";
  } catch (e) {
    if (e.status === 401) login();
    if (e.status === 403) {
      selection = null;
      await reload();
    }
    report(e);
  }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});
window.addEventListener("online", refresh);
window.addEventListener("offline", () => report(Error("当前离线")));
setInterval(refresh, 5000);
try {
  await reload();
} catch (e) {
  if (!model) login();
  if (e.status !== 401 || !e.message.includes("请登录")) report(e);
}
