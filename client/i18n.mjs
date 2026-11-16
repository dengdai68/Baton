// Presentation translation shared by the renderer and the desktop host.
// Simplified Chinese is the source language: catalog keys are the original
// text, so zh-CN needs no catalog and every lookup falls back to the source.
// Node consumers (server, CLI, unit tests) stay zh-CN unless a host selects a
// locale; business data, AI prompts and stored history are never translated.

export const LOCALES = Object.freeze(['zh-CN', 'zh-TW', 'en']);
export const SOURCE_LOCALE = 'zh-CN';
export const LANGUAGE_PREFERENCES = Object.freeze(['system', ...LOCALES]);
// Native names stay untranslated so every reader can find their language.
export const LOCALE_NAMES = Object.freeze({ 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English' });
const INTL_LOCALES = { 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', en: 'en-US' };

/** Return a supported language preference, or null for anything else. */
export function normalizeLanguage(value) {
  return typeof value === 'string' && LANGUAGE_PREFERENCES.includes(value) ? value : null;
}

/** Pick the display locale from an explicit preference or ordered system languages. */
export function resolveLocale(preference = 'system', systemLanguages = []) {
  if (LOCALES.includes(preference)) return preference;
  for (const tag of Array.isArray(systemLanguages) ? systemLanguages : [systemLanguages]) {
    const value = String(tag || '').toLowerCase().replace(/_/g, '-');
    if (value.startsWith('zh')) return /hant|-tw\b|-hk\b|-mo\b/.test(value) ? 'zh-TW' : 'zh-CN';
    if (value.startsWith('en')) return 'en';
  }
  return 'en';
}

let current = SOURCE_LOCALE;
let catalog = Object.create(null);
let patterns = null;
let pluralRules = null;
const messageCache = new Map();

/** Select the active locale and its catalog; unknown locales fall back to the source. */
export function setLocale(locale, messages = {}) {
  current = LOCALES.includes(locale) ? locale : SOURCE_LOCALE;
  catalog = Object.assign(Object.create(null), current === SOURCE_LOCALE ? {} : messages);
  patterns = null;
  messageCache.clear();
  pluralRules = typeof Intl !== 'undefined' ? new Intl.PluralRules(INTL_LOCALES[current]) : null;
  return current;
}

export function currentLocale() { return current; }
export function intlLocale() { return INTL_LOCALES[current]; }

function interpolate(template, params) {
  if (params == null) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) && params[name] != null ? String(params[name]) : match));
}

function countOf(params) {
  if (params == null) return NaN;
  if (Object.hasOwn(params, 'count')) return Number(params.count);
  if (Array.isArray(params)) { const value = params.find(item => typeof item === 'number'); return value === undefined ? NaN : value; }
  return NaN;
}

// "text@@context" keys separate identical source wording with different meanings
// (a status "启用@@status" versus the action "启用"); the source shows only "text".
const CONTEXT_MARK = '@@';
function sourceText(source) {
  const index = typeof source === 'string' ? source.indexOf(CONTEXT_MARK) : -1;
  return index < 0 ? source : source.slice(0, index);
}

/**
 * Translate interface text written in the source language.
 * params: positional array for {0},{1}… or an object for {name}. A catalog value
 * may be {one, other} for plural forms selected by `count` or the first number.
 */
export function $t(source, params) {
  let entry = current === SOURCE_LOCALE ? undefined : catalog[source];
  if (entry && typeof entry === 'object') {
    const count = countOf(params);
    entry = (Number.isFinite(count) && pluralRules ? entry[pluralRules.select(count)] : undefined) ?? entry.other;
  }
  return interpolate(typeof entry === 'string' ? entry : sourceText(source), params);
}

function compilePatterns() {
  const list = [];
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value !== 'string' || !/\{\w+\}/.test(key)) continue;
    // Generic shapes such as "{0}：{1}" would rewrite business text; require real wording.
    if ((key.replace(/\{\w+\}/g, '').match(/[\u4e00-\u9fff]/g) || []).length < 4) continue;
    const names = [];
    const source = key.split(/(\{\w+\})/).map(part => {
      const placeholder = /^\{(\w+)\}$/.exec(part);
      if (placeholder) { names.push(placeholder[1]); return '([\\s\\S]+?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    list.push({ regex: new RegExp(`^${source}$`), names, template: value, literal: key.replace(/\{\w+\}/g, '').length });
  }
  return list.sort((a, b) => b.literal - a.literal);
}

/**
 * Translate text produced elsewhere (server errors, stored system events).
 * Exact catalog entries win; otherwise a catalog key with placeholders is used
 * as a pattern. Unknown text, including business content, is returned as is.
 */
export function $tm(text) {
  if (current === SOURCE_LOCALE || typeof text !== 'string' || !text) return text;
  const exact = catalog[text];
  if (typeof exact === 'string') return exact;
  if (exact && typeof exact === 'object') return exact.other ?? text;
  if (messageCache.has(text)) return messageCache.get(text);
  patterns ||= compilePatterns();
  let result = text;
  for (const { regex, names, template } of patterns) {
    const match = regex.exec(text);
    if (!match) continue;
    result = template.replace(/\{(\w+)\}/g, (placeholder, name) => {
      const index = names.indexOf(name);
      return index >= 0 ? $tm(match[index + 1]) : placeholder;
    });
    break;
  }
  // Bounded: console rendering repeats the same system texts many times.
  if (messageCache.size > 2000) messageCache.clear();
  messageCache.set(text, result);
  return result;
}

const STATIC_ATTRIBUTES = ['title', 'aria-label', 'aria-description', 'placeholder', 'alt', 'data-tooltip'];
/** Translate static markup once (shell and auth pages). Dynamic content uses $t at render time. */
export function localizeStatic(root) {
  if (current === SOURCE_LOCALE || !root) return;
  const document = root.ownerDocument || root;
  const walker = document.createTreeWalker(root, 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue, trimmed = text.trim();
    if (!trimmed || !Object.hasOwn(catalog, trimmed)) continue;
    node.nodeValue = text.replace(trimmed, $t(trimmed));
  }
  for (const element of root.querySelectorAll?.('*') || []) {
    for (const name of STATIC_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value && Object.hasOwn(catalog, value.trim())) element.setAttribute(name, $t(value.trim()));
    }
  }
  if (document.title && Object.hasOwn(catalog, document.title)) document.title = $t(document.title);
}

// The renderer resolves its locale before any importing module evaluates, so
// translated module-level constants are correct. A failed catalog read keeps
// the source language instead of blocking the interface.
async function bootstrapBrowser() {
  let locale = null, preference = 'system', system = navigator.languages?.length ? navigator.languages : [navigator.language];
  try {
    const selection = await globalThis.batonDesktop?.getLocale?.();
    if (LOCALES.includes(selection?.locale)) locale = selection.locale;
    else if (normalizeLanguage(selection?.language)) preference = selection.language;
  } catch { /* Outside the desktop host, follow the browser languages. */ }
  locale ||= resolveLocale(preference, system);
  if (locale !== SOURCE_LOCALE) {
    try {
      const response = await fetch(`/client/locales/${locale}.json`, { cache: 'no-store' });
      if (response.ok) setLocale(locale, await response.json());
    } catch { /* Keep the source language when the catalog is unavailable. */ }
  }
  document.documentElement.lang = current;
}
if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof fetch === 'function' && !globalThis.process?.versions?.node) await bootstrapBrowser();
