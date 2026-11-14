import { workflowConnections, workflowDescription } from '/client/workflow-description.mjs';
import {WORKFLOW_SIDES,routeGraphEdge,formatWorkflowLayout,attachWorkflowViewport} from './workflow-layout.mjs';

// The graph edits the shared definition; it never decides how a Task executes.
export function createWorkflowEditor(host, { workflow = {}, loadVendor, esc, nameInput, onChange = () => {} }) {
  const nodes = structuredClone(workflow.nodes || []);
  const edges = workflowConnections(workflow).map(edge => ({ ...edge, dependency:edge.dependency ?? false, handoff:edge.handoff ?? true }));
  // Condition diamonds share the 176×80 box, so the four ports sit on their vertices.
  const width = 176, height = () => 80, diamond = `${width/2},0 ${width},40 ${width/2},80 0,40`;
  const visualNodes = () => nodes.map(node => ({...node,width,height:height(node)}));
  let graph, observer, disposed = false, selected = null, preview = false, connectionStart = null, toolFrame = null, viewportControls, revision=0, formatting=false;
  nodes.forEach((node,index) => { node.type ||= 'process'; node.position ||= {x:40 + index % 3 * 240,y:72 + Math.floor(index / 3) * 150}; });
  const unique = (prefix,entries) => {let n=1;while(entries.some(item=>item.id===prefix+n))n++;return prefix+n;};
  const fitText = (value,limit) => {let result='',units=0;for(const point of String(value || '').replace(/\s+/g,' ')){units+=point.codePointAt(0)>255?2:1;if(units>limit)return result+'…';result+=point;}return result;};
  host.className = 'workflow-canvas-editor';
  host.innerHTML = `
    <div class="workflow-editor-meta"><div class="workflow-description-bar"><strong>总体说明</strong><span data-flow-description-summary title="${esc(workflow.description || '')}">${esc(workflow.description || '添加这个工作流的用途与背景')}</span><span class="workflow-editor-count" aria-live="polite"></span><button type="button" class="ghost-button" data-flow-action="edit-description" aria-expanded="false">编辑</button></div><div class="form-field workflow-description-editor" hidden><label class="visually-hidden" for="workflow-description">总体说明</label><textarea id="workflow-description" name="workflowDescription" rows="2" maxlength="20000" placeholder="这个流程用来完成什么">${esc(workflow.description || '')}</textarea></div></div>
    <div class="workflow-editor-body">
      <div class="workflow-editor-surface">
        <div class="workflow-editor-toolbar" role="toolbar" aria-label="画布工具">
          <button type="button" class="ghost-button" data-flow-action="add" disabled><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>流程节点</button><button type="button" class="ghost-button" data-flow-action="add-condition" disabled><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 4l8 8-8 8-8-8z"/></svg>条件节点</button><span class="workflow-tool-divider" aria-hidden="true"></span><button type="button" class="ghost-button" data-flow-action="format" disabled><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="8" height="6" rx="1"/><rect x="13" y="14" width="8" height="6" rx="1"/></svg><span data-format-label>一键整理</span></button>
        </div>
        <div class="workflow-editor-canvas" tabindex="0" role="application" aria-label="工作流画布" aria-description="四边连接点均可作为起点或终点。滚轮缩放、拖动空白平移；+/-缩放，0恢复100%。键盘用 Tab 聚焦节点或连线；Shift+Enter 选起点，再聚焦终点按 Enter 连线；Delete 删除选中项。"></div>
        <div class="workflow-canvas-actions"><button type="button" class="workflow-canvas-delete" data-flow-action="delete" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></svg></button></div>
        <div class="workflow-editor-empty" hidden>添加第一个节点，开始绘制工作流。</div>
        <div class="workflow-zoom-controls" role="group" aria-label="画布缩放"><button type="button" class="ghost-button" data-flow-action="zoom-out" aria-label="缩小画布" disabled>−</button><button type="button" class="ghost-button" data-flow-action="reset-zoom" title="恢复 100%" aria-label="恢复 100%" disabled>100%</button><button type="button" class="ghost-button" data-flow-action="zoom-in" aria-label="放大画布" disabled>＋</button><span class="workflow-tool-divider" aria-hidden="true"></span><button type="button" class="ghost-button" data-flow-action="fit" disabled>适应画布</button></div>
        <div class="workflow-editor-hint">拖动连接点创建连线 · Delete 删除选中</div>
      </div>
      <aside class="workflow-editor-properties" aria-label="标题与提示词"></aside>
      <button type="button" class="small-button workflow-properties-toggle" data-flow-action="toggle-properties" aria-expanded="false">属性</button>
    </div>
    <pre class="workflow-editor-preview" tabindex="0" aria-label="完整工作流文本预览" hidden></pre>
    <span class="workflow-editor-announcement" aria-live="polite"></span>
    <p class="workflow-editor-error" role="alert" hidden></p>`;
  const canvas=host.querySelector('.workflow-editor-canvas'),panel=host.querySelector('.workflow-editor-properties');
  const descriptionInput=host.querySelector('[name=workflowDescription]'),deleteButton=host.querySelector('.workflow-canvas-delete');
  const error = (message,convertId=null) => {const box=host.querySelector('.workflow-editor-error');box.innerHTML=esc(message || '')+(convertId?` <button type="button" class="small-button" data-flow-action="convert-condition" data-node-id="${esc(convertId)}">改为条件节点</button>`:'');box.hidden=!message;};
  const invalidBranch=()=>nodes.find(node=>node.type!=='condition'&&edges.filter(edge=>edge.source===node.id).length>1);
  const branchProblem=node=>`流程节点「${node.title}」最多一条出口连线；多个出口请改为条件节点。`;
  const announce = message => {host.querySelector('.workflow-editor-announcement').textContent=message;};
  const value = () => ({name:nameInput.value.trim(),description:descriptionInput.value.trim(),nodes:nodes.map(node=>({...node,dependsOn:edges.filter(edge=>edge.target===node.id&&edge.dependency).map(edge=>edge.source),handoffFrom:edges.filter(edge=>edge.target===node.id&&edge.handoff).map(edge=>edge.source)})),edges:edges.map(edge=>({...edge}))});
  const initialValue = JSON.stringify(value());
  const nodeName = id => nodes.find(node=>node.id===id)?.title || id;
  const refresh = () => {revision++;onChange(JSON.stringify(value()) !== initialValue);const summary=host.querySelector('[data-flow-description-summary]');summary.textContent=descriptionInput.value || '添加这个工作流的用途与背景';summary.title=descriptionInput.value;host.querySelector('.workflow-editor-count').textContent=`${nodes.length} 个节点 · ${edges.length} 条连线`;host.querySelector('.workflow-editor-empty').hidden=nodes.length>0;if(preview)host.querySelector('.workflow-editor-preview').textContent=workflowDescription(value());const invalid=invalidBranch();error(invalid?branchProblem(invalid):'',invalid?.id);};
  // Canvas grid painters need resolved colors; CSS light-dark() strings are not
  // interpreted in an SVG data image's independent color scheme.
  let resolvedColors;
  const colors = () => {
    if(resolvedColors)return resolvedColors;
    const probe=document.createElement('span');probe.hidden=true;host.append(probe);
    resolvedColors=Object.fromEntries(Object.entries({ink:'--text',muted:'--text-tertiary',paper:'--bg-raised',line:'--border-strong',accent:'--accent',soft:'--accent-soft',canvas:'--bg-subtle',grid:'--border',condition:'--st-planning',conditionFill:'--st-planning-bg',conditionLine:'--st-planning-border'}).map(([name,token])=>{probe.style.color=`var(${token})`;return [name,getComputedStyle(probe).color];}));probe.remove();return resolvedColors;
  };
  function nodeAttrs(node,active=false) {
    const c=colors(),condition=node.type==='condition',show=visible=>visible?'':'none';
    const body={class:'workflow-node-body',fill:condition?c.conditionFill:c.paper,stroke:active?c.accent:condition?c.conditionLine:c.line,strokeWidth:active?2:1,filter:active?{name:'dropShadow',args:{dx:0,dy:0,blur:3,color:c.accent,opacity:.4}}:null};
    // Every text sets the same keys so converting a node never leaves stale offsets.
    const text=(centered,y,size)=>({fontSize:size,refX:centered?.5:12,refY:y,textAnchor:centered?'middle':'start',textVerticalAnchor:'middle'});
    return {body:{...body,rx:6,ry:6,display:show(!condition)},conditionBody:{...body,points:diamond,display:show(condition)},
      kindIcon:{d:'M12 10h10v10H12Z',fill:'none',stroke:c.muted,strokeWidth:1.4,display:show(!condition)},
      kind:{text:'流程',fill:c.muted,fontWeight:400,...text(false,16,11),refX:27,display:show(!condition)},
      title:{text:fitText(node.title,condition?12:22)||'未命名节点',fill:c.ink,fontWeight:600,...(condition?text(true,32,13):text(false,36,13))},
      description:{text:condition?`${edges.filter(edge=>edge.source===node.id).length} 个出口`:fitText(node.description || node.deliverable,24)||'点击编辑提示词',fill:c.muted,...(condition?text(true,50,11):text(false,60,12))}};
  }
  // X6 shortens a marked connection by its line width. Align the marker tip
  // back to the port center rather than adding a visible endpoint gap.
  function edgeAttrs(active=false) {const c=colors(),strokeWidth=active?1.8:1.4;return {line:{class:'workflow-edge-stroke',stroke:active?c.accent:c.muted,strokeWidth,targetMarker:{name:'block',width:10,height:8,refX:-strokeWidth}}};}
  function edgeLabels(edge) {const label=edge.condition || edge.description;if(!label)return [];const c=colors();return [{attrs:{label:{text:fitText(label,28),textWrap:{width:100,height:30,ellipsis:true},fontSize:11,fill:c.muted},body:{fill:c.canvas,stroke:'none',refX:-4,refY:-2,refWidth2:8,refHeight2:4}}}];}
  function queueTool() {if(toolFrame!==null || disposed)return;toolFrame=requestAnimationFrame(()=>{toolFrame=null;positionTool();});}
  function positionTool() {
    if(!graph || !selected || preview || disposed){deleteButton.hidden=true;return;}
    const cell=graph.getCellById(selected.type==='node'?selected.id:'edge:'+selected.id);
    if(!cell){deleteButton.hidden=true;return;}
    let point;
    if(selected.type==='node') {const p=cell.position();point={x:p.x+width-5,y:p.y+5};}
    else point=graph.findViewByCell(cell)?.getPointAtRatio(.5);
    if(!point){deleteButton.hidden=true;return;}
    const client=graph.localToClient(point),box=canvas.getBoundingClientRect();
    const x=client.x-box.left,y=client.y-box.top;
    if(x<0 || x>box.width || y<0 || y>box.height){deleteButton.hidden=true;return;}
    deleteButton.hidden=false;const buttonWidth=deleteButton.offsetWidth,buttonHeight=deleteButton.offsetHeight;deleteButton.style.left=`${Math.max(0,Math.min(box.width-buttonWidth,x-buttonWidth/2))}px`;deleteButton.style.top=`${Math.max(0,Math.min(box.height-buttonHeight,y-buttonHeight/2))}px`;
    const label=selected.type==='node'?'删除选中节点':'删除选中连线';deleteButton.setAttribute('aria-label',label);deleteButton.title=label;
  }
  function accessibleCells() {
    if(!graph)return;
    for(const cell of graph.getCells()) {
      const view=graph.findViewByCell(cell);if(!view)continue;
      const isNode=cell.isNode(),id=isNode?cell.id:cell.getData()?.connectionId,item=isNode?nodes.find(node=>node.id===id):edges.find(edge=>edge.id===id);
      if(!item)continue;
      view.container.setAttribute('tabindex','0');view.container.setAttribute('role','button');
      view.container.setAttribute('aria-label',isNode?`${item.type==='condition'?'条件':'流程'}节点：${item.title || '未命名'}`:`连线：${nodeName(item.source)} → ${nodeName(item.target)}${item.condition?'，'+item.condition:''}`);
      view.container.setAttribute('aria-pressed',String(selected?.type===(isNode?'node':'edge')&&selected.id===id));
    }
  }
  function paintSelection() {if(!graph)return;for(const node of nodes)graph.getCellById(node.id)?.attr(nodeAttrs(node,selected?.type==='node'&&selected.id===node.id));for(const edge of edges)graph.getCellById('edge:'+edge.id)?.attr(edgeAttrs(selected?.type==='edge'&&selected.id===edge.id));accessibleCells();queueTool();}
  function renderPanel() {
    const isNode=selected?.type==='node',item=isNode?nodes.find(node=>node.id===selected.id):edges.find(edge=>edge.id===selected?.id);
    panel.innerHTML=item?`<header class="workflow-properties-head">${isNode?`<svg class="workflow-kind-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${item.type==='condition'?'<path d="M12 4l8 8-8 8-8-8z"/>':'<rect x="6" y="6" width="12" height="12" rx="2"/>'}</svg>`:''}<strong data-selected-title>${esc((isNode?item.title:item.condition) || (isNode?'未命名节点':'连线'))}</strong><span class="settings-provider-count">${isNode?item.type==='condition'?'条件节点':'流程节点':'连线'}</span><small>${isNode?`${edges.filter(edge=>edge.target===item.id).length} 进 · ${edges.filter(edge=>edge.source===item.id).length} 出`:''}</small></header><div class="workflow-properties-body"><div class="form-field"><label for="${isNode?'workflow-node-title':'workflow-edge-title'}">标题${isNode?' <b>*</b>':''}</label><input id="${isNode?'workflow-node-title':'workflow-edge-title'}" data-flow-field="${isNode?'title':'condition'}" ${isNode?'':'maxlength="2000"'} value="${esc((isNode?item.title:item.condition)||'')}" placeholder="${isNode?'节点标题':'例如：通过、需要修改'}" /></div><div class="form-field workflow-prompt-field"><label for="workflow-item-description">提示词 <span data-prompt-count>${Array.from(item.description || '').length} 字</span></label><textarea id="workflow-item-description" aria-label="提示词" data-flow-field="description" maxlength="20000" placeholder="${isNode?'描述这个节点需要完成的工作':'描述这条连线的交接要求或分支规则'}">${esc(item.description || '')}</textarea><p class="field-hint">${isNode?'员工执行该节点时会收到这段说明。':'员工交接时会收到这段说明。'}</p></div></div><footer class="workflow-properties-foot"><button type="button" class="ghost-button danger" data-flow-action="delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg>${isNode?'删除节点':'删除连线'}</button></footer>`:'<header class="workflow-properties-head"><strong>属性</strong></header><div class="workflow-editor-selection-empty">点击节点或连线，编辑标题与提示词。</div>';

    paintSelection();
  }
  function select(type,id) {selected=type?{type,id}:null;if(type)host.classList.add('properties-open');host.querySelector('[data-flow-action=toggle-properties]').setAttribute('aria-expanded',String(host.classList.contains('properties-open')));renderPanel();}
  function draw() {
    if(!graph)return;
    const ids=new Set([...nodes.map(node=>node.id),...edges.map(edge=>'edge:'+edge.id)]);
    for(const cell of graph.getCells())if(!ids.has(cell.id))cell.remove();
    const c=colors();
    for(const node of nodes) {
      const existing=graph.getCellById(node.id);
      if(existing){existing.position(node.position.x,node.position.y);existing.resize(width,height(node));existing.attr(nodeAttrs(node));continue;}
      graph.addNode({id:node.id,zIndex:1,shape:'rect',x:node.position.x,y:node.position.y,width,height:height(node),markup:[{tagName:'rect',selector:'body'},{tagName:'polygon',selector:'conditionBody'},{tagName:'path',selector:'kindIcon'},{tagName:'text',selector:'kind'},{tagName:'text',selector:'title'},{tagName:'text',selector:'description'}],attrs:nodeAttrs(node),ports:{groups:Object.fromEntries(WORKFLOW_SIDES.map(side=>[side,{position:side,attrs:{circle:{r:4,magnet:true,stroke:c.accent,fill:'none',strokeWidth:1.5,pointerEvents:'all'}}}])),items:WORKFLOW_SIDES.map(side=>({id:side,group:side}))}});
    }
    for(const edge of edges) {
      const cell=graph.getCellById('edge:'+edge.id)||graph.addEdge({id:'edge:'+edge.id,zIndex:0,source:{cell:edge.source,port:edge.sourcePort||'right'},target:{cell:edge.target,port:edge.targetPort||'left'},data:{connectionId:edge.id},attrs:edgeAttrs(),connector:{name:'rounded',args:{radius:6}},labels:edgeLabels(edge)});
      routeGraphEdge(cell,visualNodes(),edge);cell.attr(edgeAttrs());
    }
    paintSelection();
  }
  function removeSelected() {
    if(!selected)return;
    if(selected.type==='node') {const index=nodes.findIndex(node=>node.id===selected.id);if(index>=0)nodes.splice(index,1);for(let i=edges.length-1;i>=0;i--)if(edges[i].source===selected.id||edges[i].target===selected.id)edges.splice(i,1);}
    else {const index=edges.findIndex(edge=>edge.id===selected.id);if(index>=0)edges.splice(index,1);}
    selected=null;connectionStart=null;draw();renderPanel();refresh();canvas.focus({preventScroll:true});
  }
  function connect(source,target,sourcePort,targetPort) {
    const origin=nodes.find(node=>node.id===source);if(origin?.type!=='condition'&&edges.some(edge=>edge.source===source))return error(branchProblem(origin),source);
    if(source===target || edges.some(edge=>edge.source===source&&edge.target===target))return error('请选择不同节点，避免重复连线。');
    if(edges.length>=300)return error('最多添加 300 条连线。');
    const edge={id:unique('link_',edges),source,target,...(sourcePort?{sourcePort,targetPort}:{}),condition:'',description:'',dependency:false,handoff:true};edges.push(edge);connectionStart=null;draw();select('edge',edge.id);refresh();announce('已创建连线。');
  }
  function newPosition(type) {
    const box=canvas.getBoundingClientRect(),margin=18;
    const start=graph.clientToLocal(box.left+margin,box.top+margin),end=graph.clientToLocal(box.right-margin,box.bottom-margin),h=height({type});
    const center={x:(start.x+end.x-width)/2,y:(start.y+end.y-h)/2},candidates=[center],step=16/graph.zoom(),gap=10/graph.zoom();
    for(let y=start.y;y<=end.y-h;y+=step)for(let x=start.x;x<=end.x-width;x+=step)candidates.push({x,y});
    candidates.sort((a,b)=>(a.x-center.x)**2+(a.y-center.y)**2-((b.x-center.x)**2+(b.y-center.y)**2));
    return candidates.find(p=>p.x>=start.x&&p.y>=start.y&&p.x+width<=end.x&&p.y+h<=end.y&&!nodes.some(node=>p.x<node.position.x+width+gap&&p.x+width+gap>node.position.x&&p.y<node.position.y+height(node)+gap&&p.y+h+gap>node.position.y));
  }
  function handleClick(event) {
    const button=event.target.closest('[data-flow-action]'),action=button?.dataset.flowAction;
    if(action==='add'||action==='add-condition') {
      if(!graph)return error('画布尚未就绪，请稍后重试。');
      if(nodes.length>=100)return error('最多添加 100 个节点。');
      if(preview){showPreview(false);resizeGraph();}
      const type=action==='add-condition'?'condition':'process',position=newPosition(type);
      if(!position)return error('当前画布没有足够空位，请移动节点或缩小画布后再添加。');
      const node={id:unique('node_',nodes),type,title:type==='condition'?'新条件':'新节点',description:'',staffingGuidance:'',deliverable:'',artifactPaths:[],position};nodes.push(node);draw();select('node',node.id);refresh();const title=panel.querySelector('input');if(title){title.focus({preventScroll:true});title.setSelectionRange(0,title.value.length);}
    }else if(action==='convert-condition'){const node=nodes.find(n=>n.id===button.dataset.nodeId);if(node){node.type='condition';draw();select('node',node.id);refresh();}}
    else if(action==='format')void formatGraph();
    else if(action==='zoom-in')viewportControls?.zoom(graph.zoom()*1.2);
    else if(action==='zoom-out')viewportControls?.zoom(graph.zoom()/1.2);
    else if(action==='reset-zoom')viewportControls?.zoom(1);
    else if(action==='fit')graph?.zoomToFit({padding:35,maxScale:1});
    else if(action==='delete')removeSelected();
    else if(action==='retry')init();
    else if(action==='preview')showPreview(!preview);
    else if(action==='edit-description'){const field=host.querySelector('.workflow-description-editor');field.hidden=!field.hidden;button.setAttribute('aria-expanded',String(!field.hidden));button.textContent=field.hidden?'编辑':'完成';if(!field.hidden)descriptionInput.focus();}
    else if(action==='toggle-properties'){host.classList.toggle('properties-open');button.setAttribute('aria-expanded',String(host.classList.contains('properties-open')));}
  }
  async function formatGraph() {
    if(!graph||formatting)return;
    const version=revision,button=host.querySelector('[data-flow-action=format]');formatting=true;button.disabled=true;button.querySelector('[data-format-label]').textContent='正在整理…';
    try{await loadVendor('elk');const positions=await formatWorkflowLayout(visualNodes(),edges,new window.ELK());if(disposed)return;if(version!==revision)throw new Error('工作流已更改，请重新整理。');for(const result of positions)nodes.find(n=>n.id===result.id).position=result.position;for(const edge of edges){delete edge.sourcePort;delete edge.targetPort;}draw();refresh();graph.zoomToFit({padding:35,maxScale:1});announce('已整理节点与直角连线，保存工作流后保留布局。');}
    catch(problem){if(!disposed)error(problem.message);}finally{formatting=false;if(!disposed){button.disabled=false;button.querySelector('[data-format-label]').textContent='一键整理';}}
  }
  function showPreview(next) {preview=next;host.querySelector('.workflow-editor-body').hidden=preview;host.querySelector('.workflow-editor-preview').hidden=!preview;const button=host.closest('form').querySelector('[data-flow-action=preview]');button.setAttribute('aria-pressed',String(preview));button.textContent=preview?'返回画布':'文本预览';if(!preview)requestAnimationFrame(resizeGraph);refresh();}
  function handleInput(event) {
    const field=event.target.dataset.flowField;
    if(!field){refresh();return;}
    const item=selected?.type==='node'?nodes.find(node=>node.id===selected.id):edges.find(edge=>edge.id===selected?.id);if(!item)return;
    item[field]=event.target.value;
    if(field==='description')panel.querySelector('[data-prompt-count]').textContent=`${Array.from(item.description || '').length} 字`;
    else panel.querySelector('[data-selected-title]').textContent=item.title || item.condition || (selected.type==='node'?'未命名节点':'连线');
    if(selected.type==='node')graph?.getCellById(item.id)?.attr(nodeAttrs(item,true));else graph?.getCellById('edge:'+item.id)?.setLabels(edgeLabels(item));
    accessibleCells();queueTool();refresh();
  }
  function focusedCell(target) {const element=target.closest('[data-cell-id]');if(!element || !canvas.contains(element))return null;const id=element.getAttribute('data-cell-id');return id.startsWith('edge:')?{type:'edge',id:id.slice(5)}:{type:'node',id};}
  function handleKey(event) {
    if(event.target.closest('input,textarea,select,[contenteditable=true]'))return;
    if(!event.target.closest('.workflow-editor-canvas,.workflow-canvas-actions'))return;
    const item=focusedCell(event.target);
    if(event.key==='Escape'){connectionStart=null;announce('已取消连线。');return;}
    if(['Delete','Backspace'].includes(event.key)){event.preventDefault();if(item)select(item.type,item.id);removeSelected();return;}
    if(item&&['Enter',' '].includes(event.key)) {
      event.preventDefault();event.stopPropagation();
      if(item.type==='node'&&event.shiftKey){connectionStart=item.id;select('node',item.id);announce('已选连线起点，请聚焦终点并按 Enter。');}
      else if(item.type==='node'&&connectionStart)connect(connectionStart,item.id);
      else select(item.type,item.id);
    }
  }
  host.addEventListener('click',handleClick);host.addEventListener('input',handleInput);host.addEventListener('keydown',handleKey);nameInput.addEventListener('input',refresh);
  function resizeGraph() {if(!graph||disposed||preview)return;const surface=canvas.parentElement;if(surface.clientWidth>0&&surface.clientHeight>0){graph.resize(surface.clientWidth,surface.clientHeight);queueTool();}}
  async function init() {
    canvas.textContent='正在准备画布…';
    try {
      await loadVendor('x6');if(disposed||!host.isConnected)return;
      const Graph=window.X6?.Graph;if(!Graph)throw new Error('流程图组件不可用');canvas.replaceChildren();const c=colors();
      graph=new Graph({async:false,container:canvas,width:canvas.clientWidth,height:canvas.clientHeight,background:{color:c.canvas},grid:{visible:true,size:18,type:'dot',args:{color:c.grid}},panning:{enabled:true,eventTypes:['leftMouseDown','rightMouseDown']},mousewheel:{enabled:false},interacting:()=>({nodeMovable:!formatting,magnetConnectable:!formatting,edgeMovable:false,edgeLabelMovable:false,arrowheadMovable:false,vertexMovable:false}),connecting:{allowBlank:false,allowLoop:false,allowMulti:false,allowNode:false,snap:{radius:22},highlight:true,connectionPoint:'anchor',
        createEdge:()=>graph.createEdge({id:'edge:'+unique('link_',edges),zIndex:0,attrs:edgeAttrs(),router:{name:'manhattan',args:{padding:16}},connector:{name:'rounded',args:{radius:8}}}),
        validateConnection:({sourceCell,targetCell,targetMagnet})=>{if(!sourceCell||!targetCell||sourceCell.id===targetCell.id||!WORKFLOW_SIDES.includes(targetMagnet?.getAttribute('port')))return false;const origin=nodes.find(node=>node.id===sourceCell.id);if(origin?.type!=='condition'&&edges.some(edge=>edge.source===sourceCell.id)){error(branchProblem(origin),origin.id);return false;}return !edges.some(edge=>edge.source===sourceCell.id&&edge.target===targetCell.id);}}});
      draw();graph.on('node:click',({node})=>{select('node',node.id);canvas.focus({preventScroll:true});});graph.on('edge:click',({edge})=>{select('edge',edge.getData()?.connectionId);canvas.focus({preventScroll:true});});graph.on('blank:click',()=>select(null));
      graph.on('node:moved',({node})=>{const item=nodes.find(item=>item.id===node.id);if(item){item.position=node.position();for(const edge of edges)routeGraphEdge(graph.getCellById('edge:'+edge.id),visualNodes(),edge);refresh();queueTool();}});graph.on('node:change:position scale translate',queueTool);
      graph.on('edge:connected',({edge})=>{if(edge.getData()?.connectionId)return;const source=edge.getSourceCellId(),target=edge.getTargetCellId(),sourcePort=edge.getSourcePortId(),targetPort=edge.getTargetPortId();edge.remove();if(!source||!target)return;connect(source,target,sourcePort,targetPort);});
      viewportControls=attachWorkflowViewport(graph,canvas,scale=>{const button=host.querySelector('[data-flow-action=reset-zoom]');button.textContent=Math.round(scale*100)+'%';canvas.dataset.scale=String(scale);queueTool();});
      observer=new ResizeObserver(resizeGraph);observer.observe(canvas.parentElement);requestAnimationFrame(()=>{if(disposed)return;resizeGraph();if(nodes.length&&!preview)graph.zoomToFit({padding:35,maxScale:1});host.dataset.ready='true';host.querySelectorAll('[data-flow-action=add],[data-flow-action=add-condition],[data-flow-action=fit],[data-flow-action=format],[data-flow-action=zoom-in],[data-flow-action=zoom-out],[data-flow-action=reset-zoom]').forEach(button=>button.disabled=false);queueTool();});
    }catch(problem){if(!disposed){canvas.replaceChildren();const retry=document.createElement('button');retry.type='button';retry.className='small-button';retry.dataset.flowAction='retry';retry.textContent='重试加载画布';canvas.append(retry);error(problem.message);}}
  }
  renderPanel();refresh();const ready=init();
  return {ready,togglePreview:()=>showPreview(!preview),value:()=>{if(!graph)throw new Error('画布尚未就绪，请重试加载后保存。');const invalid=invalidBranch();if(invalid)throw new Error(branchProblem(invalid));return value();},dispose:()=>{disposed=true;if(toolFrame!==null)cancelAnimationFrame(toolFrame);observer?.disconnect();viewportControls?.dispose();graph?.dispose();graph=null;host.removeEventListener('click',handleClick);host.removeEventListener('input',handleInput);host.removeEventListener('keydown',handleKey);nameInput.removeEventListener('input',refresh);}};
}
