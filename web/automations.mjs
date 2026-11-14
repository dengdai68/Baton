import { paginationMarkup } from './pagination.mjs';

// Match the presets in the task form; arbitrary Cron stays visible verbatim.
export function automationScheduleLabel(cron) {
  const [minute,hour,day,month,week] = String(cron).trim().split(/\s+/);
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return '自定义规则';
  const time = `${hour.padStart(2,'0')}:${minute.padStart(2,'0')}`;
  if (day === '*' && month === '*') {
    if (week === '1-5') return `工作日 ${time}`;
    if (week === '*') return `每天 ${time}`;
    if (/^[0-7]$/.test(week)) return `每周${'日一二三四五六日'[Number(week)]} ${time}`;
  }
  if (/^\d+$/.test(day) && month === '*' && week === '*') return `每月 ${day} 日 ${time}`;
  return '自定义规则';
}

export function createAutomationUI({ api, esc, pill, exactTime, edit, navigate, openRun, toast, confirmDelete, catalog, showWorkflow, headerActions = null }) {
  let root, selectedId, request = 0, timer, searchTimer, loading = false, query = { search: '', status: 'all', page: 1 }, records = { status: 'all', page: 1 }, tab = 'records', mountedKey, recordOwner, loadedItems = new Map();
  const format = (value, timeZone, compact = false) => value ? timeZone ? new Intl.DateTimeFormat('zh-CN',{timeZone,...(compact ? {} : {year:'numeric'}),month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',...(!compact && {second:'2-digit'}),hour12:false}).format(new Date(value)) : exactTime(value) : '—';
  const stateLabel = record => record?.status === 'skipped' ? '<span class="status-pill">已跳过</span>' : record ? pill(record.status) : '<span class="automation-muted">尚未触发</span>';
  const durationOf = record => { if (!record.completedAt || !record.plannedAt) return '—'; const seconds = Math.max(0, Math.round((Date.parse(record.completedAt) - Date.parse(record.plannedAt)) / 1000)); if (!seconds) return '—'; const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60; return hours ? `${hours} 小时 ${minutes} 分` : minutes ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`; };
  const membersOf = item => item.memberAgentIds.map(id => catalog().agents.find(agent=>agent.id===id) || {id,name:catalog().catalogReferences ? '不可用员工' : '正在读取员工',color:'blue'});
  const avatar = agent => `<span class="agent-card-avatar color-${esc(agent.color || 'blue')}" aria-hidden="true">${esc(Array.from(agent.name || '?').slice(0,1).join('').toUpperCase())}</span>`;
  const memberStack = item => { const members=membersOf(item);return `<span class="directory-avatar-stack" data-auto-member-stack="${esc(item.id)}" title="${esc(members.map(agent=>agent.name).join('、'))}">${members.slice(0,4).map(avatar).join('')}${members.length>4?`<span class="automation-member-extra">+${members.length-4}</span>`:''}</span>`; };
  const menu = item => `<details class="automation-row-menu action-menu"><summary aria-label="${esc(item.title)} 更多操作" title="更多操作"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></summary><div class="automation-menu-items action-menu-list" role="menu"><button type="button" data-auto-trigger="${esc(item.id)}">立即执行</button><button type="button" data-auto-edit="${esc(item.id)}">编辑</button><button type="button" data-auto-clone="${esc(item.id)}">复制为新自动化</button><button type="button" class="danger" data-auto-delete="${esc(item.id)}" ${item.enabled?'disabled title="请先停用自动化，再删除"':''}>删除${item.enabled?'（请先停用）':''}</button></div></details>`;
  const actionsTarget = () => (selectedId ? root?.querySelector('[data-auto-header-actions]') : headerActions) || root?.querySelector('[data-auto-header-actions]');
  function listShell(target) {
    if (!target.querySelector('#automation-search')) target.innerHTML = `<div class="page-heading"><div><h2>自动化</h2><p>按计划重复执行任务。每轮独立记录，按你设置的规则确认完成。</p></div>${headerActions?'':'<div data-auto-header-actions></div>'}</div><form class="directory-toolbar paper-filter-toolbar" id="automation-search"><div class="directory-chips" aria-label="自动化状态"></div><input type="search" name="search" aria-label="搜索自动化" placeholder="筛选自动化" value="${esc(query.search)}"></form><div data-auto-results><div class="directory-empty is-loading" role="status" aria-busy="true"><strong>正在读取自动化</strong>计划列表正在加载。</div></div>`;
    actionsTarget().innerHTML = '<button class="primary-button" type="button" data-auto-new>＋ 新建自动化</button>';
  }
  function paintCounts(target, counts) {
    const view=target.closest?.('.view'),total=counts.find(([status])=>status==='all')?.[1];
    if(view)view.dataset.titleCount=Number.isFinite(total)?String(total):'';
    const focusedStatus=document.activeElement?.dataset.autoStatus;
    target.querySelector('.directory-chips').innerHTML=counts.map(([status,count])=>`<button type="button" class="directory-chip" data-auto-status="${status}" aria-pressed="${query.status===status}">${({all:'全部',enabled:'已启用',disabled:'已停用'})[status]} <span>${count ?? '—'}</span></button>`).join('');
    if(focusedStatus)target.querySelector(`[data-auto-status="${focusedStatus}"]`)?.focus();
  }
  async function load({ quiet = false } = {}) {
    if(quiet && loading)return;
    const target = root, id = selectedId, ticket = ++request;
    if (!target) return;
    const listQuery={...query},historyQuery={...records},selectedTab=tab;
    const current=()=>ticket===request && target===root && selectedId===id && selectedTab===tab;
    loading=true;
    if (!quiet) target.setAttribute('aria-busy','true');
    try {
      const data = id ? await api(`/api/automations/${encodeURIComponent(id)}`) : await api('/api/automations?' + new URLSearchParams(listQuery));
      if (!current()) return;
      if (quiet && (target.contains(document.activeElement) || headerActions?.contains(document.activeElement))) return;
      if (!id) {
        query.page = data.page; loadedItems = new Map(data.items.map(item=>[item.id,item]));
        listShell(target);
        const counts=['all','enabled','disabled'].map(status=>[status,status===listQuery.status?data.total:null]);
        paintCounts(target,counts);
        target.querySelector('[data-auto-results]').innerHTML = data.items.length ? `<div class="table-wrap automation-table-scroll"><table class="table task-inventory automation-table automation-directory-table"><thead><tr><th aria-label="启用"></th><th>名称</th><th>执行规则</th><th>下次执行</th><th class="automation-secondary">最近一轮</th><th class="automation-secondary">成员</th><th aria-label="更多操作"></th></tr></thead><tbody>${data.items.map(item => {
          const record = item.latestTrigger;
          const latest = record?.completion === 'automatic' ? '<span class="automation-latest" data-tone="done">已自动确认</span>' : stateLabel(record);
          return `<tr data-auto-nav="${esc(item.id)}"><td><label class="automation-switch settings-toggle"><input type="checkbox" role="switch" data-auto-enable="${esc(item.id)}" aria-label="启用 ${esc(item.title)}" ${item.enabled?'checked':''}></label></td><td><button class="text-action automation-name" data-auto-open="${esc(item.id)}" title="${esc(item.title)}">${esc(item.title)}</button><span class="automation-description" title="${esc(item.objective)}">${esc(item.objective)}</span></td><td><span class="automation-rule">${esc(automationScheduleLabel(item.cron))}</span><code>${esc(item.cron)}</code></td><td><time title="${esc(format(item.nextTriggerAt,item.timeZone))}">${item.enabled ? format(item.nextTriggerAt,item.timeZone,true) : '已停用'}</time></td><td class="automation-latest automation-secondary">${latest}</td><td class="automation-secondary">${memberStack(item)}</td><td>${menu(item)}</td></tr>`;
        }).join('')}</tbody></table></div>${paginationMarkup(data,'automations')}` : `<div class="directory-empty" role="status"><strong>${query.search || query.status !== 'all' ? '没有匹配的自动化' : '还没有自动化'}</strong>${query.search || query.status !== 'all' ? '请调整搜索条件，或清空搜索查看全部自动化。' : '点击右上角「新建自动化」添加。'}</div>`;
        const totals=await Promise.allSettled(counts.map(async ([status,count])=>[status,count ?? (await api('/api/automations?'+new URLSearchParams({...listQuery,status,page:1,pageSize:1}))).total]));
        if(!current())return;
        paintCounts(target,totals.map((result,index)=>result.status==='fulfilled'?result.value:counts[index]));
        if(totals.some(result=>result.status==='rejected'))target.querySelector('[data-auto-results]').insertAdjacentHTML('afterbegin','<p class="field-hint" role="alert">部分状态计数读取失败。<button type="button" class="text-action" data-auto-refresh>重试</button></p>');
      } else {
        const paintDetail = history => {
        const item = data.automation;
        loadedItems = new Map([[item.id,item]]);
        target.innerHTML = `<header class="automation-detail-header page-heading"><div class="automation-detail-identity"><button class="text-action" data-auto-back aria-label="返回自动化列表" title="返回自动化列表"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button><span class="automation-crumb">自动化</span><span class="automation-crumb" aria-hidden="true">/</span><h2 title="${esc(item.title)}">${esc(item.title)}</h2></div><div data-auto-header-actions></div></header><div class="automation-facts"><div><span>执行规则</span><strong>${esc(automationScheduleLabel(item.cron))}</strong><code>${esc(item.cron)}</code></div><div><span>下次执行</span><strong><time title="${esc(format(item.nextTriggerAt,item.timeZone))}">${item.enabled ? format(item.nextTriggerAt,item.timeZone,true) : '已停用'}</time></strong><small>${esc(item.timeZone || '本机时区')}</small></div><div><span>完成方式</span><strong>下一轮自动确认</strong><small>待验收记录在下一轮启动前确认</small></div><div><span>执行成员</span><div class="automation-fact-members">${memberStack(item)}<small>${membersOf(item).length} 位员工</small></div></div></div><div class="ws-tabs workspace-mode-tabs automation-detail-tabs" role="tablist" aria-label="自动化详情"><button class="ws-tab ${tab === 'records' ? 'active' : ''}" data-auto-tab="records" role="tab" aria-selected="${tab === 'records'}">触发记录${history?` <span>${history.total}</span>`:''}</button><button class="ws-tab ${tab === 'config' ? 'active' : ''}" data-auto-tab="config" role="tab" aria-selected="${tab === 'config'}">配置</button></div><div data-auto-detail></div>`;
        actionsTarget().innerHTML = `<label class="automation-enabled-control settings-toggle"><span>${item.enabled?'已启用':'已停用'}</span><input type="checkbox" role="switch" data-auto-enable="${esc(item.id)}" aria-label="启用 ${esc(item.title)}" ${item.enabled?'checked':''}></label><button class="small-button" data-auto-edit="${esc(item.id)}">编辑</button><button class="primary-button compact" data-auto-trigger="${esc(item.id)}">立即执行</button>${menu(item)}`;
        const body = target.querySelector('[data-auto-detail]');
        if (tab === 'config') {
          const workflow = catalog().workflowTemplates.find(workflow => workflow.id === item.workflowTemplateId);
          body.innerHTML = `<dl class="automation-config-layout"><div class="automation-config-section"><dt>任务目标</dt><dd class="automation-config-text automation-config-objective">${esc(item.objective)}</dd></div><div class="automation-config-section"><dt>执行成员</dt><dd class="automation-config-members">${membersOf(item).map(agent => `<span class="automation-config-member"${agent.id===item.managerAgentId ? ' title="本次经理"' : ''}>${avatar(agent)}<span>${agent.id===item.managerAgentId ? '<span class="task-manager-star" aria-label="本次经理">★</span> ' : ''}${esc(agent.name)}</span></span>`).join('')}</dd></div><div class="automation-config-section"><dt>工作流</dt><dd>${workflow ? `<button class="text-action" data-auto-workflow="${esc(workflow.id)}">${esc(workflow.name)}</button>${workflow.description ? `<div class="automation-config-text field-hint">${esc(workflow.description)}</div>` : ''}` : item.workflowTemplateId ? (catalog().catalogReferences ? '原流程模板已不可用' : '正在读取工作流') : '默认协作'}</dd></div>${item.acceptanceCriteria.length ? `<div class="automation-config-section"><dt>验收标准</dt><dd><ul>${item.acceptanceCriteria.map(value => `<li>${esc(value)}</li>`).join('')}</ul></dd></div>` : ''}<div class="automation-config-section"><dt>完成规则</dt><dd>全自动协作；下一轮启动前自动确认上一轮待验收记录。<div class="field-hint">正在执行或暂停时跳过重叠触发；离线错过不补跑。</div></dd></div></dl>`;
        } else {
          if(!history){body.innerHTML='<div class="directory-empty is-loading" role="status" aria-busy="true"><strong>正在读取触发记录</strong>计划信息已加载。</div>';return;}
          records.page = history.page;
          // A trigger without a runId must not offer a fabricated Task entry.
          body.innerHTML = `${history.items.length ? `<div class="table-wrap automation-table-scroll"><table class="table task-inventory automation-table automation-trigger-table"><colgroup><col class="trigger-title"><col class="trigger-source"><col><col class="trigger-completion"><col class="trigger-duration"><col class="trigger-action"></colgroup><thead><tr><th>运行记录</th><th>触发方式</th><th>状态</th><th>完成方式</th><th>耗时</th><th>操作</th></tr></thead><tbody>${history.items.map(record => `<tr><td><span class="automation-trigger-title" title="${esc(record.taskTitle || '')}">${esc(record.taskTitle || '未创建任务')}</span><time class="automation-record-time" title="${esc(format(record.plannedAt,item.timeZone))}">${format(record.plannedAt,item.timeZone,true)}</time></td><td><span class="automation-source-tag" data-kind="${record.source === 'schedule' ? 'schedule' : 'manual'}">${record.source === 'schedule' ? '定时' : '手动'}</span></td><td class="automation-trigger-status">${stateLabel(record)}${record.reason ? `<small class="automation-reason" title="${esc(record.reason)}">${esc(record.reason)}</small>` : ''}</td><td>${record.completion === 'automatic' ? '自动确认' : record.completion === 'manual' ? '手动确认' : '—'}</td><td class="automation-duration">${durationOf(record)}</td><td>${record.runId ? `<button class="ghost-button" data-auto-run="${esc(record.runId)}">查看详情 →</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>${paginationMarkup(history,'automation-triggers')}` : '<div class="directory-empty">暂无符合条件的触发记录</div>'}`;
        }
        };
        paintDetail(null);
        if(selectedTab==='records'){
          try{const history=await api(`/api/automations/${encodeURIComponent(id)}/triggers?`+new URLSearchParams(historyQuery));if(current())paintDetail(history);}
          catch(error){if(current())target.querySelector('[data-auto-detail]').innerHTML=`<div class="directory-empty" role="alert"><strong>触发记录读取失败</strong>${esc(error.message)}<button type="button" class="small-button" data-auto-refresh>重试</button></div>`;}
        }
      }
    } catch (error) {
      if (ticket !== request || target !== root) return;
      if (!quiet) {
        const results=target.querySelector('[data-auto-results]');
        if(results && !loadedItems.size)results.innerHTML=`<div class="directory-empty" role="alert"><strong>自动化读取失败</strong>${esc(error.message)} <button class="small-button" data-auto-refresh>重试</button></div>`;
        else if (!target.querySelector('[data-auto-results],.automation-detail-header')) target.innerHTML = `<div class="directory-empty" role="alert">${esc(error.message)} <button class="small-button" data-auto-refresh>重试</button></div>`;
        else toast(error.message,true);
      }
    } finally { if (ticket === request) {loading=false;target.removeAttribute('aria-busy');} }
  }
  async function action(button, work) { if (button.disabled) return; button.disabled = true; try { await work(); } catch(error) { toast(error.message,true); } finally { if(button.isConnected)button.disabled=false; } }
  function click(event) {
    const row = event.target.closest('[data-auto-nav]');
    if (row && !event.target.closest('button,input,label,a,details')) { navigate(row.dataset.autoNav); return; }
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    const item = loadedItems.get(button.dataset.autoEdit || button.dataset.autoTrigger || button.dataset.autoDelete || button.dataset.autoClone);
    if (button.dataset.autoStatus) { clearTimeout(searchTimer); searchTimer=null; query.status=button.dataset.autoStatus; query.page=1; void load(); }
    if (button.hasAttribute('data-auto-new')) edit();
    if (button.dataset.autoOpen) navigate(button.dataset.autoOpen);
    if (button.hasAttribute('data-auto-back')) navigate(null);
    if (button.dataset.autoRun) openRun(button.dataset.autoRun);
    if (button.dataset.autoTab) { tab=button.dataset.autoTab; void load(); }
    if (button.dataset.autoWorkflow) void action(button,async()=>{const {workflowTemplate}=await api('/api/workflow-templates/'+encodeURIComponent(button.dataset.autoWorkflow));if(button.isConnected)showWorkflow(workflowTemplate);});
    if (button.hasAttribute('data-auto-refresh')) void load();
    if (button.dataset.page) { (selectedId ? records : query).page=Number(button.dataset.page); void load(); }
    if (item && button.dataset.autoEdit) { button.closest('details')?.removeAttribute('open'); edit(item); }
    if (button.dataset.autoClone) { const source = loadedItems.get(button.dataset.autoClone); button.closest('details')?.removeAttribute('open'); if (source) edit(null, { draft: { title: `${source.title}（副本）`, objective: source.objective, cron: source.cron, memberAgentIds: source.memberAgentIds, managerAgentId: source.managerAgentId, workflowTemplateId: source.workflowTemplateId, acceptanceCriteria: source.acceptanceCriteria || [] } }); }
    if (item && button.dataset.autoTrigger) void action(button,async()=>{ const result=await api(`/api/automations/${encodeURIComponent(item.id)}/trigger`,{method:'POST',body:'{}'}); if(selectedId){records.page=1;tab='records';}toast(result.trigger.reason || '已开始执行',result.trigger.outcome==='failed');await load(); });
    if (item && button.dataset.autoDelete && !item.enabled) { button.closest('details')?.removeAttribute('open'); confirmDelete(item,async()=>{ await api(`/api/automations/${encodeURIComponent(item.id)}`,{method:'DELETE'});if(selectedId)navigate(null);else await load(); }); }
  }
  function change(event) {
    const input = event.target.closest('[data-auto-enable]'); if (!input) return;
    void action(input,async()=>{try {await api(`/api/automations/${encodeURIComponent(input.dataset.autoEnable)}`,{method:'PUT',body:JSON.stringify({enabled:input.checked})});}catch(error){input.checked=!input.checked;throw error;}await load();});
  }
  return {
    mount(target, id = null) {
      root = target; const key = id || 'list'; if (mountedKey === key) return;
      if (id && recordOwner !== id) { records = {status:'all',page:1}; tab='records'; recordOwner=id; }
      clearTimeout(searchTimer); searchTimer = null; selectedId = id; mountedKey = key; loadedItems=new Map();target.innerHTML = '';
      if(headerActions){headerActions.innerHTML='';headerActions.onclick=click;headerActions.onchange=change;}
      target.onclick = click; target.onchange = change;
      if(!id){listShell(target);paintCounts(target,['all','enabled','disabled'].map(status=>[status,null]));}
      else target.innerHTML='<div class="directory-empty is-loading" role="status" aria-busy="true"><strong>正在读取自动化</strong>计划信息正在加载。</div>';
      target.oninput = event => {if(id || event.target.name!=='search')return;query.search=event.target.value;query.page=1;++request;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{searchTimer=null;void load();},250);};
      target.onsubmit = event => { event.preventDefault(); clearTimeout(searchTimer); searchTimer = null; void load(); };
      void load(); clearInterval(timer); timer=setInterval(()=>{if(document.visibilityState==='visible' && !searchTimer)void load({quiet:true});},15000);
    },
    refresh() { return load(); },
    refreshCatalog() {if(!root || !mountedKey)return;for(const node of root.querySelectorAll('[data-auto-member-stack]')){const item=loadedItems.get(node.dataset.autoMemberStack);if(item)node.outerHTML=memberStack(item);}if(selectedId && tab==='config' && loadedItems.size)void load();},
    unmount() { ++request;loading=false;clearInterval(timer); clearTimeout(searchTimer); searchTimer=null; mountedKey=null;root=null;if(headerActions){headerActions.replaceChildren();headerActions.onclick=null;headerActions.onchange=null;} }
  };
}
