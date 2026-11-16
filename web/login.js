import { $t, $tm, localizeStatic } from "/client/i18n.mjs";
// Static page text is translated once before the scripted states below replace parts of it.
localizeStatic(document.documentElement);
const form = document.querySelector("#login-form"), password = document.querySelector("#password"), error = document.querySelector("#login-error"), submit = form.querySelector(".submit");
const setupGuidance = document.querySelector("#setup-guidance");
function showLogin() {
  form.hidden = false;
  document.querySelector(".intro").textContent = $t("本机工作区 · 单管理员");
  form.username.focus();
}
function showUnconfigured(status = {}) {
  form.hidden = true;
  setupGuidance.hidden = false;
  document.querySelector("#desktop-setup-guidance").hidden = false;
  document.querySelector("h1").textContent = $t("还没有管理员");
  document.querySelector(".intro").textContent = $t("请先在客户端完成本机工作区设置。");
}
fetch("/api/auth/bootstrap-status", { cache: "no-store", signal: AbortSignal.timeout(1500) })
  .then(async response => response.ok ? response.json() : null)
  .then(status => { if (status?.configured === false) showUnconfigured(status); else showLogin(); })
  .catch(showLogin);
document.querySelector("#toggle-password").addEventListener("click", event => {
  const show = password.type === "password";
  password.type = show ? "text" : "password";
  event.currentTarget.textContent = show ? $t("隐藏") : $t("显示");
  event.currentTarget.setAttribute("aria-label", show ? $t("隐藏密码") : $t("显示密码"));
  event.currentTarget.setAttribute("aria-pressed", String(show));
});
password.addEventListener("input", () => { password.removeAttribute("aria-invalid"); error.textContent = ""; });
form.addEventListener("submit", async event => {
  event.preventDefault(); if (submit.disabled) return;
  error.textContent = ""; submit.disabled = true; submit.textContent = $t("正在登录…");
  try {
    const response = await fetch("/api/auth/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username:form.username.value.trim(),password:password.value}) });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error($tm(body.error) || $t("登录失败，请重试")), { status: response.status });
    const next = new URLSearchParams(location.search).get("next") || "/";
    const target = new URL(next, location.origin);
    location.replace(target.origin === location.origin && !target.pathname.startsWith("/login") ? target.pathname + target.search + target.hash : "/");
  } catch (failure) { error.textContent = failure.message || $t("网络连接失败，请重试"); password.value = ""; password.setAttribute("aria-invalid", "true"); if (failure.status === 503) showUnconfigured(); else password.focus(); }
  finally { submit.disabled = false; submit.textContent = $t("登录"); }
});
