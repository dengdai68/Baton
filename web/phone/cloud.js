document.querySelector("form").onsubmit = (event) => {
  event.preventDefault();
  let target;
  try { target = new URL(document.querySelector("input").value); } catch {
    document.querySelector("[role=status]").textContent = "请输入完整的 HTTPS 工作空间地址。";
    return;
  }
  if (target.protocol !== "https:" || target.username || target.password) {
    document.querySelector("[role=status]").textContent =
      "请输入 HTTPS 工作空间地址。";
    return;
  }
  window.location.assign(target.origin);
};
