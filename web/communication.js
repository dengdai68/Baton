import { $t, $tm, currentLocale, intlLocale } from "../client/i18n.mjs";
import { captureConsoleReading, restoreConsoleReading, followConsoleLatest, onConsoleLatest, readConsoleTail } from './console-stream.mjs';
import { runtimeLabel } from '../client/runtime-providers.mjs';
import { ByteCache } from "../client/byte-cache.mjs";
import { consoleEventWindow, formatMessageTime } from "../client/console-projections.mjs";

// Let the browser own ordinary line breaks, caret following and undo. Other
// modifier+Enter shortcuts need an explicit insertion on macOS Chromium.
export function insertComposerLineBreak(event) {
  if (event.shiftKey && !event.metaKey && !event.altKey && !event.ctrlKey) return;
  event.preventDefault();
  const input = event.target;
  input.setRangeText("\n", input.selectionStart, input.selectionEnd, "end");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  if (input.selectionEnd === input.value.length) { input.scrollTop = input.scrollHeight; return; }

  // Mid-draft edits must reveal the caret, rather than jump to the last line.
  const doc = input.ownerDocument, style = doc.defaultView.getComputedStyle(input);
  const mirror = doc.createElement("div"), caret = doc.createElement("span");
  mirror.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;box-sizing:border-box;border:0;margin:0;top:0;left:0;white-space:pre-wrap;overflow-wrap:break-word;";
  for (const key of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "tabSize", "textIndent", "textAlign", "direction", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "wordBreak"]) mirror.style[key] = style[key];
  mirror.style.width = `${input.clientWidth}px`;
  mirror.textContent = input.value.slice(0, input.selectionEnd);
  caret.textContent = "\u200b";
  mirror.append(caret); doc.body.append(mirror);
  try {
    const top = caret.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
    const bottom = top + (parseFloat(style.lineHeight) || caret.getBoundingClientRect().height);
    const paddingTop = parseFloat(style.paddingTop) || 0, paddingBottom = parseFloat(style.paddingBottom) || 0;
    if (top < input.scrollTop + paddingTop) input.scrollTop = top - paddingTop;
    else if (bottom > input.scrollTop + input.clientHeight - paddingBottom) input.scrollTop = bottom + paddingBottom - input.clientHeight;
  } finally { mirror.remove(); }
}

export function attachmentImageError(event) {
  if (event.target.matches?.('.communication-image img')) event.target.closest('.communication-image').dataset.imageError = 'true';
}
export function openAttachmentImage(trigger, onClose = () => {}) {
    const dialog = document.createElement('dialog'); dialog.className = 'communication-image-viewer';
    const name = trigger.dataset.imageName, url = trigger.dataset.imageUrl;
    dialog.setAttribute('aria-label', $t("图片预览：{0}", [name]));
    dialog.innerHTML = `<header><strong>${escapeHtml(name)}</strong><div class="communication-image-actions"><a class="text-action" href="${escapeHtml(url.replace(/\?preview=1$/, ""))}" download="${escapeHtml(name)}" data-image-download>${$t("下载")}</a><button type="button" class="text-action" data-close-image aria-label="${$t("关闭图片预览（Esc）")}">×</button></div></header><div class="communication-image-stage"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}"><p role="status" hidden>${$t("图片无法预览，请关闭后下载原文件。")}</p></div>`;
    dialog.querySelector('[data-close-image]').onclick = () => dialog.close();
    dialog.querySelector('[data-image-download]').onclick = async event => {
      event.preventDefault();
      try { await downloadAttachment(event.currentTarget); }
      catch (error) { const status = dialog.querySelector('[role=status]'); status.textContent = error.message; status.hidden = false; }
    };
    dialog.querySelector('img').onerror = event => { event.target.hidden = true; dialog.querySelector('[role=status]').hidden = false; };
    dialog.querySelector('.communication-image-stage').onclick = event => { if (event.target.classList.contains('communication-image-stage')) dialog.close(); };
    dialog.onclick = event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    };
    dialog.onclose = () => { dialog.remove(); if (trigger.isConnected) trigger.focus({preventScroll:true}); onClose(); };
    document.body.append(dialog); dialog.showModal(); return dialog;
}
export async function downloadAttachment(link) {
  const response = await fetch(link.href,{method:'HEAD'});
  // HEAD intentionally has no response body, including error responses.
  if (!response.ok) throw new Error($t("附件下载失败（HTTP {0}）", [response.status]));
  const download=document.createElement('a');download.href=link.href;download.download=link.download;download.click();
}

import { createEmployeeMultiSelect, extensionAvatarColor } from "./marketplace.mjs";
import { paginate, paginationMarkup } from "./pagination.mjs";
import { createFloatingList, closeFloatingList, closeFloatingLists } from './floating-list.mjs';
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const date = (value) => new Date(value).toLocaleString(intlLocale(), { hour12: false });
const messageDayKey = value => {
  const day = new Date(value);
  return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
};
export function communicationDayLabel(value, today = new Date()) {
  const day = new Date(value), yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (messageDayKey(day) === messageDayKey(today)) return $t("今天");
  if (messageDayKey(day) === messageDayKey(yesterday)) return $t("昨天");
  const sameYear = day.getFullYear() === today.getFullYear();
  if (currentLocale() === 'zh-CN') return `${sameYear ? '' : `${day.getFullYear()}年`}${day.getMonth() + 1}月${day.getDate()}日`;
  return day.toLocaleDateString(intlLocale(), { ...(sameYear ? {} : { year: 'numeric' }), month: 'long', day: 'numeric' });
}
const shortTime = value => value ? new Date(value).toLocaleTimeString(intlLocale(), {hour:'2-digit', minute:'2-digit', hour12:false}) : '';
const consoleIcon = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m7 9 3 3-3 3m6 0h4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
// Gear-shaped settings icon for group chat editing.
const settingsIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M10.7 2.1L13.3 2.1L13.6 4.6L16.1 5.6L18.1 4.1L19.9 5.9L18.4 7.9L19.4 10.4L21.9 10.7L21.9 13.3L19.4 13.6L18.4 16.1L19.9 18.1L18.1 19.9L16.1 18.4L13.6 19.4L13.3 21.9L10.7 21.9L10.4 19.4L7.9 18.4L5.9 19.9L4.1 18.1L5.6 16.1L4.6 13.6L2.1 13.3L2.1 10.7L4.6 10.4L5.6 7.9L4.1 5.9L5.9 4.1L7.9 5.6L10.4 4.6Z"/><circle cx="12" cy="12" r="3"/></svg>';

export const imageAttachment = name => /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name || '');
const attachmentSize = bytes => bytes == null ? '' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${bytes} B`;
export const imageButton = (url, name, thumbnail=url) => `<button type="button" class="communication-image" data-chat-image data-image-url="${escapeHtml(url)}" data-image-name="${escapeHtml(name)}" aria-label="${$t("放大查看 {0}", [escapeHtml(name)])}"><img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(name)}" loading="lazy"><span class="communication-image-error">${$t("图片无法预览")}</span></button>`;
const attachmentIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9"/></svg>';
const pictureIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg>';
export function attachmentControls(scope, disabled = false) {
  return `<button type="button" class="composer-icon-button" data-${scope}-attach aria-label="${$t("添加附件")}" title="${$t("添加附件")}" ${disabled ? 'disabled' : ''}>${attachmentIcon}</button><button type="button" class="composer-icon-button" data-${scope}-attach-image aria-label="${$t("添加图片")}" title="${$t("添加图片")}" ${disabled ? 'disabled' : ''}>${pictureIcon}</button>`;
}
export function draftAttachments(items, scope, disabled = false) {
  return items.map(item => {
    const name = escapeHtml(item.file.name);
    const remove = `<button type="button" class="composer-remove" data-remove-${scope}-attachment="${escapeHtml(item.id)}" aria-label="${$t("移除附件 {0}", [name])}" title="${$t("移除 {0}", [name])}" ${disabled ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>`;
    return item.previewURL
      ? `<div class="communication-draft-image">${imageButton(item.previewURL, item.file.name)}${remove}</div>`
      : `<div class="communication-attachment pending" title="${name}">${attachmentIcon}<span class="composer-file-info"><span>${name}</span><small>${escapeHtml(item.file.name.split(".").length > 1 ? item.file.name.split(".").pop().toUpperCase().slice(0,12) : $t("文件"))}</small></span>${remove}</div>`;
  }).join('');
}
export function messageAttachments(files, conversationId, scope = "communications") {
  if (!files.length) return '';
  return `<div class="communication-attachment-list">${files.map(file => {
    const url = `/api/${scope}/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(file.id)}`;
    if (imageAttachment(file.name)) return `<figure class="communication-image-item">${imageButton(url + '?preview=1', file.name)}</figure>`;
    return `<a class="communication-attachment" href="${url}" download="${escapeHtml(file.name)}" data-attachment-download>${attachmentIcon}<span>${escapeHtml(file.name)}</span><small>${attachmentSize(file.bytes)}</small></a>`;
  }).join('')}</div>`;
}

export function latestConversationId(conversations = []) {
  return conversations.reduce((latest,item)=>!latest || (Date.parse(item.updatedAt)||0)>(Date.parse(latest.updatedAt)||0)?item:latest,null)?.id || null;
}

export function memberMentionMarkup(html, names = [], document = globalThis.document) {
  const members = [...new Set(names.filter(name => typeof name === 'string' && name))].sort((a, b) => b.length - a.length);
  if (!members.length || !document?.createTreeWalker) return html;
  const container = document.createElement('div'); container.innerHTML = html;
  const pattern = new RegExp('@(?:' + members.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'g');
  const walker = document.createTreeWalker(container, 4), nodes = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('code,pre,a,.member-mention')) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue, matches = [...text.matchAll(pattern)];
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment(); let offset = 0;
    for (const match of matches) {
      fragment.append(document.createTextNode(text.slice(offset, match.index)));
      const mention = document.createElement('strong'); mention.className = 'member-mention'; mention.textContent = match[0]; fragment.append(mention);
      offset = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(text.slice(offset))); node.replaceWith(fragment);
  }
  return container.innerHTML;
}

export function formatCommunicationContent(content, { parse, sanitize, mentions = [] } = {}) {
  const fallback = `<span class="communication-plain">${escapeHtml(content)}</span>`;
  if (typeof parse !== "function" || typeof sanitize !== "function") return memberMentionMarkup(fallback, mentions);
  try {
    const html = parse(String(content));
    if (typeof html !== "string") return memberMentionMarkup(fallback, mentions);
    return memberMentionMarkup(sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["img", "video", "audio", "picture", "source", "iframe", "style", "form", "input", "button"], FORBID_ATTR: ["style"], ALLOW_DATA_ATTR: false }), mentions);
  } catch { return memberMentionMarkup(fallback, mentions); }
}

export function activeMention(value, caret, selected = []) {
  const match = value.slice(0, caret).match(/@([^@\n]{0,60})$/);
  if (!match || selected.some((member) => match[1].startsWith(member.name + " "))) return null;
  return match;
}

// Stable per-sender accents, never an inferred execution or business status.
export function communicationSenderTone(sender = {}) {
  if (sender.type === "human") return "info";
  const key = String(sender.id || sender.name || "agent");
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return hash % 2 ? "violet" : "teal";
}

// Local delivery feedback is deliberately separate from persisted messages.
// A rejected/lost response cannot prove that the server did not save a message.
export function outgoingMessageFeedback(entry, scope) {
  if (!entry || entry.status !== 'unconfirmed') return '';
  return `<div class="outgoing-message-feedback" role="alert" data-outgoing-feedback="unconfirmed"><span>${$t("发送未确认")}</span><small>${$t("{0}。请先检查记录，再恢复草稿；不会自动重发。", [escapeHtml(entry.error)])}</small><button type="button" class="text-action" data-recover-${scope}-message="${escapeHtml(entry.id)}">${$t("恢复草稿")}</button></div>`;
}

export function outgoingAttachmentMarkup(entry) {
  return entry?.attachments?.length ? `<div class="communication-attachment-list outgoing-attachments">${entry.attachments.map(item=>item.previewURL && imageAttachment(item.file.name) ? `<figure class="communication-image-item">${imageButton(item.previewURL,item.file.name)}</figure>` : `<span class="communication-attachment">${imageAttachment(item.file.name) ? pictureIcon : attachmentIcon}<span>${escapeHtml(item.file.name)}</span><small>${attachmentSize(item.file.size)}</small></span>`).join('')}</div>` : '';
}

export function createCommunicationUI({ api, navigate, notify, confirmDialog = async () => false, prepareContent = async () => {}, renderContent = escapeHtml, renderConsole = () => {}, renderAvatar = () => '', onRead = () => {} }) {
  let host, currentId = null, generation = 0, timer, contacts = [], conversations = [];
  let listLoaded = false, listError = "", listRequest = null, listPage = 1, listPagination = {page:1,totalPages:1,total:0};
  const views = new Map(), markdownCache=new ByteCache({maxBytes:4*1024*1024,maxEntries:300});
  let imageViewer = null;
  const view = (key) => {
    if (!views.has(key)) views.set(key, { messages: new Map(), readMessageIds: new Set(), deliveries: new Map(), draft: "", mentions: [], attachments: [], consoleOpen: false, consoleAgentId: null, consoleMembers: [], consolePages: new Map(), consoleRequest: null, consoleError: '', requestId: null, hasMore: false, before: null, loaded: false, sending: false, latestError: "", olderError: "", historyEpoch: 0, latestRequest: null, olderRequest: null });
    return views.get(key);
  };
  const query = (selector) => host?.querySelector(selector);
  const isCurrent = (key, token) => host?.isConnected && key === currentId && token === generation;
  function confirmOutgoingMessage(state, entry, message) {
    entry.message=message;entry.status='confirmed';state.messages.set(message.id,message);
    if(entry.settled)return;
    entry.settled=true;
    // Sending expresses a newer intent than an in-flight older-page read.
    state.browsingHistory=false;state.historyEpoch++;state.olderRequest=null;state.olderError='';state.revision=null;
    state.attachments=state.attachments.filter(item=>!entry.attachments.includes(item));
    entry.attachments.forEach(item=>{if(item.previewURL){URL.revokeObjectURL(item.previewURL);item.previewURL=null;}});
    state.latestRequest?.sentMessages.push(message);
    if(state.draft===entry.content && (state.draftRevision || 0)===entry.draftRevision){
      state.draft='';state.mentions=[];state.requestId=null;
      if(host && currentId===entry.key)query('textarea').value='';
    }
    if(host && currentId===entry.key)renderAttachments();
  }
  function renderReadErrors() {
    const state = currentId && view(currentId);
    query(".communication-error").textContent = [listError, state?.latestError, state?.olderError].filter(Boolean).join(" · ");
  }
  function renderList() {
    const page = {...listPagination,items:conversations}; listPage = page.page;
    const html = page.items.map(item => {
      const employee = item.members?.find(member => member.id === item.targetId) || contacts.find(member => member.id === item.targetId) || {name:item.name};
      const initials = ([...(employee.name || employee.initials || '?')][0] || '?').toLocaleUpperCase();
      const groupMembers = (item.members || []).slice(0, 2);
      const avatar = item.kind !== 'agent' ? `<span class="communication-group-avatar" aria-hidden="true">${groupMembers.length ? groupMembers.map(member => renderAvatar(member)).join('') : `<span class="agent-card-avatar color-${extensionAvatarColor(item.id)}">${$t("群")}</span>`}</span>` : renderAvatar({...employee,initials},'communication-avatar') || `<span class="communication-avatar color-${escapeHtml(employee.color || 'system')}" aria-hidden="true">${escapeHtml(initials)}</span>`;
      const running = (item.members || []).filter(member => member.running).map(member => member.name);
      const preview = running.length ? $t("{0}正在回复", [running.join('、')]) : item.preview || (item.kind !== "agent" ? $t("群聊") : $t("数字员工私聊"));
      return `<button class="communication-contact ${item.id === currentId ? "selected" : ""}" data-chat-id="${escapeHtml(item.id)}">${avatar}<span class="communication-contact-content"><span class="communication-contact-top"><strong>${escapeHtml(item.name)}</strong><time title="${escapeHtml(date(item.updatedAt))}">${escapeHtml(shortTime(item.updatedAt))}</time></span><span class="communication-contact-bottom"><small>${escapeHtml(preview)}</small>${item.unreadCount ? `<span class="communication-unread" aria-label="${$t("{0} 条未读", [item.unreadCount])}">${item.unreadCount}</span>` : ""}</span></span></button>`;
    }).join('') || `<div class="directory-empty" role="${listError ? "alert" : "status"}">${listError ? $t("会话列表读取失败，正在重连。") : listLoaded ? `<strong>${$t("还没有会话")}</strong>${$t("点击“发起沟通”，选择数字员工开始沟通。")}` : $t("正在读取会话…")}</div>`;
    if (query('.communication-list').innerHTML !== html) query('.communication-list').innerHTML = html;
    query(".communication-pager").innerHTML = paginationMarkup(page, "communications");
    queryAll("[data-chat-id]").forEach((button) => button.onclick = () => navigate(button.dataset.chatId));
  }
  function queryAll(selector) { return [...(host?.querySelectorAll(selector) || [])]; }
  async function markVisibleRead() {
    const key = currentId, token = generation;
    if (!key || host?.ownerDocument?.visibilityState === "hidden") return;
    const state = view(key), list = query(".communication-messages");
    if (!list || !state.conversation?.unreadCount || !state.latestVisibleMessageId || state.reading || list.scrollHeight - list.scrollTop - list.clientHeight > 80) return;
    state.reading = true;
    try {
      const result = await api(`/api/communications/${key}/read`, { method: "POST", body: JSON.stringify({ messageId: state.latestVisibleMessageId }) });
      if (!isCurrent(key, token)) return;
      state.conversation = { ...state.conversation, unreadCount:result.conversation.unreadCount };
      conversations = conversations.map(item => item.id === key ? {...item,unreadCount:result.conversation.unreadCount} : item);
      renderList(); onRead();
    } catch { /* A failed acknowledgement keeps the messages unread; retry on the next poll. */ }
    finally { state.reading = false; }
  }
  function renderMessages() {
    if (!currentId) return;
    const state = view(currentId), list = query(".communication-messages");
    const bottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const top = list.scrollTop, height = list.scrollHeight;
    state.outbox ||= new Map();
    const saved = [...state.messages.values()];
    const messageIds = new Set(saved.map(message => message.id)), requestIds = new Set(saved.map(message => message.clientRequestId).filter(Boolean));
    for (const [id, entry] of state.outbox) if (messageIds.has(entry.message?.id) || requestIds.has(id)) {
      confirmOutgoingMessage(state,entry,saved.find(message=>message.id===entry.message?.id || message.clientRequestId===id));state.outbox.delete(id);
    }
    const messages = [...saved, ...[...state.outbox.values()].map(entry => entry.message || { id:entry.id, clientRequestId:entry.id, content:entry.content, sender:{type:'human',name:$t("你")}, createdAt:entry.createdAt, outgoing:entry })].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const today = new Date();
    const html = messages.map((message, index) => {
      const dayDivider = !index || messageDayKey(messages[index - 1].createdAt) !== messageDayKey(message.createdAt)
        ? `<div class="communication-day-divider"><time datetime="${escapeHtml(message.createdAt)}">${communicationDayLabel(message.createdAt, today)}</time></div>` : '';
      const human = message.sender.type === 'human';
      const member = state.conversation?.members.find(member => member.id === message.sender.id) || message.sender;
      const avatar = human ? '' : renderAvatar(member, 'communication-message-avatar');

      const mentions=(state.conversation?.members||[]).map(member=>member.name),cacheKey=message.id+':'+message.content+':'+mentions.join('|');
      let content=markdownCache.get(cacheKey);if(content===undefined){content=renderContent(message.content,mentions);markdownCache.set(cacheKey,content);}
      const attachments = message.outgoing ? outgoingAttachmentMarkup(message.outgoing) : messageAttachments(message.attachments || [], currentId);
      const failed = [...state.deliveries.values()].filter(item => item.messageId === message.id && item.status === 'failed');
      const recovery = failed.map(item => `<div class="communication-recovery"><span>${$t("{0} 回复失败", [escapeHtml(state.conversation.members.find(member=>member.id===item.agentId)?.name || $t("员工"))])}</span><button type="button" class="text-action" data-chat-failure-console="${escapeHtml(item.agentId)}">${$t("查看控制台")}</button><button type="button" class="text-action" data-retry-chat-delivery="${escapeHtml(item.id)}">${$t("重试")}</button></div>`).join('');
      return `${dayDivider}<article class="communication-message ${human ? "from-human" : ""}" data-chat-message="${escapeHtml(message.id)}"${message.outgoing ? ` data-outgoing-state="${escapeHtml(message.outgoing.status)}"` : ''} data-tone="${communicationSenderTone(message.sender)}" data-sender-color="${escapeHtml(member.color || 'system')}"><header>${avatar}<strong>${escapeHtml(message.sender.name)}</strong><time title="${escapeHtml(date(message.createdAt))}" datetime="${escapeHtml(message.createdAt)}">${escapeHtml(formatMessageTime(message.createdAt))}</time></header><div class="communication-body communication-markdown">${content}</div>${attachments ? `<div class="communication-message-attachments">${attachments}</div>` : ''}${outgoingMessageFeedback(message.outgoing, 'chat')}${recovery}</article>`;
    }).join("") || `<div class="communication-empty">${state.latestError ? $t("聊天记录读取失败，正在重连。") : state.loaded ? $t("从一句话开始沟通。消息将持续保留。") : $t("正在读取聊天记录…")}</div>`;
    const running = (state.conversation?.members || []).filter(member => member.running);
    const rendered = html + (running.length ? `<div class="communication-typing" role="status"><span class="communication-member-avatar">${renderAvatar(running[0])}<span class="member-running-dot" aria-hidden="true"></span></span><span>${$t("{0}正在回复…", [escapeHtml(running.map(member => member.name).join('、'))])}</span></div>` : '');
    if (state.renderedMessages !== rendered || state.messageList !== list) {
      state.renderedMessages = rendered; state.messageList = list;
      list.innerHTML = rendered;
      if (state.loadingOlder) list.scrollTop = top + list.scrollHeight - height;
      else list.scrollTop = bottom ? list.scrollHeight : top;
    }
    query(".communication-older").hidden = !state.hasMore;
    query(".communication-latest").hidden = !state.browsingHistory;
    query(".communication-older").disabled = Boolean(state.olderRequest?.generation === generation);
    queryAll('[data-recover-chat-message]').forEach(button => button.onclick = () => {
      const entry=state.outbox.get(button.dataset.recoverChatMessage); if (!entry || state.sending) return;
      if (state.draft && state.draft !== entry.content) { notify($t("输入框已有新草稿，请先保存或清空，再恢复这条消息。"),true); return; }
      if(state.attachments.some(item=>!entry.attachments.includes(item))){notify($t("输入框已有新附件，请先保存或移除，再恢复这条消息。"),true);return;}
      state.draft=entry.content;state.mentions=entry.mentions;state.requestId=entry.id;state.requestSignature=entry.signature;
      state.draftRevision=(state.draftRevision || 0)+1;entry.draftRevision=state.draftRevision;
      entry.attachments.forEach(item=>{if(!item.previewURL && imageAttachment(item.file.name))item.previewURL=URL.createObjectURL(item.file);});
      state.attachments=[...state.attachments,...entry.attachments.filter(item=>!state.attachments.includes(item))];
      const input=query('textarea');if(input){input.value=state.draft;input.focus();}renderAttachments();
    });
  }
  async function loadMessages(older = false) {
    const key = currentId, token = generation;
    if (!key) return;
    const state = view(key);
    const slot = older ? "olderRequest" : "latestRequest";
    const errorSlot = older ? "olderError" : "latestError";
    if (state[slot]?.generation === token || (older && (!state.loaded || !state.hasMore || !state.before))) return;
    const request = { generation: token, epoch: state.historyEpoch, before: state.before, sentMessages: [] };
    state[slot] = request;
    if (older) query(".communication-older").disabled = true;
    try {
      const [result] = await Promise.all([
        api(`/api/communications/${key}${older ? "?before=" + encodeURIComponent(request.before) : state.revision ? "?since="+encodeURIComponent(state.revision) : ""}`),
        prepareContent().catch(() => {}) // A missing display dependency must not hide messages.
      ]);
      if (!isCurrent(key, token) || (older && request.epoch !== state.historyEpoch)) return;
      if(result.unchanged)return;
      if(!older)state.revision=result.revision;
      if(!older&&state.browsingHistory){state.conversation=result.conversation;renderHeading();renderRoster();return;}
      if(older)state.browsingHistory=true;
      if (!older && state.loaded && result.messages.length && !result.messages.some((message) => state.readMessageIds.has(message.id))) {
        // A missed window is re-anchored, never joined across a hidden history gap.
        // POST confirms one message, not coverage of intervening history.
        state.messages.clear(); state.readMessageIds.clear(); state.deliveries.clear(); state.loaded = false;
        // POST acknowledgements received after this GET began are newer facts.
        request.sentMessages.forEach((message) => state.messages.set(message.id, message));
        state.historyEpoch++;
        state.olderRequest = null;
        state.olderError = "";
      }
      if (!older) {
        if (state.consoleAgentId && state.conversation?.members.some(member => member.id === state.consoleAgentId) && !result.conversation.members.some(member => member.id === state.consoleAgentId)) {
          state.consoleOpen = false; state.consoleAgentId = null; state.consoleMembers = []; state.consoleRequest = null; state.consoleRenderKey = null; state.consoleError = '';
          renderConsolePanel();
        }
        const stale = state.conversation?.updatedAt && result.conversation.updatedAt && result.conversation.updatedAt < state.conversation.updatedAt;
        if (!stale) state.conversation = result.conversation;
        state.latestVisibleMessageId = result.messages.at(-1)?.id;
      }
      result.messages.forEach((message) => { state.messages.set(message.id, message); state.readMessageIds.add(message.id); });
      const ordered=[...state.messages.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      const removed=older?ordered.slice(200):ordered.slice(0,Math.max(0,ordered.length-200));
      for(const {id}of removed){state.messages.delete(id);state.readMessageIds.delete(id);}
      for(const [id,delivery]of state.deliveries)if(!state.messages.has(delivery.messageId)&&['done','cancelled'].includes(delivery.status))state.deliveries.delete(id);
      result.deliveries.forEach((delivery) => state.deliveries.set(delivery.id, delivery));
      if (!state.loaded || older) { state.before = result.nextBefore; state.hasMore = result.hasMore; }
      state.loaded = true; state.loadingOlder = older;
      state[errorSlot] = "";
      renderHeading();
      renderRoster(); renderMessages(); state.loadingOlder = false;
      if (!older) void markVisibleRead();
      renderReadErrors();
    } catch (error) {
      if (!isCurrent(key, token) || (older && request.epoch !== state.historyEpoch)) return;
      state[errorSlot] = older ? $t("更早消息读取失败：{0}（历史和草稿保留，可再次加载更早消息）", [error.message]) : $t("聊天记录读取失败：{0}（历史和草稿保留，正在重连）", [error.message]);
      if (!state.loaded) query(".communication-heading").textContent = $t("会话读取失败");
      renderReadErrors(); renderMessages();
    } finally {
      if (state[slot] === request) state[slot] = null;
      if (isCurrent(key, token)) query(".communication-older").disabled = Boolean(state.olderRequest?.generation === token);
    }
  }
  async function poll() {
    if (!host || listRequest?.generation === generation) return;
    const request = { generation }; listRequest = request;
    const token = generation;
    try {
      const result = await api(`/api/communications?page=${listPage}`);
      if (!host || token !== generation) return;
      listPagination=result;conversations = result.conversations; listLoaded = true; listError = ""; renderList(); renderReadErrors();
      if(!currentId){const latest=latestConversationId(conversations);if(latest)navigate(latest);}
    } catch (error) { if (host && token === generation) { listError = $t("会话列表读取失败：{0}（历史和草稿保留，正在重连）", [error.message]); renderList(); renderReadErrors(); } }
    finally { if (listRequest === request) listRequest = null; }
  }
  function consolePage(state) {
    if (!state.consolePages.has(state.consoleAgentId)) state.consolePages.set(state.consoleAgentId, { events: new Map(), traces: [], loaded: false, hasMore: false, before: null });
    return state.consolePages.get(state.consoleAgentId);
  }
  function renderConsolePanel() {
    if (!currentId) return;
    const state = view(currentId), panel = query('[data-communication-console]');
    panel.hidden = !state.consoleOpen; panel.dataset.open = String(state.consoleOpen);
    query('.communication-panes').classList.toggle('console-open', state.consoleOpen);
    query('.communication-layout').classList.toggle('console-expanded', state.consoleOpen);
    query('[data-toggle-communication-console]').setAttribute('aria-expanded', String(state.consoleOpen));
    query('[data-chat-roster]').querySelectorAll('[data-chat-member-console]').forEach(button => { const selected = state.consoleOpen && button.dataset.chatMemberConsole === state.consoleAgentId; button.setAttribute('aria-pressed', String(selected)); button.closest('.communication-roster-member').classList.toggle('is-selected', selected); });
    if (!state.consoleOpen) return;
    query('[data-communication-console-error]').textContent = state.consoleError;
    const page = consolePage(state);
    query('[data-communication-console-older]').hidden = !page.hasMore;
    query('[data-communication-console-older]').disabled = Boolean(state.consoleRequest);
    const stream = query('[data-communication-stream]');
    const agent = state.consoleMembers.find(row => row.id === state.consoleAgentId);
    query("[data-chat-console-name]").textContent = agent?.name || $t("控制台");
    const identity = state.conversation?.members.find(member => member.id === state.consoleAgentId) || contacts.find(member => member.id === state.consoleAgentId) || agent;
    query('[data-chat-console-avatar]').innerHTML = identity ? renderAvatar(identity) : '';
    query('[data-chat-console-runtime]').textContent = [identity?.runtime?.provider ? runtimeLabel(identity.runtime.provider) : null, identity?.runtime?.model].filter(Boolean).join(' · ');
    if (!agent) { stream.textContent = state.consoleRequest ? $t("正在读取控制台…") : $t("此会话尚无执行记录。"); return; }
    const key = JSON.stringify([agent.id, [...page.events.keys()], page.traces, Boolean(page.forceLatest)]);
    if (state.consoleRenderKey === key) return;
    state.consoleRenderKey = key;
    const reading = page.reading || { following: true, top: 0, open: [], closed: [] };
    if (stream.dataset.agentId === agent.id && stream.children.length) {
      Object.assign(reading, captureConsoleReading(stream));
      reading.open = [...stream.querySelectorAll('details[open][data-console-key]')].map(node => node.dataset.consoleKey);
      reading.closed = [...stream.querySelectorAll('details[data-default-open]:not([open])')].map(node => node.dataset.consoleKey);
    }
    if (stream.dataset.agentId !== agent.id) followConsoleLatest(stream);
    onConsoleLatest(stream, () => { if (page.browsingHistory) { state.consoleRequest = null; void loadConsole(false, { latest: true }); } });
    const position = page.forceLatest ? { following: true, top: 0 } : captureConsoleReading(stream);
    stream.dataset.agentId = agent.id;
    renderConsole(stream, { events: [...page.events.values()], traces: page.traces, hasMore: page.hasMore, refresh: Boolean(state.consoleRefresh), basePath: `/api/communications/${encodeURIComponent(currentId)}` }, agent);
    state.consoleRefresh = false;
    for (const details of stream.querySelectorAll('details[data-console-key]')) details.open = reading.open.includes(details.dataset.consoleKey) || (details.dataset.defaultOpen !== undefined && !reading.closed.includes(details.dataset.consoleKey));
    restoreConsoleReading(stream, position, { prepend: state.consolePrepend, latest: page.forceLatest });
    page.forceLatest = false; state.consolePrepend = false; page.reading = reading;
  }
  async function loadConsole(older = false, { latest = false } = {}) {
    const key = currentId, token = generation;
    if (!key) return;
    const state = view(key), page = consolePage(state);
    if (!state.consoleOpen || state.consoleRequest || older && (!page.hasMore || !page.before)) return;
    const stream = query('[data-communication-stream]');
    if (older) { page.liveEvents ||= [...page.events.values()]; page.browsingHistory = true; }
    const request = { agentId: state.consoleAgentId }; state.consoleRequest = request;
    renderConsolePanel();
    try {
      const params = new URLSearchParams({ limit: '50', ...(request.agentId ? { agentId: request.agentId } : {}), ...(older ? { before: page.before } : {}) });
      const fetchPage = before => { const query = new URLSearchParams(params); if (before) query.set('before', before); return api(`/api/communications/${key}/console?${query}`); };
      const result = older ? await fetchPage() : await readConsoleTail(latest ? [] : page.liveEvents || [...page.events.values()], fetchPage);
      if (!isCurrent(key, token) || !state.consoleOpen || state.consoleRequest !== request) return;
      state.consoleMembers = result.agents.filter(agent => !request.agentId || agent.id === request.agentId);
      if (!request.agentId && result.agents.length) {
        state.consoleAgentId = (result.agents.find(agent => agent.running) || result.agents[0]).id;
        state.consoleRequest = null; state.consoleRenderKey = null; renderConsolePanel(); void loadConsole(); return;
      }
      if (!older && !latest && page.browsingHistory) { page.liveEvents = consoleEventWindow(page.liveEvents || [], result.events).events; return; }
      const window = consoleEventWindow(latest ? [] : [...page.events.values()], result.events, { older });
      page.events = new Map(window.events.map(event => [event.id, event]));
      const traceIds = new Set(window.events.map(event => event.data?.traceId));
      page.traces = [...new Map([...page.traces, ...result.traces].map(trace => [trace.id, trace])).values()].filter(trace => traceIds.has(trace.id));
      if (!page.loaded || older || latest || window.reset) { page.before = result.nextBefore; page.hasMore = result.hasMore; }
      if (window.trimmedBefore) { page.before = window.events[0].id; page.hasMore = true; }
      if (older) page.browsingHistory = true;
      if (latest) { page.browsingHistory = false; page.liveEvents = null; page.forceLatest = true; }
      page.loaded = true; state.consoleError = ''; state.consolePrepend = older;
    } catch (error) { if (isCurrent(key, token) && state.consoleRequest === request) state.consoleError = $t("控制台读取失败：{0}；记录保留，可刷新重试。", [error.message]); }
    finally { if (state.consoleRequest === request) state.consoleRequest = null; if (isCurrent(key, token)) renderConsolePanel(); }
  }
  function renderAttachments() {
    const state = view(currentId);
    const container = query('[data-chat-attachments]');
    container.innerHTML = draftAttachments(state.attachments, 'chat', state.sending);
    container.onclick = event => {
      const image = event.target.closest('[data-chat-image]');
      if (image) { openImage(image); return; }
      const button = event.target.closest('[data-remove-chat-attachment]');
      if (!button || state.sending) return;
      const item = state.attachments.find(item => item.id === button.dataset.removeChatAttachment);
      if (item?.previewURL) { URL.revokeObjectURL(item.previewURL); item.previewURL=null; }
      state.attachments = state.attachments.filter(value => value !== item);
      state.requestId = null; renderAttachments();
      query('#communication-input')?.focus({preventScroll:true});
    };
    for (const button of host.querySelectorAll('.composer-icon-button')) button.disabled = state.sending;
  }

  const imageError = attachmentImageError;
  function openImage(trigger) {
    imageViewer?.close();
    imageViewer = openAttachmentImage(trigger, () => { if (!trigger.isConnected) query('#communication-input')?.focus(); });
  }

  function mentionMenu() {
    const input = query("textarea"), state = view(currentId), menu = query(".communication-mentions");
    state.mentions = state.mentions.filter((member) => input.value.includes("@" + member.name));
    const match = activeMention(input.value, input.selectionStart, state.mentions);
    if (!match || state.conversation?.kind !== "group") { closeFloatingList(menu); return; }
    const members = state.conversation.members.filter((member) => member.status === "active" && member.name.toLowerCase().includes(match[1].toLowerCase()));
    menu.innerHTML = members.map((member, index) => `<button type="button" role="option" aria-selected="${index === 0}" data-chat-mention="${escapeHtml(member.id)}">${escapeHtml(member.name)}</button>`).join("") || `<p>${$t("没有匹配成员")}</p>`;
    createFloatingList(input,menu).open();
    menu.querySelectorAll("button").forEach((button) => button.onclick = () => {
      const member = members.find((item) => item.id === button.dataset.chatMention);
      input.setRangeText("@" + member.name + " ", input.selectionStart - match[0].length, input.selectionStart, "end");
      state.mentions = [...state.mentions.filter((item) => item.id !== member.id), member];
      state.draft = input.value; state.requestId = null; closeFloatingList(menu); input.focus();
    });
  }
  function renderHeading() {
    const state = view(currentId), conversation = state.conversation, heading = query('.communication-heading');
    const group = conversation?.kind === 'group';
    heading.textContent = conversation?.name || (state.latestError ? $t("会话读取失败") : $t("加载会话…"));
    heading.hidden = Boolean(state.nameEditing);
    heading.setAttribute('tabindex', group ? '0' : '-1');
    heading.setAttribute('title', conversation?.name || '');
    query('[data-chat-name-input]').hidden = !state.nameEditing;
    const member = conversation?.members?.find(member => member.id === conversation.targetId);
    query('[data-chat-heading-avatar]').innerHTML = !group && member ? renderAvatar(member) : '';
    query('[data-chat-heading-avatar]').hidden = group || !member;
    query('[data-chat-rename]').hidden = !group;
    query('[data-chat-mention]').hidden = !group;
    query('.communication-subtitle').textContent = conversation ? (group ? $t("群聊 · {0} 位成员 · @ 指定成员回复，不 @ 时全员回复", [conversation.members.length]) : [member?.runtime?.provider ? runtimeLabel(member.runtime.provider) : null, member?.runtime?.model].filter(Boolean).join(' · ') || $t("长期私聊")) : '';
    query('textarea').placeholder = group ? $t("输入消息，@ 提及成员…") : $t("输入消息…");
  }
  function beginRename() {
    const state = view(currentId);
    if (state.conversation?.kind !== 'group' || state.renaming) return;
    state.nameEditing = true; renderHeading();
    const input = query('[data-chat-name-input]'); input.value = state.conversation.name; input.setCustomValidity(''); input.focus(); input.select();
  }
  function cancelRename() {
    const state = view(currentId);
    if (state.renaming) return;
    state.nameEditing = false; renderHeading();
  }
  async function saveName() {
    const key = currentId, token = generation, state = view(key), input = query('[data-chat-name-input]');
    if (state.renaming) return;
    const name = input.value.trim();
    if (name === state.conversation.name) { cancelRename(); return; }
    input.setCustomValidity(!name ? $t("请输入群聊名称") : name.length > 100 ? $t("群聊名称最多 100 字符") : '');
    if (!input.reportValidity()) return;
    state.renaming = true; input.disabled = true;
    try {
      const result = await api(`/api/communications/${key}`, {method:'PUT',body:JSON.stringify({name})});
      state.conversation = {...state.conversation,name:result.conversation.name,updatedAt:result.conversation.updatedAt};
      state.nameEditing = false;
      if (isCurrent(key,token)) { renderHeading(); conversations = conversations.map(item => item.id === key ? {...item,name:result.conversation.name,updatedAt:result.conversation.updatedAt} : item); renderList(); }
    } catch(error) { if (isCurrent(key,token)) { notify(error.message,true); input.focus(); } }
    finally { state.renaming = false; input.disabled = false; if (isCurrent(key,token) && state.nameEditing) input.focus(); }
  }
  function setupConversation() {
    const area = query(".communication-main");
    if (!currentId) { area.innerHTML = `<div class="communication-empty"><h2>${$t("沟通")}</h2><p>${$t("选择数字员工开始私聊，或新建一个群聊。")}</p><small>${$t("历史长期保存 · 不受任务归档影响")}</small></div>`; return; }
    const state = view(currentId);
    state.consoleRenderKey = null;
    area.innerHTML = `<div class="communication-panes">
      <section class="communication-chat">
        <header class="communication-header"><button type="button" class="text-action conversation-list-toggle" data-toggle-conversation-list aria-label="${$t("显示会话列表")}" aria-expanded="false">${$t("会话")}</button><span class="communication-heading-avatar" data-chat-heading-avatar hidden></span><div class="communication-heading-text"><h2 class="communication-heading"></h2><input class="communication-name-input" data-chat-name-input aria-label="${$t("群聊名称")}" maxlength="100" required hidden><p class="communication-subtitle"></p></div><button type="button" class="text-action" data-toggle-chat-members aria-expanded="false" hidden>${$t("成员")}</button><button type="button" class="text-action communication-console-toggle" data-toggle-communication-console aria-label="${$t("控制台")}" title="${$t("控制台")}" aria-controls="communication-console-panel" aria-expanded="${state.consoleOpen}" hidden>${consoleIcon}<span>${$t("控制台")}</span></button><button type="button" class="text-action" data-chat-rename aria-label="${$t("编辑群名")}" title="${$t("编辑群名")}" hidden>⋯</button></header>
        <div><button class="small-button communication-older" hidden>${$t("加载更早消息")}</button><button class="small-button communication-latest" hidden>${$t("回到最新")}</button></div><div class="communication-messages" aria-label="${$t("聊天记录")}"></div>
        <form class="communication-composer"><div class="communication-mentions" role="listbox" aria-label="${$t("@ 成员")}" hidden></div><div class="message-composer-card"><div class="message-composer-input"><div class="communication-draft-attachments" data-chat-attachments></div><textarea id="communication-input" aria-label="${$t("输入消息")}" placeholder="${$t("输入消息…")}" rows="2">${escapeHtml(state.draft)}</textarea></div><p class="field-hint" data-chat-upload-status role="status"></p><input type="file" multiple data-chat-file hidden><input type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp" data-chat-image-file hidden><div class="communication-composer-actions">${attachmentControls('chat', state.sending)}<button type="button" class="composer-icon-button" data-chat-mention aria-label="${$t("提及成员")}" title="${$t("提及成员")}" hidden>@</button><span class="composer-hint">${$t("Enter 发送 · Shift + Enter 换行")}</span><button class="primary-button" type="submit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>${$t("发送")}</button></div></div></form>
      </section>
      <aside class="communication-roster" aria-label="${$t("聊天成员")}" hidden><header><strong data-chat-member-count>${$t("成员")}</strong><button type="button" class="text-action" data-edit-chat-group aria-label="${$t("编辑群聊")}" title="${$t("编辑群聊")}">${settingsIcon}</button><button type="button" class="text-action" data-close-chat-members aria-label="${$t("关闭成员列表")}">×</button></header><div data-chat-roster></div></aside>
      <dialog class="communication-picker communication-member-detail" aria-label="${$t("员工详细信息")}"></dialog>
      <aside id="communication-console-panel" class="communication-console" data-communication-console hidden>
        <div class="communication-console-toolbar"><span class="communication-console-avatar" data-chat-console-avatar></span><div class="communication-console-identity"><strong data-chat-console-name></strong><small data-chat-console-runtime></small></div><div class="communication-console-actions"><button type="button" class="text-action" data-communication-console-latest>${$t("↓ 最新")}</button><button type="button" class="text-action" data-communication-console-refresh>${$t("刷新")}</button><button type="button" class="text-action" data-close-chat-console aria-label="${$t("关闭控制台")}">×</button></div></div><button type="button" class="text-action communication-console-older" data-communication-console-older hidden>${$t("加载更早记录")}</button><p class="communication-console-error" data-communication-console-error role="alert"></p><div class="communication-trace-stream" data-communication-stream tabindex="0" role="log" aria-label="${$t("沟通控制台")}"></div>
      </aside>
    </div>`;
    state.nameEditing = false; renderHeading();
    query('[data-chat-rename]').onclick = beginRename;
    query('[data-chat-mention]').onclick = () => { const input = query('textarea'); input.focus(); input.setRangeText('@', input.selectionStart, input.selectionEnd, 'end'); state.draft = input.value; mentionMenu(); };
    query('.communication-header').ondblclick = event => { if (!event.target.closest('button,input')) beginRename(); };
    query('.communication-heading').onkeydown = event => { if (['Enter','F2'].includes(event.key)) { event.preventDefault(); beginRename(); } };
    query('[data-chat-name-input]').onkeydown = event => { if (event.isComposing || event.keyCode === 229) return; if(event.key === 'Enter') { event.preventDefault(); void saveName(); } else if(event.key === 'Escape') { event.preventDefault(); cancelRename(); query('.communication-heading').focus(); } };
    query('[data-chat-name-input]').onblur = cancelRename;
    renderMessages();
    renderAttachments(); renderRoster(); renderConsolePanel();
    query('[data-toggle-chat-members]').onclick = () => setMembersOpen(!query('.communication-panes').classList.contains('members-open'));
    query('[data-close-chat-members]').onclick = () => { setMembersOpen(false); query('[data-toggle-chat-members]').focus(); };
    query('[data-toggle-conversation-list]').onclick = event => { const open=query('.communication-layout').classList.toggle('conversation-list-open');event.currentTarget.setAttribute('aria-expanded',String(open)); };
    query('.communication-roster').onkeydown = event => { if(event.key === 'Escape') { event.preventDefault(); setMembersOpen(false); query('[data-toggle-chat-members]').focus(); } };
    query('[data-edit-chat-group]').onclick = () => showGroupEditor(state.conversation);
    query('[data-close-chat-console]').onclick = () => { state.consoleOpen = false; renderConsolePanel(); };
    query('[data-toggle-communication-console]').onclick = () => { state.consoleOpen = !state.consoleOpen; state.consoleRequest = null; state.consoleRenderKey = null; renderConsolePanel(); if (state.consoleOpen) void loadConsole(); };
    query('[data-communication-console-older]').onclick = () => void loadConsole(true);
    query('[data-communication-console-refresh]').onclick = () => { state.consoleRenderKey = null; state.consoleRefresh = true; state.consoleRequest = null; void loadConsole(false, { latest: true }); };
    query('[data-communication-console-latest]').onclick = () => { state.consoleRequest = null; void loadConsole(false, { latest: true }); };
    const fileInput = query('[data-chat-file]');
    query('[data-chat-attach]').onclick = () => { if (!state.sending) fileInput.click(); };
    const imageInput = query('[data-chat-image-file]');
    query('[data-chat-attach-image]').onclick = () => { if (!state.sending) imageInput.click(); };
    query('.communication-messages').addEventListener('error', imageError, true);
    query('[data-chat-attachments]').addEventListener('error', imageError, true);
    fileInput.onchange = imageInput.onchange = event => {
      const picker = event.currentTarget;
      if (state.sending) return;
      for (const file of picker.files) {
        if (file.size > 20 * 1024 * 1024) { notify($t("「{0}」超过单文件 20 MiB 上限。", [file.name]), true); continue; }
        state.attachments.push({ id: crypto.randomUUID(), file, uploaded: null, previewURL: imageAttachment(file.name) ? URL.createObjectURL(file) : null });
      }
      picker.value = ''; state.requestId = null; renderAttachments();
    };
    query('.communication-messages').onclick = async event => {
      const image = event.target.closest('[data-chat-image]');
      if (image) { openImage(image); return; }
      const consoleButton = event.target.closest('[data-chat-failure-console]');
      if (consoleButton) { openMemberConsole(consoleButton.dataset.chatFailureConsole); return; }
      const retry = event.target.closest('[data-retry-chat-delivery]');
      if (retry) {
        const key = currentId; retry.disabled = true;
        try { await api(`/api/communications/${key}/deliveries/${retry.dataset.retryChatDelivery}/retry`, {method:'POST',body:'{}'}); if(currentId===key)await loadMessages(); }
        catch(error){notify(error.message,true);}finally{retry.disabled=false;} return;
      }
      const link = event.target.closest('[data-attachment-download]');
      if (!link) return;
      event.preventDefault();
      try {
        await downloadAttachment(link);
      } catch (error) { notify(error.message, true); }
    };
    query(".communication-messages").onscroll = () => { void markVisibleRead(); };
    query('.communication-latest').onclick=()=>{state.browsingHistory=false;state.revision=null;state.messages.clear();state.deliveries.clear();state.readMessageIds.clear();state.loaded=false;loadMessages();};
    query(".communication-older").onclick = () => loadMessages(true).catch((error) => notify(error.message, true));
    const form = query("form"), input = query("textarea"), submit = form.querySelector('[type="submit"]');
    submit.disabled = state.sending;
    input.oninput = () => { state.draft = input.value; state.draftRevision=(state.draftRevision || 0)+1; state.requestId = null; mentionMenu(); };
    input.onkeydown = (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      const modified = event.shiftKey || event.metaKey || event.altKey || event.ctrlKey;
      const menu = query(".communication-mentions"), buttons = [...menu.querySelectorAll("button")];
      if (!menu.hidden && buttons.length && !modified && ["Tab", "Enter", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        let index = Math.max(0, buttons.findIndex((button) => button.getAttribute("aria-selected") === "true"));
        if (["Tab", "Enter"].includes(event.key)) buttons[index].click();
        else { index = (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length; buttons.forEach((button, i) => button.setAttribute("aria-selected", String(i === index))); }
        return;
      }
      if (event.key === "Escape") closeFloatingList(menu);
      if (event.key === "Enter") {
        if (modified) insertComposerLineBreak(event);
        else { event.preventDefault(); form.requestSubmit(); }
      }
    };
    form.onsubmit = async (event) => {
      event.preventDefault(); const key = currentId, token = generation, content = input.value;
      if (state.sending || (!content.trim() && !state.attachments.length)) return;
      if (content.length > 32000) { notify($t("消息最多 32000 字符。"), true); return; }
      const mentionAgentIds = state.mentions.filter((member) => content.includes("@" + member.name)).map((member) => member.id);
      const attachments = [...state.attachments];
      const signature=JSON.stringify({content,mentionAgentIds,attachments:attachments.map(item=>item.id)});
      if(state.requestSignature!==signature)state.requestId=null;
      state.requestId ||= crypto.randomUUID();state.requestSignature=signature;
      const requestId = state.requestId;
      const draftRevision=state.draftRevision || 0;
      state.outbox ||= new Map();
      const outgoing={id:requestId,key,signature,content,draftRevision,createdAt:new Date().toISOString(),status:'sending',attachments,mentions:[...state.mentions]};
      state.outbox.set(requestId,outgoing);
      state.draft = ''; state.mentions = []; state.attachments = []; state.requestId = null;
      input.value = ''; input.focus({preventScroll:true}); closeFloatingList(query('.communication-mentions'));
      state.sending = true; submit.disabled = true; renderAttachments();
      renderMessages();const messages=query('.communication-messages');messages.scrollTop=messages.scrollHeight;
      const accept = message => {
        confirmOutgoingMessage(state,outgoing,message);
        if(host && currentId===key){closeFloatingList(query('.communication-mentions'));renderMessages();const list=query('.communication-messages');list.scrollTop=list.scrollHeight;}
      };
      try {
        for (const item of attachments) {
          if (item.uploaded) continue;
          if (isCurrent(key, token)) query('[data-chat-upload-status]').textContent = $t("正在上传 {0}…", [item.file.name]);
          const result = await api(`/api/communications/${key}/attachments?name=${encodeURIComponent(item.file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: item.file });
          item.uploaded = result.attachment;
        }
        const { message } = await api(`/api/communications/${key}/messages`, { method: "POST", body: JSON.stringify({ content, mentionAgentIds, attachmentIds: attachments.map(item => item.uploaded.id), clientRequestId: requestId }) });
        accept(message);
      } catch (error) {
        // A concurrent GET can confirm this exact idempotency key even when
        // the POST response was lost. Never match acknowledgements by content.
        const confirmed=outgoing.message || [...state.messages.values()].find(message=>message.clientRequestId===requestId);
        if(confirmed)accept(confirmed);
        else {outgoing.status='unconfirmed';outgoing.error=error.message;notify(error.message,true);}
      }
      finally { state.sending = false; if (host && currentId === key) { query('form [type="submit"]').disabled = false; query('[data-chat-upload-status]').textContent = ''; renderAttachments();renderMessages(); } }
    };
  }
  function setMembersOpen(open) { query('.communication-panes').classList.toggle('members-open',open);query('[data-toggle-chat-members]').setAttribute('aria-expanded',String(open)); }
  function openMemberConsole(agentId) {
    const state = view(currentId); const closing=state.consoleOpen && state.consoleAgentId===agentId; state.consoleAgentId = agentId; state.consoleOpen = !closing; state.consoleRequest = null; state.consoleRenderKey = null;
    if (query('.communication-member-detail').open) query('.communication-member-detail').close();
    setMembersOpen(false); renderConsolePanel(); if(state.consoleOpen) void loadConsole();
  }
  function renderRoster() {
    const state = view(currentId), container = query('[data-chat-roster]'); if (!container || !state.conversation) return;
    const group = state.conversation.kind === 'group', members = state.conversation.members || [];
    query('.communication-panes').classList.toggle('has-group',group);
    query('.communication-roster').hidden = !group;
    query('[data-toggle-chat-members]').hidden = !group;
    query('[data-toggle-chat-members]').textContent = $t("成员 {0}", [members.length]);
    query('[data-toggle-communication-console]').hidden = group;
    query('[data-chat-member-count]').textContent = $t("成员 {0}", [members.length]);
    const html = members.map(member => `<div class="communication-roster-member ${state.consoleOpen && state.consoleAgentId === member.id ? 'is-selected' : ''}"><button type="button" class="text-action communication-member-identity" data-chat-member-detail="${escapeHtml(member.id)}" title="${escapeHtml(member.name)}"><span class="communication-member-avatar">${renderAvatar(member)}${member.running ? `<span class="member-running-dot" role="status" aria-label="${$t("正在运行")}" title="${$t("正在运行")}"></span>` : ''}</span><span class="communication-member-name">${escapeHtml(member.name)}</span></button><button type="button" class="text-action member-console-icon" data-chat-member-console="${escapeHtml(member.id)}" aria-pressed="${state.consoleOpen && state.consoleAgentId === member.id}" aria-label="${$t("查看 {0} 的控制台", [escapeHtml(member.name)])}" title="${$t("查看控制台")}"><span class="member-console-avatar">${renderAvatar(member)}${member.running ? `<span class="member-running-dot" aria-label="${$t("正在运行")}"></span>` : ''}</span>${consoleIcon}</button></div>`).join('') || `<p class="field-hint">${$t("暂无员工")}</p>`;
    if (container.innerHTML !== html) container.innerHTML = html;
    container.onclick = event => {
      const detail = event.target.closest('[data-chat-member-detail]'), consoleButton = event.target.closest('[data-chat-member-console]');
      if (consoleButton) return openMemberConsole(consoleButton.dataset.chatMemberConsole);
      if (!detail) return;
      renderMemberDetail(detail.dataset.chatMemberDetail, true);
    };
    const panel = query('.communication-member-detail');
    if (panel.open) renderMemberDetail(panel.dataset.memberId);
  }
  function renderMemberDetail(memberId, focus = false) {
    const member = view(currentId).conversation?.members?.find(row => row.id === memberId), panel = query('.communication-member-detail');
    if (!member) { if (panel.open) panel.close(); return; }
    const html = employeeDetailMarkup(member,{renderAvatar,renderContent,closeControl:`<button type="button" class="text-action" data-close-member-detail aria-label="${$t("关闭员工详情")}">×</button>`});
    if (panel.innerHTML !== html) panel.innerHTML = html;
    panel.dataset.memberId = memberId;
    panel.querySelector('[data-close-member-detail]').onclick = () => panel.close();
    panel.onclose = () => query(`[data-chat-member-detail="${CSS.escape(memberId)}"]`)?.focus();
    if (focus && !panel.open) panel.showModal();
  }

  // A deleted chat leaves no local draft, upload preview or reading state.
  function forgetConversation(key) {
    for (const item of views.get(key)?.attachments || []) if (item.previewURL) URL.revokeObjectURL(item.previewURL);
    views.delete(key);
  }
  async function startConversation(memberAgentIds) {
    if (!memberAgentIds.length) throw new Error($t("请至少选择一位数字员工"));
    const input = memberAgentIds.length === 1 ? {kind:'agent',targetId:memberAgentIds[0]} : {kind:'group',memberAgentIds};
    const result = await api('/api/communications',{method:'POST',body:JSON.stringify(input)});
    return result;
  }
  function showGroupEditor(existing = null) {
    const trigger = query('[data-new-chat]'), key = currentId;
    const dialog = document.createElement('dialog'); dialog.className = 'communication-picker'; dialog.setAttribute('aria-labelledby','communication-picker-title');
    dialog.innerHTML = `<header><h2 id="communication-picker-title">${existing ? $t("编辑群聊") : $t("新建对话")}</h2></header><form>${existing ? `<div class="form-field"><label for="chat-group-name">${$t("群聊名称")}</label><input id="chat-group-name" name="name" maxlength="100" required value="${escapeHtml(existing.name)}"></div>` : ''}<div class="form-field" data-group-member-picker></div><p role="alert" data-group-error></p><div class="form-actions">${existing ? `<button type="button" class="small-button danger" data-delete-group>${$t("删除群聊")}</button>` : ''}<button type="button" class="small-button" data-close-group autofocus>${$t("关闭")}</button><button type="submit" class="primary-button">${existing ? $t("保存") : $t("开始沟通")}</button></div></form>`;
    host.append(dialog);
    const employees = contacts.filter(item => item.contactKind === 'agent'), teams = contacts.filter(item => item.contactKind === 'team');
    const selection = createEmployeeMultiSelect(dialog.querySelector('[data-group-member-picker]'), { id:'chat-group-members', label:$t("成员"), placeholder:$t("添加团队或数字员工"), esc:escapeHtml, items:[...teams,...employees], selectedIds:existing?.members.map(member=>member.id) || [], detail:item=>`<small>${escapeHtml(item.contactKind === 'team' ? $t("团队 · {0} 位员工", [item.memberAgentIds.length]) : item.description || $t("数字员工@@item"))}</small>`, expand:item=>item.contactKind === 'team' ? item.memberAgentIds.filter(id=>employees.some(member=>member.id===id)) : [item.id] });
    dialog.querySelector('[data-close-group]').onclick = () => dialog.close();
    const remove = dialog.querySelector('[data-delete-group]');
    if (remove) remove.onclick = async () => {
      const error = dialog.querySelector('[data-group-error]');
      if (!await confirmDialog({ title: $t("删除群聊"), message: $t("删除「{0}」后，群聊从会话列表移除且不能再发送消息；已有消息、附件和执行记录保留为历史。", [existing.name]), confirmLabel: $t("删除群聊"), danger: true })) { if (dialog.open) remove.focus(); return; }
      remove.disabled = true; error.textContent = '';
      try {
        await api(`/api/communications/${key}`, { method: 'DELETE' });
        dialog.close(); conversations = conversations.filter(item => item.id !== key); renderList();
        if (currentId === key) navigate(null);
        forgetConversation(key); onRead();
      } catch (problem) { error.textContent = problem.message; remove.disabled = false; }
    };
    dialog.oncancel = event => event.preventDefault();
    dialog.onclose = () => { closeFloatingLists(dialog); dialog.remove(); trigger?.focus(); };
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault(); const button = dialog.querySelector('[type=submit]'); button.disabled = true;
      try {
        if (existing) {
          const name = dialog.querySelector('[name=name]').value;
          await api(`/api/communications/${key}`,{method:'PUT',body:JSON.stringify({memberAgentIds:selection.value(),...(name !== existing.name ? {name} : {})})});
          dialog.close(); if (key === currentId) await loadMessages();
        } else { const result = await startConversation(selection.value()); dialog.close(); navigate(result.conversation.id); }
        void poll();
      } catch(error) { dialog.querySelector('[data-group-error]').textContent = error.message; button.disabled = false; }
    };
    dialog.showModal(); dialog.querySelector('[data-close-group]').focus();
  }
  return {
    newConversation() { if (!host) return false; showGroupEditor(); return true; },
    async open(kind, targetId) {
      if (kind === 'team') {
        try { const team = (await api('/api/teams')).teams.find(item => item.id === targetId); if (!team) throw new Error($t("团队不存在")); const result = await startConversation(team.memberAgentIds); navigate(result.conversation.id); } catch(error) { notify(error.message,true); } return;
      }
      const existing = conversations.find((item) => item.kind === kind && item.targetId === targetId);
      if (existing) { navigate(existing.id); return; }
      try { const result = await api("/api/communications", { method: "POST", body: JSON.stringify({ kind, targetId }) }); navigate(result.conversation.id); }
      catch (error) { notify(error.message, true); }
    },
    mount(element, state, selectedId) {
      const fresh = host !== element; host = element;
      contacts = [...state.agents.map((item) => ({ ...item, contactKind: "agent" })), ...state.teams.map((item) => ({ ...item, contactKind: "team" }))];
      if (fresh) {
        host.innerHTML = `<header class="communication-page-header"><h1><span class="nav-icon topbar-icon" data-view-icon="communication" aria-hidden="true"></span>${$t("沟通")}</h1><button type="button" class="secondary-button" data-new-chat><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>${$t("发起沟通")}</button></header><div class="communication-error" role="status"></div><div class="communication-layout"><aside class="communication-sidebar" aria-label="${$t("会话列表")}"><button type="button" class="text-action conversation-list-close" data-close-conversation-list aria-label="${$t("关闭会话列表")}">${$t("‹ 返回会话")}</button><div class="communication-list"></div><div class="communication-pager"></div></aside><section class="communication-main"></section></div>`;
        query("[data-new-chat]").onclick = () => showGroupEditor();
        query("[data-close-conversation-list]").onclick = () => { query(".communication-layout").classList.remove("conversation-list-open"); const trigger=query("[data-toggle-conversation-list]"); trigger?.setAttribute("aria-expanded","false"); trigger?.focus(); };
        query(".communication-pager").onclick = (event) => { const button = event.target.closest("[data-page]"); if (button) { listPage = Number(button.dataset.page); poll(); } };
      }
      const changed = fresh || currentId !== selectedId;
      if (changed) { query('.communication-layout').classList.remove('conversation-list-open'); imageViewer?.close(); if(currentId){const old=view(currentId);old.consoleOpen=false;old.consoleRequest=null;old.consolePages.clear();old.messages.clear();old.deliveries.clear();old.readMessageIds.clear();old.loaded=false;old.revision=null;old.browsingHistory=false;} generation++; currentId = selectedId; if(currentId){view(currentId).consoleOpen=false;view(currentId).consoleRequest=null;} setupConversation(); }
      const update = () => { if(globalThis.document?.visibilityState==='hidden')return; poll(); loadMessages(); void loadConsole(); };
      renderList(); renderReadErrors();
      if (changed || !timer) { clearInterval(timer); timer = setInterval(update, 2000); update(); }
    },
    unmount() { markdownCache.clear(); imageViewer?.close(); for(const state of views.values()){state.consoleOpen=false;state.consoleRequest=null;} clearInterval(timer); timer = null; closeFloatingLists(host); host = null; currentId = null; generation++; }
  };
}

export function employeeDetailMarkup(member, {renderAvatar = () => '', renderContent = escapeHtml, closeControl = ''} = {}) {
  const roles=member.roles || member.roleSnapshots || [];
  return `<section class="employee-profile"><header class="employee-profile-identity">${renderAvatar(member)}<div class="employee-profile-name"><h3>${escapeHtml(member.name)}</h3>${member.taskRole==='manager'?`<span class="employee-profile-kind">${$t("本次经理")}</span>`:''}${roles.length?`<p class="employee-profile-roles">${roles.map(role=>escapeHtml(role.name)).join(' · ')}</p>`:''}</div>${closeControl}</header>
    <section class="employee-profile-section"><h4>${$t("简介")}</h4><p class="employee-profile-description">${escapeHtml(member.description || $t("暂无简介"))}</p></section>
    ${member.capabilities?.length ? `<section class="employee-profile-section"><h4>${$t("能力标签")}</h4><div class="capabilities">${member.capabilities.map(capability => `<span class="capability">${escapeHtml(capability)}</span>`).join('')}</div></section>` : ''}
    <section class="employee-profile-section"><h4>${$t("工作提示词")}</h4><div class="employee-profile-prompt communication-markdown">${renderContent(member.systemPrompt || $t("未填写"))}${roles.map(role=>`<section class="employee-role-prompt"><h5>${escapeHtml(role.name)}</h5>${renderContent(role.prompt || $t("未填写"))}</section>`).join('')}</div></section>
  </section>`;
}
