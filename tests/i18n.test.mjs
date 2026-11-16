// Interface translation: locale resolution, lookup semantics and catalog completeness.
// The catalogs are keyed by the Simplified Chinese source text, so every literal
// $t("…") in interface code must have an English and a Traditional Chinese entry.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { $t, $tm, LOCALES, normalizeLanguage, resolveLocale, setLocale, currentLocale, intlLocale } from "../client/i18n.mjs";

const root = new URL("..", import.meta.url).pathname;
const readJson = async path => JSON.parse(await readFile(join(root, path), "utf8"));
const catalogs = { en: await readJson("client/locales/en.json"), "zh-TW": await readJson("client/locales/zh-TW.json") };
const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = text => new Set([...text.matchAll(PLACEHOLDER)].map(match => match[1]));
const valuesOf = value => (typeof value === "object" ? [value.one, value.other] : [value]);

/** Every literal first argument of $t("…") in the interface and host sources. */
async function interfaceKeys() {
  const files = [];
  for (const directory of ["web", "client", "apps/electron"]) {
    for (const name of await readdir(join(root, directory))) if (/\.(m?js)$/.test(name)) files.push(join(directory, name));
  }
  const keys = new Map();
  for (const file of files) {
    const source = await readFile(join(root, file), "utf8");
    assert.doesNotMatch(source, /\$t\(\s*['`]/, `${file} must call $t with a double-quoted literal so catalogs stay checkable`);
    for (const match of source.matchAll(/\$t\(\s*"((?:[^"\\\n]|\\.)*)"/g)) {
      const key = JSON.parse(`"${match[1]}"`);
      if (/[一-鿿]/.test(key) && !keys.has(key)) keys.set(key, file);
    }
  }
  return keys;
}

test("resolveLocale maps preferences and system languages to supported locales", () => {
  const cases = [
    [["system", ["zh-Hant-TW"]], "zh-TW"], [["system", ["zh-HK"]], "zh-TW"], [["system", ["zh-Hans-CN"]], "zh-CN"],
    [["system", ["zh"]], "zh-CN"], [["system", ["en-GB"]], "en"], [["system", ["fr-FR", "zh-TW"]], "zh-TW"],
    [["system", ["fr-FR"]], "en"], [["system", []], "en"], [["zh-CN", ["en-US"]], "zh-CN"], [["en", ["zh-CN"]], "en"],
  ];
  for (const [[preference, languages], expected] of cases) {
    const actual = resolveLocale(preference, languages);
    console.log(`resolveLocale(${preference}, ${JSON.stringify(languages)}) -> ${actual}`);
    assert.equal(actual, expected);
  }
  assert.deepEqual(LOCALES, ["zh-CN", "zh-TW", "en"]);
  assert.equal(normalizeLanguage("system"), "system");
  assert.equal(normalizeLanguage("zh-TW"), "zh-TW");
  assert.equal(normalizeLanguage("ja"), null, "unsupported languages are rejected, not stored");
  assert.equal(normalizeLanguage(undefined), null);
});

test("$t and $tm keep the source language in Node and translate after setLocale", () => {
  try {
    assert.equal(currentLocale(), "zh-CN");
    assert.equal($t("确认"), "确认", "the source locale is an identity lookup");
    assert.equal($t("启用@@status"), "启用", "context keys show only the source wording");
    assert.equal($t("第 {0} 次执行", [3]), "第 3 次执行");
    assert.equal($tm("用户名或密码错误"), "用户名或密码错误");

    setLocale("en", catalogs.en);
    assert.equal(currentLocale(), "en");
    assert.equal(intlLocale(), "en-US");
    assert.equal($t("确认"), "Confirm");
    assert.equal($t("启用"), "Enable", "the action keeps its own entry");
    assert.equal($t("启用@@status"), "Enabled", "the status uses the context entry");
    assert.equal($t("{0} 分钟前", [1]), "1 minute ago", "plural one");
    assert.equal($t("{0} 分钟前", [5]), "5 minutes ago", "plural other");
    assert.equal($t("没有这个键 {0}", ["x"]), "没有这个键 x", "unknown text falls back to the source");
    assert.equal($tm("用户名或密码错误"), "Incorrect username or password", "server errors translate exactly");
    const composed = $tm("插件「demo」无法安装：插件清单无效；本批次未安装");
    console.log(`pattern translation -> ${composed}`);
    assert.equal(composed, "Plugin “demo” cannot be installed: Invalid plugin manifest; nothing in this batch was installed", "patterns translate their captured system text too");
    assert.equal($tm("这是用户写的业务内容"), "这是用户写的业务内容", "business content is never rewritten");
    assert.equal($tm("A：B"), "A：B", "generic shapes without real wording are not patterns");

    setLocale("zh-TW", catalogs["zh-TW"]);
    assert.equal($t("数字员工"), "數位員工");
    assert.equal($t("控制台"), "主控台");
    assert.equal($t("{0} 分钟前", [2]), "2 分鐘前");
  } finally {
    setLocale("zh-CN");
  }
  assert.equal($t("确认"), "确认", "resetting returns to the source language");
});

test("every interface key has English and Traditional Chinese entries", async () => {
  const keys = await interfaceKeys();
  console.log(`interface keys: ${keys.size}; en entries: ${Object.keys(catalogs.en).length}; zh-TW entries: ${Object.keys(catalogs["zh-TW"]).length}`);
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const missing = [...keys].filter(([key]) => !Object.hasOwn(catalog, key)).map(([key, file]) => `${file}: ${key}`);
    if (missing.length) console.log(`${locale} missing:\n  ${missing.slice(0, 20).join("\n  ")}`);
    assert.deepEqual(missing, [], `${locale} catalog is missing interface keys`);
  }
});

test("static shell and sign-in markup is covered by the catalogs", async () => {
  let checked = 0;
  for (const file of ["web/index.html", "web/login.html", "web/setup.html"]) {
    const body = (await readFile(join(root, file), "utf8")).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
    const texts = [...body.matchAll(/>([^<>]+)</g)].map(match => match[1].trim())
      .concat([...body.matchAll(/\s(?:title|aria-label|aria-description|placeholder|alt|data-tooltip)="([^"]+)"/g)].map(match => match[1].trim()))
      .filter(text => /[一-鿿]/.test(text));
    for (const text of texts) {
      checked += 1;
      for (const [locale, catalog] of Object.entries(catalogs)) assert.ok(Object.hasOwn(catalog, text), `${locale} lacks static text from ${file}: ${text}`);
    }
  }
  console.log(`static texts checked: ${checked}`);
  assert.ok(checked > 30);
});

test("catalog values keep placeholders and add no markup characters", () => {
  for (const [locale, catalog] of Object.entries(catalogs)) {
    let plural = 0;
    for (const [key, value] of Object.entries(catalog)) {
      if (typeof value === "object") {
        plural += 1;
        assert.ok(typeof value.one === "string" && typeof value.other === "string", `${locale} plural needs one/other: ${key}`);
      } else assert.equal(typeof value, "string", `${locale} value must be text: ${key}`);
      const allowed = placeholders(key);
      for (const text of valuesOf(value)) {
        for (const name of placeholders(text)) assert.ok(allowed.has(name), `${locale} introduces {${name}} in: ${key}`);
        for (const char of '<>&"') assert.ok(text.split(char).length <= key.split(char).length, `${locale} adds ${char} in: ${key}`);
      }
    }
    console.log(`${locale}: ${Object.keys(catalog).length} entries, ${plural} plural`);
  }
  assert.ok(Object.values(catalogs["zh-TW"]).every(value => typeof value === "string"), "Chinese has no plural forms");
});

test("English has no Chinese text and Traditional Chinese has no common Simplified-only characters", () => {
  const han = Object.entries(catalogs.en).filter(([, value]) => valuesOf(value).some(text => /[一-鿿]/.test(text)));
  assert.deepEqual(han.map(([key]) => key), []);
  const simplifiedOnly = /[这们个为时设数据务员话发记录应关开页项进运动选择认证错误让过还没对间]/;
  const leftovers = Object.entries(catalogs["zh-TW"]).filter(([, value]) => simplifiedOnly.test(value));
  if (leftovers.length) console.log(`zh-TW leftovers: ${leftovers.slice(0, 10).map(([, value]) => value).join(" | ")}`);
  assert.deepEqual(leftovers.map(([key]) => key), []);
});
