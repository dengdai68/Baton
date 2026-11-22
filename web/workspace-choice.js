import { $t } from '/client/i18n.mjs';
const host = window.batonDesktop;
if (host?.workspaceChoices) {
  const select = document.querySelector('#workspace-mode');
  const dialog = document.querySelector('#workspace-dialog');
  const address = document.querySelector('#workspace-address');
  const add = document.querySelector('#workspace-add');
  const setup = document.querySelector('#setup-form');
  const form = setup || document.querySelector('#login-form');
  const submit = form.querySelector('.submit');
  const title = document.querySelector('h1'), originalTitle = title.textContent;
  const label = form.querySelector('[for=username]'), originalLabel = label.textContent;
  const originalSubmit = submit.textContent;
  const status = new Map();
  let selected = 'local', generation = 0;
  function caption(origin) {
    const name = origin === 'local' ? $t("本机工作空间") : origin.startsWith('http://') ? origin : new URL(origin).host;
    const state = status.get(origin);
    return (state === undefined ? '⚪️' : state === 'ready' ? '🟢' : '🔴')+' '+name;
  }
  async function refresh() {
    const current = ++generation;
    await Promise.all(Array.from(select.options).filter(option => option.value !== 'add').map(async option => {
      const ok = await host.workspaceHealth(option.value).catch(() => false);
      if (current !== generation) return;
      status.set(option.value,ok); option.textContent = caption(option.value);
      const name = option.value === 'local' ? $t("本机工作空间") : new URL(option.value).host;
      option.setAttribute('aria-label',name+' · '+(ok === 'ready' ? $t("健康") : $t("无法连接")));
    }));
  }
  function render(choices) {
    selected = choices.selected;
    const origins = ['local', ...choices.addresses];
    select.replaceChildren(...origins.map(origin => new Option(caption(origin),origin)),new Option('＋ '+$t("添加工作空间"),'add'));
    select.value = selected;
    if (setup) {
      const external = selected !== 'local';
      document.body.classList.toggle('external-setup',external);
      setup.confirmation.disabled = external;
      setup.password.autocomplete = external ? 'current-password' : 'new-password';
      title.textContent = external ? $t("登录") : originalTitle;
      label.textContent = external ? $t("用户名") : originalLabel;
      submit.textContent = external ? $t("登录") : originalSubmit;
    }
    void refresh();
  }
  render(await host.workspaceChoices());
  document.querySelector('#workspace-choice').hidden = false;
  select.addEventListener('change',async () => {
    if (select.value === 'add') {
      select.value = selected; address.value = ''; document.querySelector('#address-error').textContent = '';
      dialog.showModal(); address.focus(); return;
    }
    render(await host.workspaceChoices(select.value));
  });
  document.querySelector('#workspace-cancel').onclick = () => dialog.close();
  add.onsubmit = async event => {
    event.preventDefault();
    try {
      const raw = address.value.trim();
      const url = new URL(raw.includes('://') ? raw : 'https://'+raw);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port === '0') throw Error();
      render(await host.workspaceChoices(url.origin)); dialog.close();
    } catch { document.querySelector('#address-error').textContent = $t("请输入有效的工作空间地址"); }
  };
  form.addEventListener('submit',async event => {
    if (selected === 'local') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (submit.disabled) return;
    submit.disabled = true; select.disabled = true;
    const error = form.querySelector('[role=alert]'); error.textContent = '';
    try {
      const logout = await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      if (!logout.ok) throw Error($t("登录失败，请重试"));
      await host.openExternalWorkspace(selected,form.username.value,form.password.value);
      form.password.value = '';
    } catch (failure) {
      error.textContent = failure.message.split('Error: ').at(-1) || $t("登录失败，请重试");
    } finally { submit.disabled = false; select.disabled = false; }
  },true);
  window.addEventListener('focus',refresh);
  const timer = setInterval(() => { if (!document.hidden) void refresh(); },15000);
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
