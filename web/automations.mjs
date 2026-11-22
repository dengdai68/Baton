import { $t, $tm } from "../client/i18n.mjs";
import { paginationMarkup } from './pagination.mjs';
import { automationScheduleLabel, formatNextTriggerTime } from "../client/console-projections.mjs";
export { automationScheduleLabel };


export function createAutomationUI({ api, esc, pill, exactTime, edit, navigate, openRun, toast, confirmDelete, catalog, showWorkflow, headerActions = null }) {
  let root, selectedId, request = 0, timer, searchTimer, loading = false, query = { search: '', status: 'all', page: 1 }, records = { status: 'all', page: 1 }, mountedKey, recordOwner, loadedItems = new Map();
  const format = (value, timeZone, compact = false) => value ? timeZone ? new Intl.DateTimeFormat('zh-CN',{timeZone,...(compact ? {} : {year:'numeric'}),month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',...(!compact && {second:'2-digit'}),hour12:false}).format(new Date(value)) : exactTime(value) : '—';
  const stateLabel = record => record?.status === 'skipped' ? `<span class="status-pill">${$t("已跳过")}</span>` : record ? pill(record.status) : `<span class="automation-muted">${$t("尚未触发")}</span>`;
  const durationOf = record => { if (!record.completedAt || !record.plannedAt) return '—'; const seconds = Math.max(0, Math.round((Date.parse(record.completedAt) - Date.parse(record.plannedAt)) / 1000)); if (!seconds) return '—'; const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60; return hours ? $t("{0} 小时 {1} 分", [hours, minutes]) : minutes ? $t("{0} 分 {1} 秒", [minutes, rest]) : $t("{0} 秒", [rest]); };
  const membersOf = item => item.memberAgentIds.map(id => catalog().agents.find(agent=>agent.id===id) || {id,name:catalog().catalogReferences ? $t("不可用员工") : $t("正在读取员工"),color:'blue'});
  const avatar = agent => `<span class="agent-card-avatar color-${esc(agent.color || 'blue')}" aria-hidden="true">${esc(Array.from(agent.name || '?').slice(0,1).join('').toUpperCase())}</span>`;
  const memberStack = item => { const members=membersOf(item);return `<span class="directory-avatar-stack" data-auto-member-stack="${esc(item.id)}" title="${esc(members.map(agent=>agent.name).join('、'))}">${members.slice(0,4).map(avatar).join('')}${members.length>4?`<span class="automation-member-extra">+${members.length-4}</span>`:''}</span>`; };
  const menu = item => `<details class="automation-row-menu action-menu"><summary aria-label="${$t("{0} 更多操作", [esc(item.title)])}" title="${$t("更多操作")}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></summary><div class="automation-menu-items action-menu-list" role="menu"><button type="button" data-auto-trigger="${esc(item.id)}">${$t("立即执行")}</button><button type="button" data-auto-edit="${esc(item.id)}">${$t("编辑")}</button><button type="button" data-auto-clone="${esc(item.id)}">${$t("复制为新自动化")}</button><button type="button" class="danger" data-auto-delete="${esc(item.id)}" ${item.enabled?$t("disabled title=\"请先停用自动化，再删除\""):''}>${$t("删除{0}", [item.enabled?$t("（请先停用）"):''])}</button></div></details>`;
  const actionsTarget = () => (selectedId ? root?.querySelector('[data-auto-header-actions]') : headerActions) || root?.querySelector('[data-auto-header-actions]');
  function listShell(target) {
    if (!target.querySelector('#automation-search')) target.innerHTML = `<div class="page-heading"><div><h2>${$t("自动化")}</h2><p>${$t("按计划重复执行任务。每轮独立记录，按你设置的规则确认完成。")}</p></div>${headerActions?'':'<div data-auto-header-actions></div>'}</div><form class="directory-toolbar paper-filter-toolbar" id="automation-search"><div class="directory-chips" aria-label="${$t("自动化状态")}"></div><input type="search" name="search" aria-label="${$t("搜索自动化")}" placeholder="${$t("筛选自动化")}" value="${esc(query.search)}"></form><div data-auto-results><div class="directory-empty is-loading" role="status" aria-busy="true"><strong>${$t("正在读取自动化")}</strong>${$t("计划列表正在加载。")}</div></div>`;
    actionsTarget().innerHTML = `<button class="primary-button" type="button" data-auto-new>${$t("＋ 新建自动化")}</button>`;
  }
  function paintCounts(target, counts) {
    const view=target.closest?.('.view'),total=counts.find(([status])=>status==='all')?.[1];
    if(view)view.dataset.titleCount=Number.isFinite(total)?String(total):'';
    const focusedStatus=document.activeElement?.dataset.autoStatus;
    target.querySelector('.directory-chips').innerHTML=counts.map(([status,count])=>`<button type="button" class="directory-chip" data-auto-status="${status}" aria-pressed="${query.status===status}">${({all:$t("全部"),enabled:$t("启用中"),disabled:$t("已停用")})[status]} <span>${count ?? '—'}</span></button>`).join('');
    if(focusedStatus)target.querySelector(`[data-auto-status="${focusedStatus}"]`)?.focus();
  }
  async function load({ quiet = false } = {}) {
    if(quiet && loading)return;
    const target = root, id = selectedId, ticket = ++request;
    if (!target) return;
    const listQuery={...query},historyQuery={...records};
    const current=()=>ticket===request && target===root && selectedId===id;
    loading=true;
    if (!quiet) target.setAttribute('aria-busy','true');
    try {
      const data = id ? await api(`/api/automations/${encodeURIComponent(id)}`) : await api('/api/automations?' + new URLSearchParams(listQuery));
      if (!current()) return;
      if (quiet && (target.querySelector('details[open]') || target.querySelector('input[type=search]:focus'))) return;
      if (!id) {
        query.page = data.page; loadedItems = new Map(data.items.map(item=>[item.id,item]));
        listShell(target);
        const counts=['all','enabled','disabled'].map(status=>[status,status===listQuery.status?data.total:null]);
        paintCounts(target,counts);
        target.querySelector('[data-auto-results]').innerHTML = data.items.length ? `<div class="table-wrap automation-table-scroll"><table class="table task-inventory automation-table automation-directory-table"><thead><tr><th aria-label="${$t("启用@@status")}"></th><th>${$t("名称")}</th><th>${$t("执行规则")}</th><th>${$t("下次执行")}</th><th class="automation-secondary">${$t("最近一轮")}</th><th class="automation-secondary">${$t("成员")}</th><th aria-label="${$t("更多操作")}"></th></tr></thead><tbody>${data.items.map(item => {
          const record = item.latestTrigger;
          const latest = record?.completion === 'automatic' ? `<span class="automation-latest" data-tone="done">${$t("已自动确认")}</span>` : stateLabel(record);
          return `<tr data-auto-nav="${esc(item.id)}"><td><label class="automation-switch settings-toggle"><input type="checkbox" role="switch" data-auto-enable="${esc(item.id)}" aria-label="${$t("启用 {0}", [esc(item.title)])}" ${item.enabled?'checked':''}></label></td><td><button class="text-action automation-name" data-auto-open="${esc(item.id)}" title="${esc(item.title)}">${esc(item.title)}</button><span class="automation-description" title="${esc(item.objective)}">${esc(item.objective)}</span></td><td><span class="automation-rule">${esc(automationScheduleLabel(item.cron))}</span><code>${esc(item.cron)}</code></td><td><time title="${esc(format(item.nextTriggerAt,item.timeZone))}">${item.enabled ? formatNextTriggerTime(item.nextTriggerAt,item.timeZone) : $t("已停用")}</time></td><td class="automation-latest automation-secondary">${latest}</td><td class="automation-secondary">${memberStack(item)}</td><td>${menu(item)}</td></tr>`;
        }).join('')}</tbody></table></div>${paginationMarkup(data,'automations')}` : `<div class="directory-empty" role="status"><strong>${query.search || query.status !== 'all' ? $t("没有匹配的自动化") : $t("还没有自动化")}</strong>${query.search || query.status !== 'all' ? $t("请调整搜索条件，或清空搜索查看全部自动化。") : $t("点击右上角「新建自动化」添加。")}</div>`;
        const totals=await Promise.allSettled(counts.map(async ([status,count])=>[status,count ?? (await api('/api/automations?'+new URLSearchParams({...listQuery,status,page:1,pageSize:1}))).total]));
        if(!current())return;
        paintCounts(target,totals.map((result,index)=>result.status==='fulfilled'?result.value:counts[index]));
        if(totals.some(result=>result.status==='rejected'))target.querySelector('[data-auto-results]').insertAdjacentHTML('afterbegin',`<p class="field-hint" role="alert">${$t("部分状态计数读取失败。")}<button type="button" class="text-action" data-auto-refresh>${$t("重试")}</button></p>`);
      } else {
        const paintDetail = history => {
        const scrollTop = target.querySelector('[data-auto-detail]')?.scrollTop || 0;
        const item = data.automation;
        loadedItems = new Map([[item.id,item]]);
        target.innerHTML = `<header class="automation-detail-header page-heading"><div class="automation-detail-identity"><button class="text-action" data-auto-back aria-label="${$t("返回自动化列表")}" title="${$t("返回自动化列表")}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button><span class="automation-crumb">${$t("自动化")}</span><span class="automation-crumb" aria-hidden="true">/</span><h2 title="${esc(item.title)}">${esc(item.title)}</h2></div><div data-auto-header-actions></div></header><div class="automation-facts"><div><span>${$t("执行规则")}</span><strong>${esc(automationScheduleLabel(item.cron))}</strong><code>${esc(item.cron)}</code><label class="automation-enabled-control settings-toggle"><span>${item.enabled?$t("已启用"):$t("已停用")}</span><input type="checkbox" role="switch" data-auto-enable="${esc(item.id)}" aria-label="${$t("启用 {0}", [esc(item.title)])}" ${item.enabled?'checked':''}></label></div><div><span>${$t("下次执行")}</span><strong><time title="${esc(format(item.nextTriggerAt,item.timeZone))}">${item.enabled ? formatNextTriggerTime(item.nextTriggerAt,item.timeZone) : $t("已停用")}</time></strong><small>${esc(item.timeZone || $t("本机时区"))}</small></div><div><span>${$t("最近执行")}</span><strong>${format(item.latestExecution?.startedAt,item.timeZone)}</strong>${item.latestExecution ? pill(item.latestExecution.status) : $t("尚未执行")}</div><div><span>${$t("执行成员")}</span><div class="automation-fact-members">${memberStack(item)}<small>${$t("{0} 位员工", [membersOf(item).length])}</small></div></div></div><div data-auto-detail></div>`;
        actionsTarget().innerHTML = `<button class="small-button" data-auto-edit="${esc(item.id)}">${$t("配置")}</button><button class="primary-button compact" data-auto-trigger="${esc(item.id)}">${$t("立即执行")}</button>${menu(item)}`;
        const body = target.querySelector('[data-auto-detail]');
        {
          const workflow = catalog().workflowTemplates.find(workflow => workflow.id === item.workflowTemplateId);
          body.innerHTML = `<dl class="automation-config-layout"><div class="automation-config-section"><dt>${$t("任务目标")}</dt><dd class="automation-config-text automation-config-objective">${esc(item.objective)}</dd></div><div class="automation-config-section"><dt>${$t("执行成员")}</dt><dd class="automation-config-members">${membersOf(item).map(agent => `<span class="automation-config-member"${agent.id===item.managerAgentId ? ` ${$t("title=\"本次经理\"")}` : ''}>${avatar(agent)}<span>${agent.id===item.managerAgentId ? `<span class="task-manager-star" aria-label="${$t("本次经理")}">★</span> ` : ''}${esc(agent.name)}</span></span>`).join('')}</dd></div><div class="automation-config-section"><dt>${$t("工作流@@field")}</dt><dd>${workflow ? `<button class="text-action" data-auto-workflow="${esc(workflow.id)}">${esc(workflow.name)}</button>${workflow.description ? `<div class="automation-config-text field-hint">${esc(workflow.description)}</div>` : ''}` : item.workflowTemplateId ? (catalog().catalogReferences ? $t("原流程模板已不可用") : $t("正在读取工作流")) : $t("默认协作")}</dd></div>${item.acceptanceCriteria.length ? `<div class="automation-config-section"><dt>${$t("验收标准")}</dt><dd><ul>${item.acceptanceCriteria.map(value => `<li>${esc(value)}</li>`).join('')}</ul></dd></div>` : ''}<div class="automation-config-section"><dt>${$t("完成规则")}</dt><dd>${$t("全自动协作；下一轮启动前自动确认上一轮待验收记录。")}<div class="field-hint">${$t("正在执行或暂停时跳过重叠触发；离线错过不补跑。")}</div></dd></div></dl>`;
        }
        const recordsBody = document.createElement('section');
        recordsBody.setAttribute('data-auto-records', '');
        body.append(recordsBody);
        {
          if(!history){recordsBody.innerHTML=`<div class="directory-empty is-loading" role="status" aria-busy="true"><strong>${$t("正在读取触发记录")}</strong>${$t("计划信息已加载。")}</div>`;return;}
          records.page = history.page;
          // A trigger without a runId must not offer a fabricated Task entry.
          recordsBody.innerHTML = `${history.items.length ? `<div class="table-wrap automation-table-scroll"><table class="table task-inventory automation-table automation-trigger-table"><colgroup><col class="trigger-title"><col class="trigger-source"><col><col class="trigger-completion"><col class="trigger-duration"><col class="trigger-action"></colgroup><thead><tr><th>${$t("运行记录")}</th><th>${$t("触发方式")}</th><th>${$t("状态")}</th><th>${$t("完成方式")}</th><th>${$t("耗时")}</th><th>${$t("操作")}</th></tr></thead><tbody>${history.items.map(record => `<tr><td><span class="automation-trigger-title" title="${esc(record.taskTitle || '')}">${esc(record.taskTitle || $t("未创建任务"))}</span><time class="automation-record-time" title="${esc(format(record.plannedAt,item.timeZone))}">${format(record.plannedAt,item.timeZone,true)}</time></td><td><span class="automation-source-tag" data-kind="${record.source === 'schedule' ? 'schedule' : 'manual'}">${record.source === 'schedule' ? $t("定时") : $t("手动")}</span></td><td class="automation-trigger-status">${stateLabel(record)}${record.reason ? `<small class="automation-reason" title="${esc($tm(record.reason))}">${esc($tm(record.reason))}</small>` : ''}</td><td>${record.completion === 'automatic' ? $t("自动确认") : record.completion === 'manual' ? $t("手动确认") : '—'}</td><td class="automation-duration">${durationOf(record)}</td><td>${record.runId ? `<button class="ghost-button" data-auto-run="${esc(record.runId)}">${$t("查看详情")} →</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>${paginationMarkup(history,'automation-triggers')}` : `<div class="directory-empty">${$t("暂无符合条件的触发记录")}</div>`}`;
        }
        body.scrollTop = scrollTop;
        };
        if (!quiet) paintDetail(null);
        {
          try{const history=await api(`/api/automations/${encodeURIComponent(id)}/triggers?`+new URLSearchParams(historyQuery));if(current())paintDetail(history);}
          catch(error){if(current())target.querySelector('[data-auto-records]').innerHTML=`<div class="directory-empty" role="alert"><strong>${$t("触发记录读取失败")}</strong>${esc(error.message)}<button type="button" class="small-button" data-auto-refresh>${$t("重试")}</button></div>`;}
        }
      }
    } catch (error) {
      if (ticket !== request || target !== root) return;
      if (!quiet) {
        const results=target.querySelector('[data-auto-results]');
        if(results && !loadedItems.size)results.innerHTML=`<div class="directory-empty" role="alert"><strong>${$t("自动化读取失败")}</strong>${esc(error.message)} <button class="small-button" data-auto-refresh>${$t("重试")}</button></div>`;
        else if (!target.querySelector('[data-auto-results],.automation-detail-header')) target.innerHTML = `<div class="directory-empty" role="alert">${esc(error.message)} <button class="small-button" data-auto-refresh>${$t("重试")}</button></div>`;
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
    if (button.dataset.autoWorkflow) void action(button,async()=>{const {workflowTemplate}=await api('/api/workflow-templates/'+encodeURIComponent(button.dataset.autoWorkflow));if(button.isConnected)showWorkflow(workflowTemplate);});
    if (button.hasAttribute('data-auto-refresh')) void load();
    if (button.dataset.page) { (selectedId ? records : query).page=Number(button.dataset.page); void load(); }
    if (item && button.dataset.autoEdit) { button.closest('details')?.removeAttribute('open'); edit(item); }
    if (button.dataset.autoClone) { const source = loadedItems.get(button.dataset.autoClone); button.closest('details')?.removeAttribute('open'); if (source) edit(null, { draft: { title: $t("{0}（副本）", [source.title]), objective: source.objective, cron: source.cron, memberAgentIds: source.memberAgentIds, managerAgentId: source.managerAgentId, workflowTemplateId: source.workflowTemplateId, acceptanceCriteria: source.acceptanceCriteria || [] } }); }
    if (item && button.dataset.autoTrigger) void action(button,async()=>{ const result=await api(`/api/automations/${encodeURIComponent(item.id)}/trigger`,{method:'POST',body:'{}'}); if(selectedId){records.page=1;}toast(result.trigger.reason || $t("已开始执行"),result.trigger.outcome==='failed');await load(); });
    if (item && button.dataset.autoDelete && !item.enabled) { button.closest('details')?.removeAttribute('open'); confirmDelete(item,async()=>{ await api(`/api/automations/${encodeURIComponent(item.id)}`,{method:'DELETE'});if(selectedId)navigate(null);else await load(); }); }
  }
  function change(event) {
    const input = event.target.closest('[data-auto-enable]'); if (!input) return;
    void action(input,async()=>{try {await api(`/api/automations/${encodeURIComponent(input.dataset.autoEnable)}`,{method:'PUT',body:JSON.stringify({enabled:input.checked})});}catch(error){input.checked=!input.checked;throw error;}await load();});
  }
  return {
    mount(target, id = null) {
      root = target; const key = id || 'list'; if (mountedKey === key) return;
      if (id && recordOwner !== id) { records = {status:'all',page:1};  recordOwner=id; }
      clearTimeout(searchTimer); searchTimer = null; selectedId = id; mountedKey = key; loadedItems=new Map();target.innerHTML = '';
      if(headerActions){headerActions.innerHTML='';headerActions.onclick=click;headerActions.onchange=change;}
      target.onclick = click; target.onchange = change;
      if(!id){listShell(target);paintCounts(target,['all','enabled','disabled'].map(status=>[status,null]));}
      else target.innerHTML=`<div class="directory-empty is-loading" role="status" aria-busy="true"><strong>${$t("正在读取自动化")}</strong>${$t("计划信息正在加载。")}</div>`;
      target.oninput = event => {if(id || event.target.name!=='search')return;query.search=event.target.value;query.page=1;++request;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{searchTimer=null;void load();},250);};
      target.onsubmit = event => { event.preventDefault(); clearTimeout(searchTimer); searchTimer = null; void load(); };
      void load(); clearInterval(timer); timer=setInterval(()=>{if(document.visibilityState==='visible' && !searchTimer)void load({quiet:true});},15000);
    },
    refreshQuietly() { return load({quiet:true}); },
    refresh() { return load(); },
    refreshCatalog() {if(!root || !mountedKey)return;for(const node of root.querySelectorAll('[data-auto-member-stack]')){const item=loadedItems.get(node.dataset.autoMemberStack);if(item)node.outerHTML=memberStack(item);}if(selectedId && loadedItems.size)void load();},
    unmount() { ++request;loading=false;clearInterval(timer); clearTimeout(searchTimer); searchTimer=null; mountedKey=null;root=null;if(headerActions){headerActions.replaceChildren();headerActions.onclick=null;headerActions.onchange=null;} }
  };
}
