const body = document.querySelector("#body"),
  status = document.querySelector("#status");
function node(tag, text) {
  const el = document.createElement(tag);
  el.textContent = text || "";
  return el;
}
async function request(action, data) {
  const r = await fetch(
    "/api/phone/" + action,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const value = await r.json();
  if (!r.ok) throw Error(value.error);
  return value;
}
function button(text, fn) {
  const b = node("button", text);
  b.onclick = async () => {
    b.disabled = true;
    try {
      status.textContent = "";
      await fn();
    } catch (e) {
      status.textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
  return b;
}
async function render() {
  const settings = await request("status");
  body.replaceChildren();
  if (settings.error) {
    status.textContent = settings.error;
    return;
  }
  if (!settings.origin) {
    const address = node("input");
    address.value = settings.suggested;
    const label = node("label", "手机访问地址");
    label.append(address);
    const relay = node("input");
    relay.type = "checkbox";
    const option = node("label", "使用已配置的 SSH Relay");
    option.append(relay);
    body.append(
      label,
      option,
      button("启用手机连接", async () => {
        await request("enable", {
          origin: address.value.trim(),
          relay: relay.checked,
        });
        await render();
      }),
    );
    return;
  }
  body.append(
    node("p", settings.origin),
    button("生成配对码", async () => {
      const pair = await request("pair", {});
      const img = node("img");
      img.src = pair.qr;
      img.alt = "Baton 一次性配对码";
      const link = node("input");
      link.readOnly = true;
      link.value = pair.link;
      link.onclick = () => link.select();
      panel.replaceChildren(
        img,
        node("p", "在 iPhone 的 Baton 中扫码，或粘贴链接。五分钟内有效。"),
        link,
      );
    }),
  );
  const panel = node("div");
  body.append(panel, node("h2", "已授权设备"));
  for (const item of (await request("devices")).items) {
    const row = node("p", item.label + " · " + item.id.slice(0, 8) + " ");
    row.append(
      button("撤销", async () => {
        await request("revoke", { id: item.id });
        await render();
      }),
    );
    body.append(row);
  }
  body.append(button("刷新设备", render));
}
render().catch((e) => (status.textContent = e.message));
