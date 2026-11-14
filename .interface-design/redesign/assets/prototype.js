/* AgentForge 重设计原型外壳：风格切换、侧栏、命令面板与通用交互。
   纯展示脚本，不连接后端；所有数据为示例。
   URL 参数：style=graphite|paper|command  mode=light|dark  density=compact|comfortable
             embed=1（嵌入总览时隐藏设计控制条） dialog=<id> drawer=<id> tab=<id> view=<id> */
(function () {
  const STORE_KEY = 'agentforge.redesign.v3';   // v3：方向改为 A · 石墨（2026-11-13），旧偏好不再沿用
  const STYLES = { graphite: 'A · 石墨（已选定）', paper: 'B · 纸张', command: 'C · 夜航' };
  const DEFAULT_MODE = { graphite: 'light', paper: 'light', command: 'dark' };
  const params = new URLSearchParams(location.search);
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } })();
  const style = STYLES[params.get('style')] ? params.get('style') : (STYLES[saved.style] ? saved.style : 'graphite');
  const mode = ['light', 'dark'].includes(params.get('mode')) ? params.get('mode') : (['light', 'dark'].includes(saved.mode) && saved.style === style ? saved.mode : DEFAULT_MODE[style]);
  const density = ['compact', 'comfortable'].includes(params.get('density')) ? params.get('density') : (saved.density || '');
  const embed = params.get('embed') === '1';
  const root = document.documentElement;
  root.dataset.style = style;
  root.dataset.mode = mode;
  if (density) root.dataset.density = density;
  if (embed) root.dataset.embed = '1';

  /** 保存偏好并刷新当前页（仅非嵌入模式）。 */
  function persist(next) {
    const value = { style: root.dataset.style, mode: root.dataset.mode, density: root.dataset.density || '', ...next };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(value)); } catch { /* 文件协议下可能不可用，忽略 */ }
    const url = new URL(location.href);
    for (const key of ['style', 'mode', 'density']) {
      if (value[key]) url.searchParams.set(key, value[key]); else url.searchParams.delete(key);
    }
    location.replace(url.toString());
  }

  const NAV = [
    { group: '工作', items: [
      { id: 'inbox', label: '待我处理', icon: 'inbox', href: 'inbox.html', badge: 3, tone: 'attention' },
      { id: 'tasks', label: '任务', icon: 'tasks', href: 'tasks.html' },
      { id: 'automations', label: '自动化', icon: 'clock', href: 'automations.html' },
      { id: 'chat', label: '沟通', icon: 'message', href: 'chat.html', badge: 2, tone: 'accent' },
    ] },
    { group: '组织', items: [
      { id: 'teams', label: '团队', icon: 'users', href: 'teams.html' },
      { id: 'workflows', label: '工作流', icon: 'workflow', href: 'workflows.html' },
      { id: 'agents', label: '数字员工', icon: 'bot', href: 'agents.html' },
      { id: 'roles', label: '角色', icon: 'idcard', href: 'roles.html' },
    ] },
    { group: '扩展', items: [
      { id: 'plugins', label: '插件', icon: 'plug', href: 'plugins.html' },
      { id: 'mcp', label: 'MCP', icon: 'mcp', href: 'mcp.html' },
    ] },
  ];
  const PAGES = [
    ['login.html', '登录 / 首次设置'], ['inbox.html', '待我处理'], ['tasks.html', '任务中心'], ['task.html', '任务工作区'],
    ['automations.html', '自动化'], ['automation.html', '自动化详情'], ['chat.html', '沟通'], ['teams.html', '团队'],
    ['workflows.html', '工作流'], ['workflow-editor.html', '工作流编辑器'], ['agents.html', '数字员工'], ['roles.html', '角色'],
    ['plugins.html', '插件'], ['mcp.html', 'MCP'], ['settings.html', '设置'], ['states.html', '组件与状态'],
  ];

  /** 渲染一个侧栏导航项。 */
  function navItem(item, active) {
    const badge = item.badge ? `<span class="nav-badge nav-badge--${item.tone || 'neutral'}" aria-label="${item.badge} 项">${item.badge}</span>` : '';
    return `<a class="nav-item ${item.id === active ? 'is-active' : ''}" href="${item.href}" ${item.id === active ? 'aria-current="page"' : ''} title="${item.label}">${icon(item.icon)}<span class="nav-label">${item.label}</span>${badge}</a>`;
  }

  /** 渲染应用侧栏（与 macOS hiddenInset 标题栏一体化）。 */
  function renderSidebar(host) {
    const active = document.body.dataset.page;
    host.innerHTML = `
      <div class="sb-top">
        <span class="traffic" aria-hidden="true"><i></i><i></i><i></i></span>
        <button class="btn btn--ghost btn--icon btn--sm sb-collapse" type="button" aria-label="收起侧栏" title="收起侧栏 ⌘\\">${icon('sidebar')}</button>
      </div>
      <div class="sb-brand">
        <img src="../../../web/icons/application-ui.png" alt="" width="20" height="20">
        <strong>AgentForge</strong>
        <a class="btn btn--ghost btn--icon btn--sm" href="tasks.html?dialog=new-task" data-open="dialog-new-task" aria-label="新建任务" title="新建任务  C">${icon('edit')}</a>
      </div>
      <button class="sb-search" type="button" data-open="palette">${icon('search')}<span>搜索或执行命令</span><kbd class="kbd">⌘K</kbd></button>
      <nav class="sb-nav" aria-label="主导航">
        ${NAV.map((group) => `<div class="sb-section"><p class="sb-label">${group.group}</p>${group.items.map((item) => navItem(item, active)).join('')}</div>`).join('')}
      </nav>
      <div class="sb-spacer"></div>
      <div class="sb-footer">
        ${navItem({ id: 'settings', label: '设置', icon: 'settings', href: 'settings.html' }, active)}
        <div class="sb-user" title="实时同步：已连接">
          <span class="av av--24 av-system">管</span>
          <span class="sb-user__text"><strong>管理员</strong><small>本机工作区</small></span>
          <span class="sync" aria-label="实时同步已连接"><i></i>已同步</span>
        </div>
      </div>`;
  }

  /** 全局命令面板：键盘优先的跳转与操作入口。 */
  function renderPalette() {
    const wrap = document.createElement('div');
    wrap.className = 'overlay overlay--palette';
    wrap.id = 'palette';
    wrap.innerHTML = `
      <div class="palette" role="dialog" aria-modal="true" aria-label="命令面板">
        <label class="palette__input">${icon('search', 'icon--lg')}<input placeholder="搜索任务、员工，或输入命令…" aria-label="搜索或输入命令"><kbd class="kbd">esc</kbd></label>
        <div class="palette__list" role="listbox">
          <p class="palette__group">快速操作</p>
          <a class="palette__item is-active" href="tasks.html?dialog=new-task">${icon('plus')}<span>新建任务</span><span class="palette__hint"><kbd class="kbd">C</kbd></span></a>
          <a class="palette__item" href="automations.html">${icon('clock')}<span>新建自动化</span><span class="palette__hint"><kbd class="kbd">⇧</kbd><kbd class="kbd">C</kbd></span></a>
          <a class="palette__item" href="chat.html">${icon('message')}<span>发起沟通</span><span class="palette__hint"><kbd class="kbd">M</kbd></span></a>
          <p class="palette__group">跳转</p>
          <a class="palette__item" href="inbox.html">${icon('inbox')}<span>待我处理</span><span class="palette__meta">3 项</span><span class="palette__hint"><kbd class="kbd">G</kbd><kbd class="kbd">I</kbd></span></a>
          <a class="palette__item" href="tasks.html">${icon('tasks')}<span>任务</span><span class="palette__hint"><kbd class="kbd">G</kbd><kbd class="kbd">T</kbd></span></a>
          <a class="palette__item" href="agents.html">${icon('bot')}<span>数字员工</span><span class="palette__hint"><kbd class="kbd">G</kbd><kbd class="kbd">E</kbd></span></a>
          <a class="palette__item" href="settings.html">${icon('settings')}<span>设置</span><span class="palette__hint"><kbd class="kbd">⌘</kbd><kbd class="kbd">,</kbd></span></a>
          <p class="palette__group">最近任务</p>
          <a class="palette__item" href="task.html">${icon('st-attention', 'st st-attention')}<span>重构登录页并补齐单元测试</span><span class="palette__meta">等待你的澄清</span></a>
          <a class="palette__item" href="task.html">${icon('st-review', 'st st-attention')}<span>Q4 竞品调研报告</span><span class="palette__meta">待你验收</span></a>
          <a class="palette__item" href="task.html">${icon('st-failed', 'st st-failed')}<span>修复导出 CSV 编码问题</span><span class="palette__meta">错误中断</span></a>
        </div>
        <div class="palette__foot"><span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> 选择</span><span><kbd class="kbd">↵</kbd> 打开</span><span><kbd class="kbd">esc</kbd> 关闭</span></div>
      </div>`;
    document.body.append(wrap);
  }

  /** 设计稿控制条：切换风格、模式、密度与页面（嵌入模式隐藏）。 */
  function renderDesignControls() {
    if (embed) return;
    // 控制条只属于设计稿，不是产品界面，所以样式由脚本注入而不进入组件层
    const style = document.createElement('style');
    style.id = 'af-design-controls';
    style.textContent = `.dc { position: fixed; left: 12px; bottom: 12px; z-index: 300; font: 12px/1.4 var(--font-sans); color: #F3F4F6; }
.dc__toggle { height: 28px; padding: 0 12px; border: 1px solid rgba(255, 255, 255, .14); border-radius: 14px; background: rgba(20, 21, 26, .92); color: #F3F4F6; font-size: 12px; box-shadow: 0 6px 20px rgba(0, 0, 0, .25); backdrop-filter: blur(8px); }
.dc__panel { position: absolute; left: 0; bottom: 36px; width: 380px; padding: 10px; border: 1px solid rgba(255, 255, 255, .12); border-radius: 12px; background: rgba(20, 21, 26, .96); box-shadow: 0 16px 40px rgba(0, 0, 0, .35); }
.dc__row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 5px 0; }
.dc__row > span { width: 34px; color: #9DA1AB; }
.dc__row button, .dc__row select { height: 26px; padding: 0 9px; border: 1px solid rgba(255, 255, 255, .12); border-radius: 7px; background: transparent; color: #E6E7EA; font-size: 12px; }
.dc__row button.on { background: #F3F4F6; color: #111; border-color: #F3F4F6; }
.dc__row a { color: #9DB4FF; margin-left: auto; }
[data-embed="1"] .dc { display: none; }`;
    document.head.append(style);
    const current = location.pathname.split('/').pop();
    const bar = document.createElement('div');
    bar.className = 'dc';
    bar.innerHTML = `
      <button class="dc__toggle" type="button" aria-expanded="false" title="设计稿控制（D）">设计稿 · ${STYLES[style]}</button>
      <div class="dc__panel" hidden>
        <div class="dc__row"><span>风格</span>${Object.entries(STYLES).map(([id, label]) => `<button type="button" data-set-style="${id}" class="${id === style ? 'on' : ''}">${label}</button>`).join('')}</div>
        <div class="dc__row"><span>模式</span><button type="button" data-set-mode="light" class="${mode === 'light' ? 'on' : ''}">浅色</button><button type="button" data-set-mode="dark" class="${mode === 'dark' ? 'on' : ''}">深色</button></div>
        <div class="dc__row"><span>密度</span><button type="button" data-set-density="" class="${!density ? 'on' : ''}">风格默认</button><button type="button" data-set-density="compact" class="${density === 'compact' ? 'on' : ''}">紧凑</button><button type="button" data-set-density="comfortable" class="${density === 'comfortable' ? 'on' : ''}">舒适</button></div>
        <div class="dc__row"><span>页面</span><select aria-label="跳转页面">${PAGES.map(([href, label]) => `<option value="${href}" ${href === current ? 'selected' : ''}>${label}</option>`).join('')}</select><a href="../index.html">设计总览 ↗</a></div>
      </div>`;
    document.body.append(bar);
    const toggle = bar.querySelector('.dc__toggle'), panel = bar.querySelector('.dc__panel');
    const flip = () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); };
    toggle.addEventListener('click', flip);
    bar.querySelector('select').addEventListener('change', (event) => { location.href = event.target.value; });
    bar.addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.setStyle) persist({ style: target.dataset.setStyle, mode: DEFAULT_MODE[target.dataset.setStyle] });
      if (target.dataset.setMode) persist({ mode: target.dataset.setMode });
      if (target.dataset.setDensity !== undefined) persist({ density: target.dataset.setDensity });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'd' && !event.metaKey && !event.ctrlKey && !/input|textarea|select/i.test(document.activeElement.tagName)) flip();
    });
  }

  /** 打开浮层（弹窗/抽屉/命令面板）。 */
  function openLayer(id) {
    const layer = document.getElementById(id);
    if (!layer) return false;
    layer.classList.add('is-open');
    layer.dataset.returnFocus = document.activeElement?.id || '';
    // 抽屉只读为主，聚焦抽屉本身；弹窗聚焦标记的输入框或第一个输入控件
    if (layer.classList.contains('drawer') && !layer.hasAttribute('tabindex')) layer.tabIndex = -1;
    const focusTarget = layer.querySelector('[data-autofocus]') || (layer.classList.contains('drawer') ? layer : layer.querySelector('input, textarea, button'));
    setTimeout(() => focusTarget?.focus({ preventScroll: true }), 30);
    return true;
  }
  /** 关闭浮层。 */
  function closeLayer(layer) { layer?.classList.remove('is-open'); }
  function closeMenus(except) { document.querySelectorAll('.menu.is-open').forEach((menu) => { if (menu !== except) menu.classList.remove('is-open'); }); }

  /** 绑定页面通用交互。 */
  function bindInteractions() {
    document.addEventListener('click', (event) => {
      const opener = event.target.closest('[data-open]');
      // 卡片整体可点击打开详情时，卡片内的按钮 / 链接只执行自己的操作
      const control = event.target.closest('button, a, input, select, textarea, [data-menu]');
      if (opener && !(control && control !== opener && opener.contains(control))) {
        if (openLayer(opener.dataset.open)) { event.preventDefault(); return; }
      }
      const closer = event.target.closest('[data-close]');
      if (closer) { closeLayer(closer.closest('.overlay, .drawer')); return; }
      if (event.target.classList.contains('overlay') && !event.target.hasAttribute('data-explicit-close')) { closeLayer(event.target); return; }
      const menuTrigger = event.target.closest('[data-menu]');
      if (menuTrigger) {
        const menu = document.getElementById(menuTrigger.dataset.menu);
        if (menu) {
          const opening = !menu.classList.contains('is-open');
          closeMenus(menu);
          menu.classList.toggle('is-open', opening);
          if (opening) {
            const rect = menuTrigger.getBoundingClientRect();
            const width = menu.offsetWidth || 220;
            const left = Math.min(Math.max(8, rect.right - width), innerWidth - width - 8);
            const top = rect.bottom + 4 + menu.offsetHeight > innerHeight ? rect.top - menu.offsetHeight - 4 : rect.bottom + 4;
            Object.assign(menu.style, { position: 'fixed', left: left + 'px', top: top + 'px' });
          }
          event.preventDefault();
          return;
        }
      }
      if (!event.target.closest('.menu')) closeMenus();
      const tab = event.target.closest('[data-tab]');
      if (tab) activateTab(tab);
      const seg = event.target.closest('.seg__item');
      if (seg) {
        seg.parentElement.querySelectorAll('.seg__item').forEach((item) => { item.classList.toggle('is-active', item === seg); item.setAttribute('aria-pressed', String(item === seg)); });
        if (seg.dataset.view) {
          const scope = seg.closest('[data-view-scope]') || document;
          scope.querySelectorAll('[data-view-panel]').forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== seg.dataset.view; });
        }
      }
      const toggle = event.target.closest('[data-toggle-class]');
      if (toggle) {
        const target = document.querySelector(toggle.dataset.target);
        target?.classList.toggle(toggle.dataset.toggleClass);
        toggle.setAttribute('aria-pressed', String(target?.classList.contains(toggle.dataset.toggleClass)));
      }
      const sw = event.target.closest('.switch');
      if (sw && !sw.hasAttribute('disabled')) { sw.classList.toggle('is-on'); sw.setAttribute('aria-checked', String(sw.classList.contains('is-on'))); }
      const row = event.target.closest('[data-selectable]');
      if (row && !event.target.closest('button, a')) {
        row.parentElement.querySelectorAll('[data-selectable]').forEach((item) => item.classList.toggle('is-selected', item === row));
        if (row.dataset.selectTarget) row.closest('[data-view-scope]')?.querySelectorAll('[data-select-panel]').forEach((panel) => { panel.hidden = panel.dataset.selectPanel !== row.dataset.selectTarget; });
      }
      const tree = event.target.closest('.tree__item[data-folder]');
      if (tree) { tree.classList.toggle('is-open'); const kids = tree.nextElementSibling; if (kids?.classList.contains('tree__kids')) kids.hidden = !tree.classList.contains('is-open'); }
    });
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const palette = document.getElementById('palette');
        palette.classList.contains('is-open') ? closeLayer(palette) : openLayer('palette');
      }
      if (event.key === 'Escape') {
        closeMenus();
        const open = [...document.querySelectorAll('.overlay.is-open, .drawer.is-open')].pop();
        if (open && !open.hasAttribute('data-explicit-close')) closeLayer(open);
      }
    });
  }

  /** 激活同组页签，并切换对应面板。 */
  function activateTab(tab) {
    let group = tab.closest('[data-tab-group]');
    if (!group) {
      // 页签组外的跳转入口（如「查看控制台日志」）：转发给同名页签
      const primary = document.querySelector(`[data-tab-group] [data-tab="${tab.dataset.tab}"]`);
      if (!primary) return;
      tab = primary;
      group = primary.closest('[data-tab-group]');
    }
    const scope = group.closest('[data-tab-scope]') || document;
    group.querySelectorAll('[data-tab]').forEach((item) => {
      const on = item === tab;
      item.classList.toggle('is-active', on);
      item.setAttribute('aria-selected', String(on));
    });
    scope.querySelectorAll(`[data-tab-panel][data-group="${group.dataset.tabGroup}"]`).forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== tab.dataset.tab; });
  }

  /** 按 URL 参数打开深链状态，便于在总览中直接对比某个状态。 */
  function applyDeepLinks() {
    const tab = params.get('tab');
    if (tab) document.querySelectorAll(`[data-tab="${tab}"]`).forEach(activateTab);
    const view = params.get('view');
    if (view) document.querySelector(`.seg__item[data-view="${view}"]`)?.click();
    for (const key of ['dialog', 'drawer']) {
      const id = params.get(key);
      if (id) openLayer(`${key}-${id}`);
    }
    if (params.get('palette') === '1') openLayer('palette');
  }

  /** 把 <i data-icon="name"> 占位替换为 SVG 图标。 */
  function hydrateIcons() {
    document.querySelectorAll('i[data-icon]').forEach((node) => {
      const holder = document.createElement('span');
      holder.innerHTML = icon(node.dataset.icon, node.className);
      const svg = holder.firstElementChild;
      if (svg) { if (node.title) svg.setAttribute('aria-label', node.title); node.replaceWith(svg); }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.querySelector('[data-shell="sidebar"]');
    if (sidebar) renderSidebar(sidebar);
    hydrateIcons();
    renderPalette();
    renderDesignControls();
    bindInteractions();
    applyDeepLinks();
    document.body.classList.add('is-ready');
  });
})();
