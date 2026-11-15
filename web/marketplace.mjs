import {runtimeLabel,RUNTIME_IDS} from "../client/runtime-providers.mjs";
import { paginate, paginationMarkup } from './pagination.mjs';
import { createFloatingList } from './floating-list.mjs';

export function extensionAvatarColor(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return ['violet', 'cyan', 'amber', 'blue', 'green'][hash % 5];
}

// A manual update owns polling only while its work is running and this page is
// visible. Returning to the directory reads the current receipt once.
export function createPluginUpdateAction(button,{api,notify,onUpdated=()=>{},isActive=()=>true,pollMs=1000}) {
  let disposed=false,busy=false,watching=false,retryRead=false,observed=null,timer;
  const visible=()=>isActive() && globalThis.document?.visibilityState!=='hidden';
  const paint=()=>{
    button.disabled=busy || Boolean(observed?.running && !retryRead);
    button.textContent=retryRead?'重试读取':busy || observed?.running?'更新中…':'更新全部';
    button.setAttribute('aria-busy',String(busy || Boolean(observed?.running && !retryRead)));
  };
  async function read(trigger=false) {
    if(disposed || busy || !visible())return;
    clearTimeout(timer);busy=true;paint();
    try {
      const value=await api('/api/runtime/marketplace/updates',trigger?{method:'POST',body:'{}'}:{});
      if(disposed)return;
      observed=value;retryRead=false;
      if(trigger || value.running)watching=true;
      if(!value.running && watching){
        watching=false;
        const result=value.lastResult,failed=result?.errors?.length || 0;
        if(result)notify(failed?`更新结束，${failed} 个来源未更新；详情见运行日志。`:`已更新 ${result.updatedPlugins || 0} 个插件。`,Boolean(failed));
        await onUpdated();
      }
    } catch(error) {
      if(!disposed){retryRead=true;watching=false;notify(`无法确认插件更新状态：${error.message}。请重试读取。`,true);}
    } finally {
      if(!disposed){busy=false;paint();if(observed?.running && !retryRead && visible())timer=setTimeout(()=>void read(),pollMs);}
    }
  }
  const onVisibility=()=>{clearTimeout(timer);if(visible() && observed?.running && !retryRead)void read();};
  globalThis.document?.addEventListener('visibilitychange',onVisibility);
  button.onclick=()=>read(!retryRead);
  paint();
  return {refresh:()=>read(),dispose(){disposed=true;clearTimeout(timer);globalThis.document?.removeEventListener('visibilitychange',onVisibility);}};
}

const providerLabel = runtimeLabel;
const icon=(kind,size=16)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({check:'<path d="m5 12 4 4L19 6"/>',minus:'<path d="M6 12h12"/>',tool:'<path d="M14 5a5 5 0 0 0-6 6l-5 5a3 3 0 0 0 5 5l5-5a5 5 0 0 0 6-6l-3 3-4-4Z"/>',people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m3-14a3 3 0 0 1 0 6m1 3a5 5 0 0 1 2 5"/>',file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 14h8m-8 4h5"/>',alert:'<path d="M12 3 2 20h20zM12 9v5m0 3v.01"/>',xcircle:'<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>'})[kind] || '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6m-6 6h6"/>'}</svg>`;
const supportReason=(item,provider)=>item.compatibility?.[provider]?.reasons?.join('；') || '此插件的组件与当前 Runtime 不兼容';
const runtimeBadges=(item,esc)=>`<div class="extension-runtime-badges">${RUNTIME_IDS.map(provider=>`<span class="runtime-support" data-supported="${item.providers.includes(provider)}" aria-label="${providerLabel(provider)}：${item.providers.includes(provider)?'支持':'不兼容'}" title="${esc(item.providers.includes(provider)?'组件静态兼容；依赖与账号需在实际执行时验证':supportReason(item,provider))}">${icon(item.providers.includes(provider)?'check':'minus',14)}<span>${providerLabel(provider)}</span></span>`).join('')}</div>`;
const warningMarkup=(warnings,esc)=>warnings?.length?`<section role="alert" class="extension-warning-note"><div><strong>${warnings.length} 个组件未能加载</strong><ul>${warnings.map(item=>`<li><strong>${esc(item.plugin)} · ${esc(({skill:'Skill',agent:'Subagent',hook:'Hook',command:'Command'})[item.component] || item.component)}</strong><br><code>${esc(item.path)}</code>：${esc(item.message)}</li>`).join('')}</ul></div></section>`:'';
const components = (plugin,esc,key) => `<section class="plugin-detail-section">${plugin.components?.[key]?.length ? plugin.components[key].map(item=>`<div class="plugin-detail-component">${icon(key==='skills'?'file':key==='agents'?'people':'tool')}<div><strong>${esc(item.name || item.event)}</strong>${item.providers?`<small class="component-runtimes">${esc(item.providers.map(providerLabel).join(' / '))}</small>`:''}${item.description?`<p>${esc(item.description)}</p>`:''}${item.path?`<code>${esc(item.path)}</code>`:''}${item.matchers?`<pre>${esc(JSON.stringify(item.matchers,null,2))}</pre>`:''}</div></div>`).join(''):`<p class="empty-state">该插件没有${({skills:'Skill',agents:'Subagent',hooks:'Hook'})[key]}。</p>`}</section>`;

function marketUI({api,esc,openModal,closeModal,confirmDialog,toast,headerActions,actionMenu=(content,label)=>`<details class="action-menu"><summary aria-label="${esc(label)}" title="${esc(label)}">⋯</summary><div class="action-menu-list" role="menu">${content}</div></details>`},kind) {
  let updateAction=null;
  let root=null,items=[],allItems=[],employees=null,query='',usage='all',pageNumber=1,loaded=false,readError='',ticket=0,searchTimer;
  let pagination=null,totals={all:null,unused:null},countErrors={},employeesError='';
  const mcpMetadata=new Map(),toolsState=new Map();
  // The existing updater applies candidates immediately; its receipts are not
  // pending updates. Keep that chip truthful instead of labeling applied versions.
  const hasUpdate=()=>false;
  const toolsFailed=item=>Boolean(toolsState.get(item.id)?.error);
  const employeeUsers=item=>employees===null ? null : employees.filter(agent=>{
    const key=plugin?'pluginIds':'mcpIds';
    return new Set([...(agent.runtime?.extensionSelection?.[key] || []),...(agent.inheritedExtensionSelection?.[key] || [])]).has(item.id);
  });
  const employeeCount=item=>employeeUsers(item)?.length ?? null;
  const usedBy=item=>{const users=employeeUsers(item);return `<section class="extension-detail-section"><h4>选择此${label}的员工 <span>${users?.length ?? '—'}</span></h4>${users?.length?`<div class="directory-person-chips">${users.map(agent=>{const roleName=agent.roles?.[0]?.name;return `<button type="button" data-jump-view="agents" title="查看数字员工"><span class="agent-card-avatar color-${esc(agent.color || 'system')}">${esc([...agent.name].slice(0,1).join(''))}</span>${esc(agent.name)}${roleName?` · ${esc(roleName)}`:''}</button>`;}).join('')}</div>`:`<p class="field-hint">${users?'还没有员工选择此'+label+'。在员工编辑页的「工具」中添加。':'员工使用情况读取失败。'}</p>`}</section>`;};
  const sourceLabel=item=>{
    const url=item.source?.origin?.url || item.source?.url;
    if(!url)return '来源未记录';
    if(url.startsWith('file:')){try{return '本地目录 · '+decodeURIComponent(new URL(url).pathname);}catch{return '本地目录 · '+url;}}
    if(url.startsWith('/') || url.startsWith('~'))return '本地目录 · '+url;
    return 'Git · '+url.replace(/^https?:\/\/[^/]+\//,'').replace(/\.git$/,'');
  };
  const installedDate=item=>{const date=new Date(item.createdAt);if(Number.isNaN(+date))return '安装日期未记录';const days=Math.floor((Date.now()-+date)/86400000);return days<1?'今天安装':days<30?`${days} 天前安装`:`${date.getMonth()+1}月${date.getDate()}日安装`;};
  const plugin=kind==='plugin', path=plugin?'/api/runtime/marketplace':'/api/runtime/mcp-marketplace', label=plugin?'插件':'MCP';
  function rows() {
    if(!root?.isConnected) return;
    const list=root.querySelector('[data-market-list]'),empty=root.querySelector('[data-market-empty]');
    empty.classList.toggle('is-loading',!loaded && !readError);empty.setAttribute('aria-busy',String(!loaded && !readError));
    if(!loaded){list.hidden=true;list.innerHTML='';empty.hidden=false;empty.setAttribute('role',readError?'alert':'status');empty.textContent=readError || '正在读取已安装项…';root.querySelector('[data-market-pager]').innerHTML='';return;}
    const attention=allItems.filter(plugin?hasUpdate:toolsFailed);
    const counts={...totals,attention:usage==='attention'?attention.length:null};
    const view=root.closest?.('.view');if(view)view.dataset.titleCount=Number.isFinite(totals.all)?String(totals.all):'';
    const focusedFilter=root.querySelector('[data-market-chips]').contains?.(globalThis.document?.activeElement) ? globalThis.document.activeElement.dataset.marketFilter : null;
    root.querySelector('[data-market-chips]').innerHTML=[['all','全部'],...plugin?[]:[['attention','读取失败']],['unused','未被使用']].map(([key,text])=>`<button type="button" class="directory-chip" data-market-filter="${key}" aria-pressed="${usage===key}"${countErrors[key]?` title="${esc(countErrors[key])}"`:''}>${text} <span>${counts[key] ?? '—'}</span></button>`).join('');
    if(focusedFilter)root.querySelector(`[data-market-filter="${focusedFilter}"]`)?.focus();
    const page=usage==='attention'?paginate(attention,pageNumber):{...pagination,items:allItems};pageNumber=page.page;items=page.items;
    list.hidden=!items.length;empty.hidden=Boolean(items.length);empty.setAttribute('role','status');
    empty.innerHTML=query || usage!=='all'?`<strong>没有匹配的${label}</strong>请调整搜索条件。`:`<strong>尚未安装${label}</strong>可手动安装后在员工中选择。`;
    list.innerHTML=items.map(item=>{
      const count=employeeCount(item),tools=toolsState.get(item.id),type=mcpMetadata.get(item.id)?.type;
      const componentText=['skills','agents','hooks'].map((key,index)=>{const count=Array.isArray(item.components?.[key])?item.components[key].length:item.components?.[key];return count?`${count} ${['Skill','Subagent','Hook'][index]}`:'';}).filter(Boolean).join(' · ') || '未包含组件';
      const toolsText=tools?.error?'工具读取失败':typeof tools?.total==='number'?`${tools.total} 个工具`:'工具尚未读取';
      const useText=count ? `${count} 位员工` : usage==='unused' ? '未被使用' : count===0 ? '0 位员工' : employeesError ? '使用情况读取失败' : '使用情况未读取';
      const source=plugin?sourceLabel(item):installedDate(item);
      const menu=`${plugin?'':`<button class="small-button" data-extension-edit="${esc(item.id)}">编辑</button><button class="small-button" data-extension-retry="${esc(item.id)}">${tools?.error?'重试读取工具':'重新读取工具'}</button>`}<button class="small-button" data-extension-check="${esc(item.id)}">检查兼容性</button><button class="small-button" data-extension-copy="${esc(item.id)}">${plugin?'复制来源地址':'复制配置（已脱敏）'}</button><button class="small-button danger" data-extension-delete="${esc(item.id)}">删除</button>`;
      return `<article class="agent-card installed-extension-card" data-extension-id="${esc(item.id)}"><div class="extension-card-heading"><span class="agent-card-avatar extension-avatar color-${extensionAvatarColor(item.id)}" aria-hidden="true">${esc([...item.name].slice(0,2).join('').toUpperCase())}</span><div class="extension-card-identity"><div class="extension-title-line"><button type="button" class="text-action extension-name" title="${esc(item.name)}" data-extension-detail="${esc(item.id)}">${esc(item.name)}</button>${plugin?(item.version?`<span class="extension-tag">${esc(String(item.version).replace(/^v/,''))}</span>`:''):`<span class="extension-tag">${esc(type || '类型未读取')}</span>`}</div><small class="extension-source" title="${esc(source)}">${esc(source)}</small></div>${!plugin && tools?.error?`<span class="extension-error">${icon('xcircle',14)}读取失败</span>`:item.warnings?.length?`<span class="extension-warning">${icon('alert',14)}警告</span>`:''}</div><p class="extension-card-description">${esc(!plugin && tools?.error?tools.error:item.description || '未填写说明')}</p><div class="directory-card-actions extension-card-footer"><div class="extension-footer-meta"><span>${esc(plugin?componentText:toolsText)}</span><span class="extension-usage">${icon('people',13)}${esc(useText)}</span></div>${!plugin && tools?.error?`<button type="button" class="small-button" data-extension-retry="${esc(item.id)}">重试</button>`:''}${actionMenu(menu,`${label}更多操作`)}</div></article>`;
    }).join('');
    root.querySelector('[data-market-pager]').innerHTML=paginationMarkup(page,plugin?'marketplace':'mcp');
  }
  async function load() {
    if(!root?.isConnected)return;
    const target=root,request=++ticket,search=query,filter=usage,requestedPage=pageNumber;
    const current=()=>request===ticket && root===target && target.isConnected;
    loaded=false;readError='';totals={all:null,unused:null};countErrors={};employees=null;employeesError='';rows();
    async function collect(endpoint,key,params={}) {
      const found=[];
      for(let page=1;;page++){
        const result=await api(`${endpoint}?${new URLSearchParams({...params,page:String(page)})}`);
        if(!current())return null;
        found.push(...(result[key] || []));
        if(!result.hasMore && !(result.page<result.totalPages))return found;
      }
    }
    const key=plugin?'plugins':'entries',serverFilter=filter==='unused'?'unused':'all';
    const otherFilter=serverFilter==='all'?'unused':'all';
    // Counts and employee references enrich cards independently. A slow or
    // failed auxiliary query must not hide an already confirmed current page.
    void api(`${path}?${new URLSearchParams({search,usage:otherFilter,page:'1'})}`).then(result=>{
      if(!current())return;
      totals[otherFilter]=result.total;rows();
    }).catch(error=>{if(current()){countErrors[otherFilter]=`${otherFilter==='unused'?'未被使用':'全部'}计数读取失败：${error.message}；点击该筛选可重新读取`;rows();}});
    void collect('/api/agents','agents',{pageSize:'100'}).then(agents=>{
      if(!current() || !agents)return;
      employees=agents.filter(agent=>agent.status!=='deleted');rows();
    }).catch(error=>{if(current()){employeesError=error.message;rows();}});
    try {
      if(filter==='attention'){
        // Tool failures are explicit, session-local discoveries, not a server
        // state. Only this requested filter needs the full searched catalog.
        allItems=await collect(path,key,{search,usage:'all'});
        if(!current())return;
        totals.all=allItems.length;pagination=null;
      }else{
        const result=await api(`${path}?${new URLSearchParams({search,usage:serverFilter,page:String(requestedPage)})}`);
        if(!current())return;
        allItems=result[key] || [];
        pagination={page:result.page || 1,pageSize:result.pageSize || 20,total:result.total ?? allItems.length,totalPages:result.totalPages || 1};
        totals[serverFilter]=pagination.total;
      }
      loaded=true;rows();
      if(!plugin)void loadMcpMetadata(request,target);
    } catch(error) {if(current()){readError=error.message;rows();}}
  }
  async function loadMcpMetadata(request,target) {
    // Only read configuration for the visible page. Never launch a tool server
    // just to populate cards; discovery is still an explicit detail/retry action.
    await Promise.all(items.filter(item=>!mcpMetadata.has(item.id)).map(async item=>{
      try{const detail=await api(`${path}/${encodeURIComponent(item.id)}`);
        if(request!==ticket || root!==target)return;
        const server=Object.values(detail.configuration?.mcpServers || {})[0];
        const type=server?.command?'stdio':server?.type==='sse'?'SSE':server?.url?'HTTP':null;
        mcpMetadata.set(item.id,{type});
      }catch{/* Keep the truthful unread label; the detail action exposes errors. */}
    }));
    if(request===ticket && root===target)rows();
  }
  async function cardAction(button) {
    if(button.disabled)return;
    button.disabled=true;
    const id=button.dataset.extensionCheck || button.dataset.extensionUpdate || button.dataset.extensionRetry || button.dataset.extensionDelete;
    try{
      if(button.dataset.extensionDelete){
        const item=allItems.find(item=>item.id===id);
        const accepted=await confirmDialog({title:`删除${label}`,message:`从已安装列表删除「${item?.name || label}」？将同时从所有数字员工的当前配置中移除；历史任务所需文件和记录保留。${plugin?'独立安装的 MCP 不受影响。':''}`,confirmLabel:`删除${label}`,danger:true});
        if(!accepted)return;
        await api(`${path}/${encodeURIComponent(id)}`,{method:'DELETE',body:'{}'});toast(`${label}已删除。`);
      }else if(button.dataset.extensionCheck){await api(`${path}/${encodeURIComponent(id)}/compatibility`,{method:'POST',body:'{}'});toast('兼容性已更新。');}
      else {await discoverTools(id,true);}
      await load();
    }catch(error){toast(error.message,true);}finally{if(button.isConnected)button.disabled=false;}
  }
  async function discoverTools(id,refresh=false) {
    try{const result=await api(`${path}/${encodeURIComponent(id)}/tools`,{method:'POST',body:JSON.stringify({refresh})});toolsState.set(id,{total:result.total});return result;}
    catch(error){toolsState.set(id,{error:error.message});throw error;}
    finally{if(root?.isConnected && loaded)rows();}
  }
  async function copyExtension(id) {
    try {const item=await api(`${path}/${encodeURIComponent(id)}`);const value=plugin?(item.source?.origin?.url || item.source?.url):JSON.stringify(item.configuration,null,2);if(!value)throw Error('没有记录来源地址');await navigator.clipboard.writeText(value);toast(plugin?'来源地址已复制。':'脱敏配置已复制。');}
    catch(error){toast(error.message,true);}
  }
  async function detail(id,errorMessage='') {
    if(!root?.isConnected)return;
    openModal(`<header class="directory-detail-header"><h2>${label}详情</h2>${plugin?'<button type="button" class="small-button" data-check-compatibility>检查兼容性</button>':'<button type="button" class="small-button" data-edit-mcp disabled>编辑</button>'}${actionMenu(`${plugin?'':'<button type="button" class="small-button" data-mcp-rediscover>重新读取工具</button>'}<button type="button" class="small-button" data-copy-extension>${plugin?'复制来源地址':'复制配置（已脱敏）'}</button><button type="button" class="small-button danger" data-delete-extension>删除</button>`,`${label}详情更多操作`)}<button type="button" class="ghost-button" data-close-modal aria-label="关闭${label}详情">×</button></header><div class="directory-detail-body"><p class="field-error" role="alert" data-extension-delete-error>${esc(errorMessage)}</p><div data-extension-detail-body role="status">正在读取…</div></div>`, {drawer:true});
    const target=document.querySelector('[data-extension-detail-body]');
    target.closest('.modal').classList.add('extension-detail-modal','detail-drawer');
    target.closest('.modal').querySelector('[data-close-modal]').focus();
    const entry=allItems.find(item=>item.id===id);
    let loadedItem=null;
    const edit=target.closest('.modal').querySelector('[data-edit-mcp]');
    if(edit)edit.onclick=async()=>{
      edit.disabled=true;
      try {
        const item=loadedItem || await api(`${path}/${encodeURIComponent(id)}`);
        if(edit.isConnected)installMcp(item);
      }catch(error){if(edit.isConnected)toast(error.message,true);}
      finally{if(edit.isConnected)edit.disabled=false;}
    };
    target.closest('.modal').querySelector('[data-copy-extension]').onclick=()=>copyExtension(id);
    const rediscover=target.closest('.modal').querySelector('[data-mcp-rediscover]');
    if(rediscover)rediscover.onclick=()=>{const refresh=target.querySelector('[data-mcp-tools-refresh]');if(refresh)refresh.click();};
    const compatibilityButton=document.querySelector('[data-check-compatibility]');
    if(compatibilityButton)compatibilityButton.onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{await api(`${path}/${encodeURIComponent(id)}/compatibility`,{method:'POST',body:'{}'});await load();if(root?.isConnected)await detail(id);toast('兼容性已更新。');}
      catch(error){toast(error.message,true);if(button.isConnected)button.disabled=false;}
    };
    document.querySelector('[data-delete-extension]').onclick=async event=>{
      const view=root;
      event.currentTarget.disabled=true;
      const accepted=await confirmDialog({title:`删除${label}`,message:`从已安装列表删除「${entry?.name || label}」？将同时从所有数字员工的当前配置中移除；历史任务所需文件和记录保留。${plugin?'独立安装的 MCP 不受影响。':''}`,confirmLabel:`删除${label}`,danger:true});
      if(root!==view || !view.isConnected)return;
      if(!accepted){if(!document.querySelector('#modal-content').childElementCount){await detail(id);document.querySelector('[data-delete-extension]')?.focus();}return;}
      try {await api(`${path}/${encodeURIComponent(id)}`,{method:'DELETE',body:'{}'});toast(`${label}已删除。`);await load();}
      catch(error){if(root===view && !document.querySelector('#modal-content').childElementCount)await detail(id,error.message);else toast(error.message,true);}
    };
    try {
      const item=await api(`${path}/${encodeURIComponent(id)}`);if(!target.isConnected)return;
      loadedItem=item;
      target.removeAttribute('role');
      const server=Object.values(item.configuration?.mcpServers || {})[0];
      const type=server?.command?'stdio':server?.type==='sse'?'SSE':server?.url?'HTTP':'类型未记录';
      target.innerHTML=`<div class="extension-detail-overview"><span class="agent-card-avatar extension-avatar color-${extensionAvatarColor(item.id)}" aria-hidden="true">${esc([...item.name].slice(0,2).join('').toUpperCase())}</span><div><h3>${esc(item.name)}</h3><p>${esc(item.description || '')}</p><div class="extension-detail-meta">${plugin && item.version?`<span class="extension-tag">${esc(/^v/.test(item.version)?item.version:'v'+item.version)}</span>`:`<span class="extension-tag">${esc(plugin?'':type)}</span>`}<span>${esc(installedDate(item))}</span>${plugin?`<span>${esc(sourceLabel(item))}</span>`:`<span>可被 ${esc(item.providers.map(providerLabel).join('、'))} 选择</span>`}</div></div></div>${plugin?`<section class="extension-detail-section plugin-components"><h4>包含的组件</h4><div class="plugin-detail-tabs" role="tablist" aria-label="插件组件">${['skills','agents','hooks'].map((key,index)=>`<button type="button" role="tab" id="plugin-tab-${key}" aria-controls="plugin-component-panel" aria-selected="${index===0}" tabindex="${index===0?0:-1}" data-plugin-tab="${key}">${['Skill','Subagent','Hook'][index]} <span>${item.components[key].length}</span></button>`).join('')}</div><div id="plugin-component-panel" role="tabpanel" aria-labelledby="plugin-tab-skills" tabindex="0">${components(item,esc,'skills')}</div></section>`:`<section class="extension-detail-section mcp-configuration" aria-label="连接配置"><h4>连接配置</h4><pre class="mcp-json-detail">${esc(JSON.stringify(item.configuration,null,2))}</pre><p class="field-hint">${item.redacted?'配置中的鉴权值已隐藏。':''}原始 JSON 保存在本机私有配置目录，列表不携带此配置。</p></section><section class="extension-detail-section mcp-tools-panel"><header><h4>工具 <span data-mcp-tools-count hidden></span></h4><button type="button" class="text-action" data-mcp-tools-refresh aria-label="刷新工具列表" title="刷新工具列表"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 7v5h-5M19 12a7 7 0 1 0-2 5M20 7l-3-3"/></svg></button></header><div data-mcp-tools role="status">正在读取工具…</div></section>`}${usedBy(item)}`;
      target.querySelectorAll('[data-jump-view]').forEach(button=>{button.onclick=()=>{closeModal();globalThis.document?.querySelector('.nav-item[data-view="agents"]')?.click();};});
      if(!plugin){
        const tools=target.querySelector('[data-mcp-tools]'),button=target.querySelector('[data-mcp-tools-refresh]'),heading=target.querySelector('[data-mcp-tools-count]');
        const renderTools=discovered=>{
          tools.innerHTML=discovered.length ? discovered.map(tool=>`<article class="plugin-detail-component mcp-tool">${icon('tool')}<div><strong>${esc(tool.name)}</strong>${tool.title && tool.title!==tool.name?`<small>${esc(tool.title)}</small>`:''}${tool.description?`<p>${esc(tool.description)}</p>`:''}</div></article>`).join('') : '<p class="field-hint">此服务当前未提供工具。</p>';
        };
        const loadTools=async(refresh=false)=>{
          button.disabled=true;tools.setAttribute('role','status');tools.textContent='正在读取工具…';
          try{
            const result=await discoverTools(id,refresh);if(!tools.isConnected)return;
            heading.hidden=false;heading.textContent=result.total;tools.removeAttribute('role');
            renderTools(result.tools);
          }catch(error){if(tools.isConnected){heading.hidden=true;tools.setAttribute('role','alert');tools.innerHTML=`<div class="mcp-tools-error">${icon('xcircle',16)}<div><strong>无法读取工具列表</strong><p>${esc(error.message)}</p><div><button type="button" class="small-button" data-mcp-retry>重试</button><button type="button" class="small-button" data-mcp-edit>编辑配置</button></div></div></div>`;tools.querySelector('[data-mcp-retry]').onclick=()=>loadTools(true);tools.querySelector('[data-mcp-edit]').onclick=()=>installMcp(item);}}
          finally{if(button.isConnected)button.disabled=false;}
        };
        button.onclick=()=>loadTools(true);void loadTools();
      }
      if(plugin){
        target.querySelector('.extension-detail-overview').insertAdjacentHTML('afterend',`<section class="extension-detail-section plugin-runtime-compatibility"><h4>运行时兼容性 <small>${item.providers.length} / ${RUNTIME_IDS.length}</small></h4>${runtimeBadges(item,esc)}<details class="compatibility-reasons"><summary>查看 ${RUNTIME_IDS.filter(provider=>!item.providers.includes(provider)).length} 项不兼容原因</summary>${RUNTIME_IDS.filter(provider=>!item.providers.includes(provider)).map(provider=>`<p class="field-hint">${providerLabel(provider)}：${esc(supportReason(item,provider))}</p>`).join('')}<p class="field-hint">支持表示组件静态兼容，不代表本机 CLI、依赖或账号已通过实际执行验证。</p></details></section>`);
        target.querySelector('.extension-detail-overview').insertAdjacentHTML('afterend',warningMarkup(item.warnings,esc));
        const tabs=[...target.querySelectorAll('[data-plugin-tab]')];const select=button=>{tabs.forEach(tab=>{tab.setAttribute('aria-selected',String(tab===button));tab.tabIndex=tab===button?0:-1;});const panel=target.querySelector('[role=tabpanel]');panel.setAttribute('aria-labelledby',button.id);panel.innerHTML=components(item,esc,button.dataset.pluginTab);};tabs.forEach((button,index)=>{button.onclick=()=>select(button);button.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?tabs[0]:event.key==='End'?tabs.at(-1):tabs[(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length];select(next);next.focus();};});}
    } catch(error) {if(target.isConnected) {target.setAttribute('role','alert');target.textContent=error.message;}}
    finally {if(edit?.isConnected)edit.disabled=false;}
  }
  function installMcp(item) {
    if(item instanceof Event)item=null;
    const editing=Boolean(item),action=editing?'保存修改':'安装 MCP';
    openModal(`<h2>${editing?'编辑':'安装'} MCP</h2><p class="modal-intro">${editing?'保存为新版本并更新当前员工的选择；已启动任务和排队调用保持原配置。隐藏值保持原样即可保留，删除字段可清除。':'导入一个 MCP Server 的 JSON。同一安装名称再次导入会覆盖并更新当前员工选择，历史任务不变；首次安装不会自动绑定员工。'}</p><form id="mcp-market-form"><div class="form-field"><label>名称<input name="name" required maxlength="80"></label></div><div class="form-field"><label>说明（选填）<input name="description" maxlength="500"></label></div><div class="form-field"><label>MCP JSON<textarea name="content" rows="6" required spellcheck="false" autocomplete="off" placeholder='{"mcpServers":{"service":{"type":"streamableHttp","url":"https://example.com/mcp"}}}'></textarea></label></div><p class="field-hint">支持 stdio、SSE、Streamable HTTP；Claude Code 和 Codex 均可选择。不会安装依赖或修改全局 CLI。</p><p role="alert" data-market-error></p><div class="form-actions"><button type="button" class="ghost-button" data-close-modal>取消</button><button class="primary-button" type="submit">${action}</button></div></form>`);
    const form=document.querySelector('#mcp-market-form');
    const identity=document.createElement('div');identity.className='mcp-install-identity';
    const fields=[...form.querySelectorAll('.form-field')];fields[0].before(identity);identity.append(...fields.slice(0,2));
    if(editing){form.elements.name.value=item.name;form.elements.description.value=item.description || '';form.elements.content.value=JSON.stringify(item.configuration,null,2);}
    form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;
      try {const result=await api(editing?`${path}/${encodeURIComponent(item.id)}`:path,{method:editing?'PUT':'POST',body:JSON.stringify({name:form.elements.name.value,description:form.elements.description.value,content:form.elements.content.value})});if(form.isConnected)closeModal();toast(editing?'MCP 已更新，历史任务配置保持不变。':result.replacements?.length?`MCP 已覆盖，已更新 ${result.employees.length} 位员工；历史配置保留。`:'MCP 已安装，尚未绑定员工。');await load();}
      catch(error) {if(form.isConnected){form.querySelector('[data-market-error]').textContent=error.message;button.disabled=false;}}
    };
  }
  function installPlugin() {
    openModal(`<h2>安装插件</h2><p class="modal-intro">安装来源中的全部插件。同一来源与名称再次导入会覆盖并更新当前员工选择，历史任务不变。自带 MCP 单独入市场，按安装名称覆盖，不会随插件启用。</p><form id="market-entry-form"><fieldset class="source-type"><legend>来源类型</legend><label><input type="radio" name="sourceType" value="git" checked><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="10" r="2.5"/><path d="M6 8.5v7M18 12.5c0 2-2 3-4 3H8.5"/></svg>Git 仓库</label><label><input type="radio" name="sourceType" value="local"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>本地目录</label></fieldset><div class="form-field"><label for="market-source">来源地址</label><input id="market-source" class="mono-input" name="source" required autocomplete="off" spellcheck="false" placeholder="https://github.com/owner/plugins.git"></div><p class="field-hint">支持插件清单和裸 Skill 仓库；Skill 自动包装为同名、同描述插件，Git 来源仍支持更新。不执行安装脚本，不安装依赖。插件自带的 MCP 会单独出现在 MCP 列表。</p><p role="alert" data-market-error></p><div class="form-actions"><button type="button" class="ghost-button" data-close-modal>取消</button><button type="submit" class="primary-button">安装全部插件</button></div></form>`);
    const form=document.querySelector('#market-entry-form'),submit=form.querySelector('[type=submit]'),errorBox=form.querySelector('[data-market-error]');
    form.querySelectorAll('[name=sourceType]').forEach(input=>input.onchange=()=>{form.elements.source.placeholder=input.value==='local'?'/absolute/path/to/plugins':'https://github.com/owner/plugins.git';});
    form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;submit.textContent='正在安装…';errorBox.textContent='';
      try {const result=await api(path,{method:'POST',body:JSON.stringify({[form.elements.sourceType.value==='local'?'path':'url']:form.elements.source.value.trim()})});if(form.isConnected)closeModal();toast(`已安装 ${result.plugins.length} 个插件${result.mcps.length?'，另拆分 '+result.mcps.length+' 个 MCP':''}${result.replacements?.length?'；覆盖 '+result.replacements.length+' 个已有版本，更新 '+result.employees.length+' 位员工；历史配置保留。':'，尚未绑定员工。'}`);await load();if(root?.isConnected && result.warnings?.length)openModal(`<h2>⚠️ 插件安装存在错误</h2><p>已安装 ${result.plugins.length} 个插件。以下组件已跳过，其他组件可正常使用。</p>${warningMarkup(result.warnings,esc)}<div class="form-actions"><button type="button" class="primary-button" data-close-modal>知道了</button></div>`);}
      catch(error){if(form.isConnected){errorBox.textContent='⚠️ '+error.message;submit.disabled=false;submit.textContent='安装全部插件';}}
    };
  }
  return {
    mount(target){if(root===target)return;root=target;
      root.innerHTML=`<div class="page-heading"><div><h2>${label}</h2><p>${plugin?'插件为员工提供 Skill、Subagent 与 Hook。目前通过 Git 仓库或本地目录安装，在线市场即将开放。':'为员工连接外部工具与数据源。支持 stdio、SSE 与 Streamable HTTP，不会安装依赖或修改全局 CLI。'}</p></div></div><div class="directory-toolbar paper-filter-toolbar"><div class="directory-chips" data-market-chips aria-label="${label}筛选"></div><input type="search" aria-label="搜索${label}" placeholder="搜索已安装${label}"></div><div class="directory-content"><div data-market-list hidden aria-live="polite"></div><div class="directory-empty market-directory-empty" data-market-empty role="status">正在读取已安装项…</div><div data-market-pager></div></div>`;
      if(headerActions){headerActions.innerHTML=`${plugin?'<button type="button" class="small-button" data-extension-update="all">更新全部</button>':''}<button type="button" class="primary-button" ${plugin?'data-install-plugin':'data-add-mcp'}>安装${label}</button>`;headerActions.querySelector(plugin?'[data-install-plugin]':'[data-add-mcp]').onclick=plugin?installPlugin:installMcp;if(plugin){const target=root;updateAction=createPluginUpdateAction(headerActions.querySelector('[data-extension-update]'),{api,notify:toast,onUpdated:load,isActive:()=>root===target && target.isConnected});void updateAction.refresh();}}
      root.querySelector('[data-market-chips]').onclick=event=>{const button=event.target.closest('[data-market-filter]');if(!button)return;usage=button.dataset.marketFilter;pageNumber=1;clearTimeout(searchTimer);searchTimer=null;void load();};
      root.querySelector('input').value=query;root.querySelector('input').oninput=event=>{query=event.target.value;pageNumber=1;++ticket;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{searchTimer=null;void load();},200);};
      root.querySelector('[data-market-pager]').onclick=event=>{const button=event.target.closest('[data-page]');if(button){pageNumber=Number(button.dataset.page);if(usage==='attention'){rows();if(!plugin)void loadMcpMetadata(ticket,root);}else void load();}};
      root.querySelector('[data-market-list]').onclick=event=>{const button=event.target.closest('[data-extension-detail]'),edit=event.target.closest('[data-extension-edit]'),copy=event.target.closest('[data-extension-copy]');if(button)void detail(button.dataset.extensionDetail);else if(copy)void copyExtension(copy.dataset.extensionCopy);else if(edit){edit.disabled=true;void api(`${path}/${encodeURIComponent(edit.dataset.extensionEdit)}`).then(installMcp).catch(error=>toast(error.message,true)).finally(()=>{if(edit.isConnected)edit.disabled=false;});}else{const action=event.target.closest('[data-extension-check],[data-extension-update],[data-extension-retry],[data-extension-delete]');if(action)void cardAction(action);}};void load();
    },
    unmount(){updateAction?.dispose();updateAction=null;root=null;++ticket;clearTimeout(searchTimer);}
  };
}
export const createMcpMarketplaceUI = options => marketUI(options,'mcp');
// Shared employee picker: chips and search live inside one field boundary.
// IDs remain the saved values; display order is not a priority control.
export function createEmployeeMultiSelect(target,{id,label,placeholder,esc,items=[],selectedIds=[],available=()=>true,reason=()=>'',unavailableLabel='Runtime 不兼容',detail=()=>'',emptyMessage=()=> '没有可添加的匹配项',expand=item=>[item.id],preserveGroups=false,hideUnavailable=false,lockedIds=[],lockReason=()=>"当前成员不能移除",onChange=()=>{},managerId=null,onManagerChange=null}) {
  const selected=new Set(selectedIds);let catalog=items,selectedManager=managerId;
  const values=()=>[...new Set([...selected].flatMap(id=>{const item=catalog.find(row=>row.id===id);return item?expand(item):[id];}))];
  target.classList.add('extension-picker');
  target.innerHTML=`<label for="${esc(id)}">${esc(label)}</label><div class="extension-picker-search"><div class="extension-picker-control"><div class="extension-picked"></div><input id="${esc(id)}" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${esc(id)}-options" autocomplete="off" placeholder="${esc(placeholder)}"></div><div class="extension-picker-options" id="${esc(id)}-options" role="listbox" hidden></div></div>`;
  const search=target.querySelector('.extension-picker-search'),control=target.querySelector('.extension-picker-control'),input=target.querySelector('input'),list=target.querySelector('[role=listbox]'),chips=target.querySelector('.extension-picked');
  const floating=createFloatingList(control,list,{onClose:()=>input.setAttribute('aria-expanded','false')});
  const close=(restoreFocus=false)=>{if(restoreFocus && list.contains(document.activeElement))input.focus({preventScroll:true});floating.close();input.setAttribute('aria-expanded','false');};
  const paint=()=>{
    const covered=new Set(values());
    if(selectedManager && !covered.has(selectedManager)){selectedManager=null;onManagerChange?.(null);}
    const found=catalog.filter(item=>!selected.has(item.id) && !(preserveGroups && expand(item).length===1 && expand(item)[0]===item.id && covered.has(item.id)) && (!hideUnavailable || available(item)) && `${item.name} ${item.description || ''} ${item.id}`.toLowerCase().includes(input.value.trim().toLowerCase())).slice(0,20);
    list.innerHTML=found.map(item=>`<button type="button" role="option" aria-selected="false" data-add-extension="${esc(item.id)}" ${available(item)?'':`disabled title="${esc(reason(item))}"`}><strong>${esc(item.name)}</strong>${detail(item)}${available(item)?'':`<small>${esc(reason(item))}</small>`}</button>`).join('') || `<p class="field-hint">${esc(emptyMessage())}</p>`;
    chips.innerHTML=[...selected].map(id=>{const item=catalog.find(item=>item.id===id),incompatible=item && !available(item),name=item ? item.name+(preserveGroups && item.selectionKind==='team'?' · '+expand(item).length+' 人':'') : '未安装版本 '+id.slice(0,8),avatar=item?.color?`<span class="agent-card-avatar color-${esc(item.color)}" aria-hidden="true">${esc([...item.name].slice(0,1).join('').toUpperCase())}</span>`:'';return `<span class="extension-chip" title="${esc(name)} · ${esc(id)}" data-incompatible="${Boolean(incompatible)}"${onManagerChange ? ` data-manager="${id===selectedManager}"` : ''}>${avatar}${onManagerChange ? `<button type="button" class="extension-chip-name extension-manager-choice" data-select-manager="${esc(id)}" aria-pressed="${id===selectedManager}" aria-label="${esc(id===selectedManager ? '本次经理：'+name : '设为本次经理：'+name)}" title="${esc(id===selectedManager ? '本次任务经理' : '点击设为本次任务经理')}">${id===selectedManager ? '<span aria-hidden="true">★</span>' : ''}${esc(name)}</button>` : `<span class="extension-chip-name">${esc(name)}</span>`}${incompatible?`<small>${esc(unavailableLabel)}</small>`:''}<button type="button" data-remove-extension="${esc(id)}" ${lockedIds.includes(id)?`disabled title="${esc(lockReason(id))}"`:""} aria-label="移除${esc(name)}">×</button></span>`;}).join('');
    input.placeholder=selected.size?'继续添加…':placeholder;
  };
  // Selection wrapping can move an already-focused search beneath the footer.
  const open=()=>{paint();input.scrollIntoView({block:'nearest',inline:'nearest'});floating.open();input.setAttribute('aria-expanded','true');};
  input.onfocus=open;input.oninput=open;input.onclick=open;
  control.onclick=event=>{if(!event.target.closest('button') && event.target!==input)input.focus();};
  input.onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    if(event.key==='ArrowDown'){event.preventDefault();open();list.querySelector('button:not(:disabled)')?.focus();}
    if(event.key==='Backspace' && !input.value && selected.size){const removable=[...selected].filter(id=>!lockedIds.includes(id));if(removable.length)selected.delete(removable.at(-1));paint();onChange(values());}
  };
  list.onkeydown=event=>{const buttons=[...list.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}};
  list.onclick=event=>{const button=event.target.closest('[data-add-extension]');if(!button || button.disabled)return;const item=catalog.find(item=>item.id===button.dataset.addExtension);if(preserveGroups){if(item.selectionKind==='team')expand(item).forEach(value=>selected.delete(value));selected.add(item.id);}else expand(item).forEach(value=>selected.add(value));input.value='';paint();onChange(values());input.focus();close();};
  chips.onclick=event=>{const manager=event.target.closest('[data-select-manager]');if(manager && onManagerChange){selectedManager=manager.dataset.selectManager;paint();onManagerChange(selectedManager);chips.querySelector(`[data-select-manager="${CSS.escape(selectedManager)}"]`)?.focus();close();return;}const button=event.target.closest('[data-remove-extension]');if(button && !button.disabled){selected.delete(button.dataset.removeExtension);paint();onChange(values());input.focus();close();}};
  target.addEventListener('focusout',event=>{if(!search.contains(event.relatedTarget))close();});
  target.onpointerleave=event=>{if(event.pointerType==='mouse')close(true);};
  (target.closest('form') || target).addEventListener('pointerdown',event=>{if(!target.contains(event.target))close(true);});
  paint();
  return {refresh(items=catalog){catalog=items;paint();},value(){return values();},managerId(){return selectedManager;},setValue(nextValues){selected.clear();nextValues.forEach(value=>selected.add(value));paint();onChange(values());}};
}

async function selectionCatalog(api, path, key, target) {
  const items=[];
  for(let page=1;target.isConnected;page++) {
    const result=await api(`${path}?page=${page}`);items.push(...result[key]);
    if(!result.hasMore)break;
  }
  return items;
}
export function createMarketplaceUI(options) {
  const {api,esc}=options;
  return {...marketUI(options,'plugin'),select(target,runtime,provider){
    let catalogs={plugin:[],mcp:[]},loaded=false,currentProvider=provider;
    target.innerHTML=['plugin','mcp'].map(kind=>`<div data-picker="${kind}"></div>`).join('')+'<p class="field-hint" data-selection-state>正在读取已安装插件与 MCP…</p>';
    const pickers=Object.fromEntries(['plugin','mcp'].map(kind=>[kind,createEmployeeMultiSelect(target.querySelector(`[data-picker="${kind}"]`),{
      id:`employee-${kind}-search`,label:kind==='plugin'?'插件':'MCP',placeholder:`搜索并添加${kind==='plugin'?'插件':'MCP'}`,esc,
      selectedIds:runtime.extensionSelection?.[kind==='plugin'?'pluginIds':'mcpIds'] || [],
      available:item=>!currentProvider || item.providers.includes(currentProvider),reason:item=>supportReason(item,currentProvider),
      detail:item=>`${item.description?`<small>${esc(item.description)}</small>`:''}${runtimeBadges(item,esc)}`,
      emptyMessage:()=>loaded?'没有可添加的匹配项':'正在读取…'
    })]));
    const save=target.closest?.('form')?.querySelector('[type=submit]'),state=target.querySelector('[data-selection-state]');
    async function loadSelection(){
      if(save)save.disabled=true;state.setAttribute('role','status');state.textContent='正在读取已安装插件与 MCP…';
      try{const [plugins,mcps]=await Promise.all([selectionCatalog(api,'/api/runtime/marketplace','plugins',target),selectionCatalog(api,'/api/runtime/mcp-marketplace','entries',target)]);if(!target.isConnected)return;catalogs={plugin:plugins,mcp:mcps};loaded=true;for(const kind of ['plugin','mcp'])pickers[kind].refresh(catalogs[kind]);state.textContent=runtime.extensionSelection?.skillIds?.length?'单 Skill 选择已移除，请重新选择完整插件后保存。':currentProvider?'此处配置员工直接选择；角色扩展自动合并，历史任务不变。':'绑定此角色的员工自动继承这些扩展；须兼容员工 Runtime。';if(save)save.disabled=false;}
      catch(error){if(!target.isConnected)return;state.setAttribute('role','alert');state.innerHTML=`扩展读取失败：${esc(error.message)} <button type="button" class="text-action" data-selection-retry>重试</button>`;state.querySelector('[data-selection-retry]').onclick=()=>void loadSelection();}
    }
    void loadSelection();
    return {provider(value){currentProvider=value;Object.values(pickers).forEach(picker=>picker.refresh());},value(){if(!loaded)throw new Error('扩展尚未读取成功，请关闭后重试');for(const kind of ['plugin','mcp'])for(const id of pickers[kind].value()){const item=catalogs[kind].find(item=>item.id===id);if(!item)throw new Error('已选版本未安装，请移除后重新安装选择');if(currentProvider && !item.providers.includes(currentProvider))throw new Error(`「${item.name}」与 ${providerLabel(currentProvider)} 不兼容：${supportReason(item,currentProvider)}`);}return {pluginIds:pickers.plugin.value(),mcpIds:pickers.mcp.value()};}};
  }};
}
