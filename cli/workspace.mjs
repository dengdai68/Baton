import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {usage, readInput, validateInput, CliError} from './client.mjs';
import {resources} from './commands.mjs';

const fields=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
const conversationView=value=>({...fields(value,['id','kind','targetId','name','workspacePath','unreadCount','createdAt','updatedAt','preview','pending']),members:value.members?.map(member=>fields(member,['id','name','status','running'])) || []});
const chatView=value=>({...value,...(value.conversation?{conversation:conversationView(value.conversation)}:{})});
export const resourceId=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
// communications get pages match other CLI record pages; --all reads larger windows.
const MESSAGE_PAGE_SIZE=20, ALL_MESSAGES_WINDOW=200;

// Upload through the same authenticated endpoint as the renderer. Keyed retries
// reuse saved attachments after checking the original local bytes.
export async function uploadAttachments(client,base,input,previous) {
  const paths=input.attachmentPaths || [],ids=[...(input.attachmentIds || [])];
  if(paths.length+ids.length>10)throw usage('每条消息最多 10 个附件');
  if(previous && previous.attachments.length!==paths.length+ids.length)throw usage('clientRequestId 对应的附件数量已改变');
  for(const [index,path] of paths.entries()) {
    const file=await open(path,'r');let stream;
    try {
      const info=await file.stat(),name=path.split(/[\\/]/).at(-1);
      if(!info.isFile() || info.size>20*1024*1024)throw usage('附件必须是单个普通文件且不超过 20 MiB');
      if(previous) {
        const old=previous.attachments[(input.attachmentIds?.length || 0)+index];
        const sha256=createHash('sha256').update(await file.readFile()).digest('hex');
        if(old.name!==name || old.bytes!==info.size || old.sha256!==sha256)throw new CliError('CLIENT_REQUEST_CONFLICT','clientRequestId 对应的本机附件内容已改变','编辑后的消息请使用新的 clientRequestId。',4);
        ids.push(old.id);
      } else {
        stream=file.createReadStream({autoClose:false});
        ids.push((await client.request(`${base}/attachments?name=${encodeURIComponent(name)}`,{method:'POST',body:stream})).attachment.id);
      }
    } finally {stream?.destroy();await file.close();}
  }
  const {attachmentPaths,...body}=input;
  return {...body,...(ids.length?{attachmentIds:ids}:{})};
}

export async function executeCommunication(client,operation,id,flags,page,stdin,options) {
  const base='/api/communications'+(id?'/'+id:'');
  if(operation==='list') {
    // The desktop conversation directory is paged but has no search control.
    if(flags.search!==undefined)throw usage('沟通列表不支持 --search；使用 list 分页查询');
    let result=await client.request(`${base}?page=${page}`),items=result.conversations;
    if(flags.all)for(let current=result.page+1;current<=result.totalPages;current++)items.push(...(await client.request(`${base}?page=${current}`)).conversations);
    const {conversations,...pagination}=result;
    return {...pagination,items:items.map(conversationView),...(flags.all?{page:null,pageSize:null,hasMore:false}:{})};
  }
  if(operation==='get') {
    // Paged like task collaboration: 20 messages per page, newest first. --page N
    // follows the server's before-cursor N-1 times; --all reads every window.
    const query=new URLSearchParams({limit:String(flags.all?ALL_MESSAGES_WINDOW:MESSAGE_PAGE_SIZE)});
    const first=await client.request(`${base}?${query}`),windows=[first];
    let current=1,last=first;
    while(last.hasMore&&(flags.all||current<page)){query.set('before',last.nextBefore);last=await client.request(`${base}?${query}`);windows.push(last);current++;}
    const selected=flags.all?windows:current===page?[last]:[];
    const {messages,deliveries,hasMore,nextBefore,...thread}=chatView(first);
    return {...thread,
      messages:selected.flatMap(window=>[...window.messages].reverse()),
      deliveries:[...new Map(selected.flatMap(window=>window.deliveries).map(row=>[row.id,row])).values()],
      page:flags.all?null:page,pageSize:flags.all?null:MESSAGE_PAGE_SIZE,hasMore:!flags.all&&current===page&&last.hasMore};
  }
  if(operation==='delete') {
    if(!flags.yes)throw usage('删除群聊需要显式 --yes');
    return client.request(base,{method:'DELETE',body:{}});
  }
  const consoleResult=await workspaceRead(client,base,operation,flags,options);
  if(consoleResult!==undefined)return consoleResult;
  let input=await readInput(flags.file,stdin);
  if(operation==='message' && flags['client-request-id']!==undefined){if(input.clientRequestId && input.clientRequestId!==flags['client-request-id'])throw usage('clientRequestId 两处输入不一致');input.clientRequestId=flags['client-request-id'];}
  validateInput(input,resources.communications.operationInputs?.[operation]?.schema || resources.communications.schema);
  if(operation==='create') {
    if(input.kind==='agent' && (!resourceId(input.targetId) || Object.hasOwn(input,'name') || Object.hasOwn(input,'memberAgentIds')))throw usage('私聊仅接受 kind=agent 和 targetId');
    if(input.kind==='group' && (input.targetId!==undefined || !input.memberAgentIds?.length))throw usage('群聊需要 memberAgentIds，不接受 targetId');
  }
  if(operation==='message') {
    if(flags['client-request-id']!==undefined){if(input.clientRequestId && input.clientRequestId!==flags['client-request-id'])throw usage('clientRequestId 两处输入不一致');input.clientRequestId=flags['client-request-id'];}
    if(!input.content.trim() && !input.attachmentPaths?.length && !input.attachmentIds?.length)throw usage('消息不能为空');
    let previous;
    if(input.attachmentPaths?.length) {
      let cursor;
      do {const result=await client.request(base+(cursor?'?before='+encodeURIComponent(cursor):''));previous=result.messages.find(row=>row.clientRequestId===input.clientRequestId);cursor=result.hasMore?result.nextBefore:null;}while(!previous && cursor);
    }
    input=await uploadAttachments(client,base,input,previous);
    return client.request(base+'/messages',{method:'POST',body:input});
  }
  if(operation==='retry') {
    if(!resourceId(input.deliveryId))throw usage('deliveryId 需要精确 ID');
    return client.request(`${base}/deliveries/${input.deliveryId}/retry`,{method:'POST',body:{}});
  }
  if(operation==='read')return client.request(base+'/read',{method:'POST',body:input});
  const result=await client.request(base,{method:operation==='create'?'POST':'PUT',body:input});
  return chatView(result);
}

export async function workspaceRead(client,base,operation,flags,{signal,pollMs=2000}={}) {
  if(operation==='console-content')return client.request(`${base}/console-content/${flags.event}`);
  if(operation==='artifact')return flags.output?client.download(`${base}/artifacts/${flags.artifact}/raw`,flags.output):client.request(`${base}/artifacts/${flags.artifact}/content`);
  if(operation==='attachment')return client.download(`${base}/attachments/${flags.attachment}`,flags.output);
  if(operation==='files')return client.request(`${base}/working-directory?`+new URLSearchParams({path:flags.path || '',offset:flags.offset || '0'}));
  if(operation==='file')return client.request(`${base}/working-directory/content?`+new URLSearchParams({path:flags.path}));
  if(operation==='download')return client.download(`${base}/working-directory/content?`+new URLSearchParams({path:flags.path,download:'1'}),flags.output);
  if(operation==='changes' || operation==='diff')return client.request(`${base}/working-directory/${operation}?`+new URLSearchParams({path:flags.path || '',full:flags.full?'1':'0'}));
  if(operation!=='console')return;
  const query=new URLSearchParams({limit:'100'});if(flags.agent)query.set('agentId',flags.agent);if(flags.before)query.set('before',flags.before);
  const read=before=>{const params=new URLSearchParams(query);if(before)params.set('before',before);return client.request(`${base}/console?${params}`);};
  const initial=await read();
  if(!flags.follow)return initial;
  return (async function*(){
    yield initial;
    let latest=initial.events.at(-1)?.id;
    while(!signal?.aborted) {
      try{await delay(pollMs,undefined,{signal});}catch(error){if(signal?.aborted)return;throw error;}
      if(signal?.aborted)return;
      let page=await read(),batches=[],traces=new Map();
      // Walk backward to the last observed event, including bursts larger than
      // one HTTP page. Events are immutable; no timestamp-based deduplication.
      while(true) {
        for(const trace of page.traces || [])traces.set(trace.id,trace);
        const index=latest?page.events.findIndex(row=>row.id===latest):-1;
        batches.unshift(index>=0?page.events.slice(index+1):page.events);
        if(index>=0 || !page.hasMore)break;
        page=await read(page.nextBefore);
      }
      const events=batches.flat();if(!events.length)continue;
      latest=events.at(-1).id;yield {events,traces:[...traces.values()],hasMore:false};
    }
  })();
}
