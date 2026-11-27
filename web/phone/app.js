const panel = document.querySelector('#body');
const status = document.querySelector('#status');
const api = '/api/account/relay';
const el = (tag, text) => Object.assign(document.createElement(tag), {textContent:text || ''});
const address = el('input');
address.type = 'url';
address.placeholder = 'https://relay.example.com';
const label = el('label', '此账号使用的 Relay 地址');
label.append(address);
const account = el('p');
const connection = el('p');
const identity = el('code');
const fingerprint = el('details');
fingerprint.append(el('summary','Mac 接入指纹'), identity);
const invitation = el('section');
const devices = el('section');
let currentInvite, initialized = false, editing = false;
async function request(path = '', method = 'GET', data) {
  const response = await fetch(api + path, {method,cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '请求失败');
  return result;
}
function button(title, action) {
  const control = el('button',title);
  control.onclick = async () => {
    control.disabled = true;
    try { status.textContent=''; await action(); }
    catch (error) { status.textContent=error.message; }
    finally { control.disabled=false; }
  };
  return control;
}
const save = button('保存地址', async () => {
  const value = address.value.trim();
  if (initialized && currentOrigin && value !== currentOrigin &&
    !confirm('更改 Relay 会撤销此账号的邀请和已配对手机。继续？')) return;
  await request('',value ? 'PUT' : 'DELETE',value ? {relay:value} : undefined);
  editing=false; currentInvite=null; invitation.replaceChildren(); await refresh();
});
const add = button('添加手机', async () => {
  const data = await request('/invites','POST',{});
  currentInvite = data;
  const qr = el('img'); qr.src=data.qr; qr.alt='一次性配对二维码'; qr.width=264;
  const link = el('input'); link.value=data.link; link.readOnly=true; link.setAttribute('aria-label','一次性配对地址');
  link.onclick=()=>link.select();
  const copy=button('复制地址',async()=>{await navigator.clipboard.writeText(link.value); status.textContent='已复制配对地址';});
  invitation.replaceChildren(qr,el('p','用手机 Baton 扫码，或在登录页输入此地址。十分钟内有效。'),link,copy);
});
let currentOrigin = '';
async function refresh() {
  const state = await request();
  if (!editing) address.value=state.origin;
  account.textContent=state.account ? '签发账号 · '+state.account : '';
  currentOrigin=state.origin; initialized=true;
  connection.textContent=state.origin ? state.online ? '已连接' : state.error === 'Relay HTTP 403' ? 'Relay 未允许此 Mac，请将下方指纹加入接入名单' : '正在重连，请检查 Relay 地址和接入指纹' : '尚未设置 Relay';
  identity.textContent=state.pin; add.disabled=!state.online;
  devices.replaceChildren(el('h2','已配对手机'));
  for (const device of state.devices) {
    const row=el('p',device.label+' · '+new Date(device.created).toLocaleString()+' ');
    row.append(button('移除',async()=>{await request('/devices/'+device.id,'DELETE'); await refresh();}));
    devices.append(row);
  }
  if (!state.devices.length) devices.append(el('p','尚无配对手机'));
  if (currentInvite) {
    const matched=state.devices.find(d=>d.invitation===new URL(currentInvite.link).searchParams.get('r'));
    if (matched || Date.now()>=currentInvite.expires) {
      invitation.replaceChildren(el('p',matched ? '已添加 '+matched.label : '配对地址已过期，请重新生成'));
      currentInvite=null;
    }
  }
}
address.oninput=()=>{editing=true;};
panel.append(account,label,save,connection,fingerprint,add,invitation,devices);
async function poll() {
  try { if (!document.hidden) await refresh(); } catch(error) {status.textContent=error.message;}
  setTimeout(poll,2000);
}
void poll();

// Keep the existing LAN / manually configured SSH entry available on this page.
async function directAccess() {
  const response = await fetch('/api/phone/status');
  if (!response.ok) return;
  const state = await response.json();
  const details = el('details');
  details.append(el('summary','局域网与 SSH 转发'));
  if (state.origin) details.append(el('p',state.origin));
  else {
    const input = el('input'); input.value = state.suggested || '';
    const addressLabel = el('label','工作空间地址'); addressLabel.append(input);
    const ssh = el('input'); ssh.type = 'checkbox';
    const sshLabel = el('label','使用已配置的 SSH 转发'); sshLabel.append(ssh);
    details.append(addressLabel,sshLabel,button('启用手机连接',async()=>{
      const result=await fetch('/api/phone/enable',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({origin:input.value.trim(),relay:ssh.checked})});
      if (!result.ok) throw Error((await result.json()).error);
      details.remove(); await directAccess();
    }));
  }
  panel.append(details);
}
void directAccess().catch(error=>{status.textContent=error.message;});
