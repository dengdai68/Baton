// Generates the pairing sequence figure used by relay/DESIGN.md (node relay/docs/diagrams.mjs).
// PNG copies for viewers that do not render SVG: relay/docs/render-png.sh.
import { writeFileSync } from "node:fs";

const FONT = "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif";
const MONO = "SF Mono, Menlo, Consolas, monospace";
const C = {
  user: ["#f3f4f6", "#6b7280"],
  relay: ["#e8f0fe", "#3b6fd8"],
  ws: ["#e7f6ec", "#2f8f4e"],
  team: ["#eef7f1", "#2f8f4e"],
  op: ["#fff4e5", "#c26a12"],
  mem: ["#ffffff", "#3b6fd8"],
  bad: ["#fdecec", "#c0392b"],
  note: ["#fffbe6", "#b8a03a"],
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textWidth = (s, size) => [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? size : size * 0.58), 0);

function svg(width, height, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">
<title>${esc(title)}</title>
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#374151"/></marker>
  <marker id="arrowBlue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3b6fd8"/></marker>
  <marker id="arrowGreen" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2f8f4e"/></marker>
  <marker id="arrowOrange" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#c26a12"/></marker>
  <marker id="arrowRed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#c0392b"/></marker>
</defs>
<rect width="100%" height="100%" fill="#ffffff"/>
${body}
</svg>
`;
}

function text(x, y, s, { size = 13, weight = 400, fill = "#111827", anchor = "start", mono = false, italic = false } = {}) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${mono ? ` font-family="${MONO}"` : ""}${italic ? ' font-style="italic"' : ""}>${esc(s)}</text>`;
}

/** A rounded box with a bold title and optional lines (strings or {t, mono, fill}). */
function box(x, y, w, h, title, lines = [], { color = C.user, dashed = false, titleSize = 14, radius = 8, tag } = {}) {
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${color[0]}" stroke="${color[1]}" stroke-width="1.5"${dashed ? ' stroke-dasharray="6 4"' : ""}/>`;
  if (title) out += text(x + 12, y + 22, title, { size: titleSize, weight: 700, fill: "#111827" });
  if (tag) {
    const tw = textWidth(tag, 11) + 12;
    out += `<rect x="${x + w - tw - 8}" y="${y + 8}" width="${tw}" height="18" rx="9" fill="${color[1]}"/>` + text(x + w - tw / 2 - 8, y + 21, tag, { size: 11, fill: "#ffffff", anchor: "middle", weight: 600 });
  }
  lines.forEach((line, i) => {
    const l = typeof line === "string" ? { t: line } : line;
    out += text(x + 12, y + (title ? 44 : 22) + i * 19, l.t, { size: l.size || 12.5, mono: l.mono, fill: l.fill || "#374151", weight: l.weight || 400 });
  });
  return out;
}

function zone(x, y, w, h, label, color) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 5"/>` +
    text(x + 14, y + 22, label, { size: 13, weight: 700, fill: color });
}

/** Polyline arrow. label placed at labelAt (x,y) with a white backing. */
function arrow(points, { color = "#374151", marker = "arrow", dashed = false, width = 1.6, label, labelAt, labelColor, both = false, labelSize = 12 } = {}) {
  const d = points.map((p, i) => (i ? "L" : "M") + p[0] + "," + p[1]).join(" ");
  let out = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${dashed ? ' stroke-dasharray="7 5"' : ""} marker-end="url(#${marker})"${both ? ` marker-start="url(#${marker})"` : ""}/>`;
  if (label) {
    const [lx, ly] = labelAt || points[Math.floor(points.length / 2)];
    const parts = Array.isArray(label) ? label : [label];
    parts.forEach((p, i) => {
      const tw = textWidth(p, labelSize) + 10;
      const yy = ly + i * (labelSize + 6);
      out += `<rect x="${lx - tw / 2}" y="${yy - labelSize}" width="${tw}" height="${labelSize + 6}" rx="3" fill="#ffffff" opacity="0.92"/>` +
        text(lx, yy + 1, p, { size: labelSize, anchor: "middle", fill: labelColor || color });
    });
  }
  return out;
}

function badge(x, y, n, color = "#111827") {
  return `<circle cx="${x}" cy="${y}" r="10" fill="${color}"/>` + text(x, y + 4, n, { size: 11.5, fill: "#fff", anchor: "middle", weight: 700 });
}

// ---------------------------------------------------------------- Main figure
function pairingSequence() {
  const W = 1200, X = { P: 170, R: 600, M: 1030 };
  const colors = { P: "#374151", R: "#3b6fd8", M: "#2f8f4e", F: "#c0392b" };
  const markers = { P: "arrow", R: "arrowBlue", M: "arrowGreen", F: "arrowRed" };
  let y = 132, rows = "", n = 0;
  const msg = (from, to, lines, { c = from, dashed = false } = {}) => {
    n++;
    const x1 = X[from], x2 = X[to];
    lines = [].concat(lines);
    lines.forEach((l, i) => rows += text((x1 + x2) / 2, y + i * 17, l, { size: 12.5, anchor: "middle", fill: colors[c], weight: i ? 400 : 600 }));
    const ay = y + (lines.length - 1) * 17 + 9;
    rows += `<line x1="${x1}" y1="${ay}" x2="${x2 + (x2 > x1 ? -2 : 2)}" y2="${ay}" stroke="${colors[c]}" stroke-width="1.8"${dashed ? ' stroke-dasharray="7 5"' : ""} marker-end="url(#${markers[c]})"/>`;
    rows += badge(Math.min(x1, x2) - 18, ay, n, colors[c]);
    y = ay + 26;
  };
  const self = (who, lines, color = C.ws) => {
    lines = [].concat(lines);
    const w = Math.max(...lines.map(l => textWidth(l, 12.5))) + 30, h = 10 + lines.length * 18;
    const x = Math.min(X[who] - w / 2, W - 20 - w);
    rows += `<rect x="${x}" y="${y - 4}" width="${w}" height="${h}" rx="6" fill="${color[0]}" stroke="${color[1]}"/>`;
    lines.forEach((l, i) => rows += text(x + w / 2, y + 12 + i * 18, l, { size: 12.5, anchor: "middle", fill: "#1f2937", weight: i ? 400 : 600 }));
    y += h + 14;
  };
  const phase = (label, color) => {
    rows += `<rect x="20" y="${y - 6}" width="${W - 40}" height="26" rx="4" fill="${color}"/>` + text(32, y + 12, label, { size: 13, weight: 700, fill: "#111827" });
    y += 38;
  };

  phase("0  外层接入（Baton 启动后一直保持）：保证只有获准的 Baton 能在 Relay 上登记路由", "#eef2f7");
  msg("M", "R", ["外层 TLS → relay.example.com（Mac 按公共 CA 验 Relay）", "客户端证书 = Mac 身份密钥 K → Relay 查只读允许名单"], { c: "M" });

  phase("A  发起：Alice 已在 Mac 登录，点「添加手机」——之后全自动", "#e7f6ec");
  self("M", ["生成一次性邀请：路由号 r · Mac 指纹 fp = SHA-256(K 公钥) · 凭据 t（256 位随机）", "baton://pair?relay=relay.example.com&r=…&fp=…&t=…    10 分钟 · 只能兑换一次"]);
  msg("M", "R", ["登记临时路由 r → 本 Mac（Relay 只拿到 r，拿不到 t 和私钥）"], { c: "M" });

  phase("B  内层端到端 TLS：在 Relay 转发的字节流里，手机与 Mac 直接握手", "#fff4e5");
  msg("P", "R", ["扫码 或 手输同一地址；手机生成设备密钥 D（钥匙串）", "外层 TLS → Relay（公共 CA），请求打开路由 r"], { c: "P" });
  msg("R", "M", ["按 r 原样转发字节；r 未登记 / 过期 / 已用 → 拒绝"], { c: "R" });
  self("M", ["内层 TLS 1.3（双向证书），Relay 只看到密文：", "手机核对 Mac 证书指纹 = fp → 确认对端是签发邀请的那台 Mac", "Mac 收到手机证书 → 握手本身证明手机持有 D 的私钥"], C.op);

  phase("C  兑换与建通道（在内层连接里）", "#e8f0fe");
  msg("P", "M", ["REDEEM t（只在内层加密里传输）"], { c: "P" });
  self("M", ["原子消费邀请：t 正确 · 未过期 · 未使用 · 签发账号仍有效 → 立即作废", "持久保存通道 c = { 账号 Alice, 设备公钥 D, Relay, 时间 }；撤销 r，登记 c"]);
  msg("M", "P", ["返回通道 c + 会话 → 手机直接以 Alice 身份进入"], { c: "M", dashed: true });

  phase("D  之后每次打开 App：同样的内层 TLS，不再需要邀请", "#eef2f7");
  msg("P", "M", ["经 Relay 打开 c → 内层 TLS：核对 fp + 出示 D", "Mac 查 c 的记录里设备公钥 = D ✓ → 会话、API、事件流全在内层"], { c: "P" });

  // failure branch
  rows += `<rect x="20" y="${y}" width="${W - 40}" height="86" rx="6" fill="${C.bad[0]}" stroke="${C.bad[1]}"/>`;
  rows += text(36, y + 22, "✕ 失败即停止，不建立通道：", { size: 13, weight: 700, fill: colors.F });
  rows += text(36, y + 44, "伪造 / 过期 / 已用的 r → Relay 拒绝 · 对端指纹 ≠ fp（假 Mac 或 Relay 中间人）→ 手机中止 · t 随机伪造 / 过期 / 重放 → Mac 拒绝", { size: 12.5, fill: "#374151" });
  rows += text(36, y + 64, "只知道 c、没有设备私钥 D → 内层握手失败 · 撤销通道后，旧手机的 D 不再被接受", { size: 12.5, fill: "#374151" });
  y += 98;
  rows += `<rect x="20" y="${y}" width="${W - 40}" height="50" rx="6" fill="${C.note[0]}" stroke="${C.note[1]}"/>`;
  rows += text(36, y + 20, "边界：首次配对时 Mac 还不认识这台手机，完整的有效链接就是授权依据。链接在兑换前泄露，先兑换的设备会成功；", { size: 12.5, fill: "#374151" });
  rows += text(36, y + 40, "系统无法识别「哪一台实体手机」。缓解：10 分钟、单次、Mac 显示「已添加 iPhone · 时间」并可一键撤销。", { size: 12.5, fill: "#374151" });
  y += 62;

  let body = text(24, 36, "Baton Relay 配对时序（草案 v2）：扫码后全自动，手机与 Mac 端到端验证设备，一次配对 = 一条通道", { size: 18, weight: 700 });
  for (const [k, label, sub, col] of [["P", "手机", "设备密钥 D 只在本机生成", C.user], ["R", "Relay（一个地址）", "只转发字节 + 内存路由", C.relay], ["M", "Mac（Alice 已登录）", "身份密钥 K · 持久授权", C.ws]]) {
    body += `<line x1="${X[k]}" y1="104" x2="${X[k]}" y2="${y - 10}" stroke="#9ca3af" stroke-width="1.2" stroke-dasharray="4 4"/>`;
    const w = 220;
    body += `<rect x="${X[k] - w / 2}" y="52" width="${w}" height="52" rx="8" fill="${col[0]}" stroke="${col[1]}" stroke-width="1.5"/>` + text(X[k], 74, label, { size: 14, weight: 700, anchor: "middle" }) + text(X[k], 93, sub, { size: 11.5, anchor: "middle", fill: "#4b5563" });
  }
  return svg(W, y + 10, body + rows, "Baton Relay 配对时序");
}

const out = new URL("./", import.meta.url);
writeFileSync(new URL("fig-relay-pairing.svg", out), pairingSequence());
console.log("fig-relay-pairing.svg");
