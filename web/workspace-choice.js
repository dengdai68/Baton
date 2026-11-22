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
  const menu = document.querySelector('#workspace-list');
  const status = new Map();
  let selected = 'local', generation = 0;
  const localOrigin = document.querySelector('meta[name="baton-workspace-origin"]')?.content;
  const localCaption = localOrigin ? localOrigin+' ('+$t("本机")+')' : $t("本机工作空间");
  const caption = origin => origin === 'local' ? localCaption : origin;

  function paint(button, origin) {
    const state = status.get(origin);
    const label = caption(origin);
    button.querySelector('.workspace-origin').textContent = label;
    button.querySelector('.workspace-dot').dataset.state = state || 'pending';
    const health = state === undefined ? $t("检测中") : state === 'ready' ? $t("健康") : $t("无法连接");
    button.setAttribute('aria-label',label+' · '+health);
    button.title = label;
  }
  async function refresh() {
    const current = ++generation;
    await Promise.all(Array.from(menu.querySelectorAll('.workspace-pick'), async button => {
      const origin = button.dataset.origin;
      const state = await host.workspaceHealth(origin).catch(() => 'offline');
      if (current !== generation) return;
      status.set(origin,state);
      paint(button,origin);
      if (selected === origin) paint(select,origin);
    }));
  }
  function menuButton(className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    return button;
  }
  function render(choices) {
    selected = choices.selected;
    paint(select,selected);
    const rows = ['local', ...choices.addresses].map(origin => {
      const row = document.createElement('div');
      row.className = 'workspace-row';
      const pick = menuButton('workspace-pick');
      pick.dataset.origin = origin;
      pick.setAttribute('aria-pressed',String(selected === origin));
      pick.append(select.querySelector('.workspace-dot').cloneNode(false),select.querySelector('.workspace-origin').cloneNode(false));
      paint(pick,origin);
      row.append(pick);
      if (origin !== 'local') {
        const remove = menuButton('workspace-remove');
        remove.dataset.origin = origin;
        remove.textContent = '−';
        remove.title = $t("移除")+' '+origin;
        remove.setAttribute('aria-label',remove.title);
        row.append(remove);
      }
      return row;
    });
    const addRow = menuButton('workspace-add-row');
    addRow.textContent = '＋ '+$t("添加工作空间");
    menu.replaceChildren(...rows,addRow);
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
  menu.addEventListener('toggle',event => {
    const open = event.newState === 'open';
    select.setAttribute('aria-expanded',String(open));
    if (open) {
      menu.querySelector('[aria-pressed="true"]')?.focus();
      void refresh();
    }
  });
  menu.addEventListener('keydown',event => {
    if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...menu.querySelectorAll('.workspace-pick,.workspace-add-row')];
    const index = items.findIndex(item => item === event.target || item.parentElement === event.target.parentElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next].focus();
  });
  menu.addEventListener('click',async event => {
    const button = event.target.closest('button');
    if (!button || select.disabled) return;
    menu.hidePopover();
    select.focus();
    if (button.classList.contains('workspace-add-row')) {
      address.value = ''; document.querySelector('#address-error').textContent = '';
      dialog.showModal(); address.focus(); return;
    }
    const origin = button.dataset.origin;
    const remove = button.classList.contains('workspace-remove');
    select.disabled = true; submit.disabled = true;
    try {
      const choices = await host.workspaceChoices(origin,remove ? 'remove' : 'select');
      if (remove) status.delete(origin);
      render(choices);
    } catch { form.querySelector('[role=alert]').textContent = $t("保存失败，已恢复原设置；请重新选择。"); }
    finally { select.disabled = false; submit.disabled = false; select.focus(); }
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
