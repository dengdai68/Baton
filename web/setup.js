import { $t, $tm, localizeStatic } from "/client/i18n.mjs";
// Static page text is translated once before the scripted states below replace parts of it.
localizeStatic(document.documentElement);
const form = document.querySelector("#setup-form"), password = document.querySelector("#password"), confirmation = document.querySelector("#confirmation"), error = document.querySelector("#setup-error"), submit = form.querySelector(".submit");
document.querySelector("#toggle-password").addEventListener("click", event => {
  const show = password.type === "password";
  password.type = show ? "text" : "password";
  confirmation.type = show ? "text" : "password";
  event.currentTarget.textContent = show ? $t("隐藏") : $t("显示");
  event.currentTarget.setAttribute("aria-label", show ? $t("隐藏密码") : $t("显示密码"));
  event.currentTarget.setAttribute("aria-pressed", String(show));
});
form.addEventListener("input", () => { password.removeAttribute("aria-invalid"); confirmation.removeAttribute("aria-invalid"); error.textContent = ""; });
form.addEventListener("submit", async event => {
  event.preventDefault(); if (submit.disabled) return;
  error.textContent = "";
  if (password.value !== confirmation.value) { error.textContent = $t("两次输入的密码不一致。"); confirmation.setAttribute("aria-invalid", "true"); confirmation.focus(); return; }
  submit.disabled = true; submit.textContent = $t("正在创建…");
  try {
    const response = await fetch("/api/auth/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: form.username.value.trim(), password: password.value }) });
    const body = await response.json();
    if (!response.ok) throw new Error($tm(body.error) || $t("创建管理员失败，请重试"));
    location.replace("/");
  } catch (failure) { error.textContent = failure.message || $t("网络连接失败，请重试"); password.value = ""; confirmation.value = ""; password.focus(); }
  finally { submit.disabled = false; submit.textContent = $t("创建管理员并进入工作区"); }
});
