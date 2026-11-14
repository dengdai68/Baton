import {writeStorageLocation} from '../server/storage-layout.mjs';
// Real isolated Electron presentation QA, no Provider calls or operator data.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAuth } from '../server/auth.mjs';
import { createCatalogFixtureStore } from '../tests/fixture-store.mjs';

await mkdir('.data', { recursive: true });
const root = await mkdtemp(resolve('.data/brand-presentation-'));
const bundle = process.env.AGENTFORGE_BRAND_APP, home = join(root, 'home');
const iconsOnly = process.env.AGENTFORGE_BRAND_ICONS_ONLY === '1';
const data = bundle ? join(home, '.agentforge/desktop') : join(root, 'client');
await mkdir(home, { recursive: true });
const password = randomBytes(24).toString('hex');
const auth = createAuth({ databasePath: join(data, 'auth.sqlite') });
await auth.setAdministrator('brand-qa', password); auth.close();
await writeFile(join(data, 'desktop-preferences.json'), JSON.stringify({closeMode:'tray'}), {mode:0o600});
const store = createCatalogFixtureStore({ databasePath:join(root,'work','records','agentforge.sqlite'),configurationDirectory:data, workspaceRoot: join(root, 'work') });
store.updateAgent('agent_analyst', { status: 'inactive' });
store.createRole({ name: '品牌展示角色', prompt: '仅用于品牌展示验收的提示词。' }); store.close();
const source = join(root, 'plugin');
await mkdir(join(source, '.claude-plugin'), { recursive: true });
await mkdir(join(source, 'skills/brand'), { recursive: true });
await writeFile(join(source, 'skills/brand/SKILL.md'), '---\nname: brand\ndescription: Presentation fixture only\n---\nNo execution.');
await writeFile(join(source, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'brand-presentation-fixture', description: '仅用于静态展示，不执行插件。', version: '1.0.0', settings: {} }));
await writeStorageLocation(data,{version:1,workspaceRoot:join(root,'work'),previousRuntimeRoots:[]});
const app = await electron.launch({ ...(bundle ? { executablePath: resolve(bundle, 'Contents/MacOS/AgentForge') } : {}), args: bundle ? [] : ['apps/electron/main.mjs'], env: { ...process.env, HOME: home, AGENTFORGE_DESKTOP_DATA_ROOT: data, AGENTFORGE_LOG_DIR: join(root, 'logs') }, timeout: 180000 });
const evidence = { root, bundle: bundle || 'source', cases: [] }, errors = [];
const presentation = node => {
  const c=getComputedStyle(node), result=Object.fromEntries(['backgroundColor','color','borderTopColor','borderTopWidth','borderTopStyle','borderRadius','padding','margin','fontSize','lineHeight'].map(k=>[k,c[k]]));
  const layers=[];for(let parent=node;parent;parent=parent.parentElement)layers.push(getComputedStyle(parent).backgroundColor.match(/[\d.]+/g).map(Number));
  const background=layers.reverse().reduce((base,[r,g,b,a=1])=>[r,g,b].map((value,i)=>value*a+base[i]*(1-a)),[255,255,255]);
  result.effectiveBackgroundColor=`rgb(${background.join(', ')})`;return result;
};
const luminance = rgb => { const v = rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); return .2126*v[0] + .7152*v[1] + .0722*v[2]; };
const contrast = style => { const a = luminance(style.color), b = luminance(style.effectiveBackgroundColor || style.backgroundColor); return (Math.max(a,b)+.05)/(Math.min(a,b)+.05); };
const checkApplicationIcon = async page => {
  await page.waitForFunction(() => document.querySelector('.application-icon')?.naturalWidth===1024);
  const icon = await page.locator('.application-icon').evaluate(n => {
    const style=getComputedStyle(n), canvas=document.createElement('canvas'); canvas.width=canvas.height=1024;
    const c=canvas.getContext('2d');c.drawImage(n,0,0);const pixel=(x,y)=>[...c.getImageData(x,y,1,1).data];
    return {border:style.borderTopWidth,background:style.backgroundColor,shadow:style.boxShadow,corner:pixel(0,0),edge:pixel(512,2),width:n.width,height:n.height};
  });
  assert.equal(icon.border,'0px');assert.equal(icon.background,'rgba(0, 0, 0, 0)');assert.equal(icon.shadow,'none');
  assert.equal(icon.corner[3],0);assert.equal(icon.edge[3],255);assert.ok(Math.min(...icon.edge.slice(0,3))<100,'no white matte');
  assert.equal(icon.width,icon.height,'no distorted sidebar image');
  return icon;
};
try {
  const page = await app.firstWindow({ timeout: 180000 }); page.on('pageerror', e => errors.push(e.message));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:/, { timeout: 180000 });
  const origin = new URL(page.url()).origin; console.log('Client ready');
  await page.goto(origin + '/login'); await page.locator('#username').fill('brand-qa'); await page.locator('#password').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('#account-name').waitFor();
  const api = (path, body) => page.evaluate(async ({ path, body }) => { const r = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); const value = await r.json(); if (!r.ok) throw Error(JSON.stringify(value)); return value; }, { path, body });
  if (!iconsOnly) {
    console.log('Importing display fixtures');
    await api('/api/runtime/marketplace', { path: source });
    await api('/api/runtime/mcp-marketplace', { name:'品牌 MCP 展示夹具', description:'静态展示夹具，不执行服务。', content:JSON.stringify({ mcpServers:{ fixture:{ command:'node', args:['--version'], cwd:root } } }) });
  }
  const resize = async (width, height) => { await app.evaluate(({ BrowserWindow }, {origin,width,height}) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith(origin)).setContentSize(width,height), {origin,width,height}); await page.waitForFunction(w => innerWidth === w, width); };
  for (const theme of ['light','dark']) {
    await page.goto(origin + '/settings/appearance'); await page.locator(`[name=theme][value=${theme}]`).check();
    for (const width of [1320,760]) { console.log('Checking',theme,width);
      await resize(width,760);
      if (iconsOnly) {
        await page.goto(origin + '/agents');
        const icon = await checkApplicationIcon(page);
        evidence.cases.push({theme,width,icon});
        await page.screenshot({path:join(root,`${theme}-${width}-icons.png`)});
        continue;
      }
      await page.goto(origin + '/roles'); await page.locator('#roles-search').fill('不存在'); await page.locator('#roles-empty').waitFor();
      const empty = await page.locator('#roles-empty').evaluate(presentation);
      assert.equal(empty.borderTopStyle,'none'); assert.equal(empty.borderTopWidth,'0px'); assert.equal(empty.margin,'0px'); assert.ok(contrast(empty) >= 4.5, 'empty text contrast');
      await page.locator('#roles-search').fill('不存在'); assert.match(await page.locator('#roles-empty').innerText(),/没有匹配/); assert.deepEqual(await page.locator('#roles-empty').evaluate(presentation),empty);
      await page.locator('#roles-search').clear();
      const button = await page.locator('#roles-header-actions .primary-button').evaluate(presentation); assert.ok(contrast(button) >= 4.5, 'primary button text contrast');
      await page.locator('#roles-header-actions .primary-button').focus(); assert.equal(await page.locator('#roles-header-actions .primary-button').evaluate(n => n === document.activeElement),true);
      const focus = await page.locator('#roles-header-actions .primary-button').evaluate(n => ({width:getComputedStyle(n).outlineWidth,style:getComputedStyle(n).outlineStyle})); assert.notEqual(focus.width,'0px'); assert.equal(focus.style,'solid');
      await page.screenshot({ path:join(root,`${theme}-${width}-roles.png`) });
      let supportStyle;
      for (const view of ['marketplace','mcp-marketplace']) {
        await page.goto(origin + '/' + view); await page.locator('[data-market-list] .agent-card').first().waitFor();
        assert.equal(await page.locator('[data-market-list] .runtime-support, [data-market-list] .extension-runtime-badges').count(),0,'market cards omit Runtime support labels');
        assert.deepEqual(await page.locator('[data-market-list] .extension-title-line .extension-tag').allTextContents(),[view==='marketplace'?'1.0.0':'stdio'],'version or transport stays beside the extension name');
        await page.locator('[data-extension-detail]').first().click(); await page.locator('.extension-detail-overview').waitFor();
        if(view==='marketplace') {
          const supported=await page.locator('.plugin-runtime-compatibility .runtime-support[data-supported=true]').first().evaluate(presentation);
          const unsupported=await page.locator('.plugin-runtime-compatibility .runtime-support[data-supported=false]').first().evaluate(presentation);
          assert.ok(contrast(supported)>=4.5);assert.ok(contrast(unsupported)>=3,'secondary incompatibility text meets the Graphite 3:1 requirement');
          supportStyle=supported;
        }
        assert.equal(await page.locator('.extension-detail-overview .agent-card-avatar').evaluate(n => { const c=getComputedStyle(n);return c.color===c.backgroundColor; }),false);
        await page.locator('[data-close-modal]').click();
        await page.screenshot({ path:join(root,`${theme}-${width}-${view}.png`) });
        await page.getByRole('searchbox').fill('不存在'); await page.locator('[data-market-empty]').filter({ hasText:'没有匹配的' }).waitFor();
        assert.deepEqual(await page.locator('[data-market-empty]').evaluate(presentation),empty,'all three directory empty styles match');
        assert.equal(await page.locator('[data-market-list]').isHidden(),true);
        await page.screenshot({ path:join(root,`${theme}-${width}-${view}-empty.png`) });
      }
      await page.goto(origin + '/agents'); await page.locator('.agent-status[data-status=inactive]').first().waitFor();
      // Available is the default state and carries no badge; only a disabled employee is labeled.
      assert.equal(await page.locator('.agent-status[data-status=active]').first().isVisible(),false,'available employees show no status badge');
      const inactive = await page.locator('.agent-status[data-status=inactive]').evaluate(presentation); assert.ok(contrast(inactive)>=4.5); assert.notEqual(inactive.color,supportStyle.color,'disabled reads neutral, not as the Runtime accent');
      const avatarStyles = await page.locator('.agent-card-avatar').evaluateAll(nodes => nodes.map(n => ({color:getComputedStyle(n).color,backgroundColor:getComputedStyle(n).backgroundColor})));
      assert.ok(avatarStyles.every(s => contrast(s) >= 4.5),'avatar initials contrast');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
      await checkApplicationIcon(page);
      await page.screenshot({ path:join(root,`${theme}-${width}-agents.png`) });
      // Every directory uses the exact same surface and spans its full content row.
      const checkEmpty = async (selector, reference) => {
        const snapshot=await page.waitForFunction(({selector,reference})=>{const node=document.querySelector(selector),ref=document.querySelector(reference);if(!node?.getClientRects().length||!ref?.getClientRects().length)return false;const c=getComputedStyle(node),rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,width:r.width,height:r.height};};return {style:Object.fromEntries(['backgroundColor','color','borderTopColor','borderTopWidth','borderTopStyle','borderRadius','padding','margin','fontSize','lineHeight'].map(k=>[k,c[k]])),box:rect(node),row:(()=>{const r=rect(ref),s=getComputedStyle(ref),left=parseFloat(s.paddingLeft),right=parseFloat(s.paddingRight);return {...r,x:r.x+left,width:ref.clientWidth-left-right};})()};},{selector,reference});
        const {style,box,row}=await snapshot.jsonValue();const {effectiveBackgroundColor,...emptyStyle}=empty;assert.deepEqual(style,emptyStyle,`${selector}: shared computed style`);
        assert.ok(Math.abs(box.x-row.x)<1 && Math.abs(box.x+box.width-row.x-row.width)<1,`${selector}: both edges align with full row`);
        assert.ok(box.height>=160,`${selector}: centered icon/title/description empty state`);
        const center=await page.locator(selector).evaluate(node=>{const c=getComputedStyle(node),icon=getComputedStyle(node,'::before');return [c.display,c.alignItems,c.textAlign,icon.width,icon.height];});
        assert.deepEqual(center,['flex','center','center','40px','40px']);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      };
      for(const view of ['tasks','teams','workflows','agents','roles','marketplace','mcp-marketplace']) {
        await page.goto(origin+'/'+view);
        if(view==='tasks') {
          await page.locator('#task-search-form').waitFor();
          await page.locator('#task-search-form').getByRole('searchbox').fill('no-directory-match');
          await page.waitForTimeout(500);
        } else {
          await page.getByRole('searchbox').fill('no-directory-match');
        }
        const selector=`#${view}-view .directory-empty`;
        await page.locator(selector).filter({hasText:'没有匹配的'}).waitFor();
        await checkEmpty(selector, view==='tasks'?'#tasks-table':view==='roles'?'#roles-view':view==='marketplace'||view==='mcp-marketplace'?`#${view}-view .directory-content`:`#${view}-grid`);
        assert.equal(await page.locator('#live-indicator').count(),1);
        assert.equal(await page.locator('.user-card #live-indicator').count(),1);
        assert.equal(await page.locator('.topbar #live-indicator').count(),0);
        assert.equal(await page.locator('#live-indicator').isVisible(),width>1000,'collapsed sidebar keeps only the account avatar');
        await page.locator('#account-name').evaluate(n=>n.textContent='较长的管理员名称用于检查侧栏对齐');
        const account=await page.locator(width>1000?'#live-indicator':'.user-card .user-avatar').boundingBox(),footer=await page.locator('.user-card').boundingBox();
        assert.ok(account.x>=footer.x && account.x+account.width<=footer.x+footer.width+1,'visible account content stays within its footer');
        assert.ok(await page.locator('#live-indicator').getAttribute('aria-label'));
        await page.screenshot({path:join(root,`${theme}-${width}-${view}-aligned-empty.png`)});
      }
      await page.goto(origin+'/communication');
      await page.locator('[data-new-chat]').click();
      await page.locator('#chat-group-members').fill('no-directory-match');
      await page.locator('#chat-group-members-options').getByText('没有可添加的匹配项',{exact:true}).waitFor();
      await page.screenshot({path:join(root,`${theme}-${width}-communication-empty.png`)});
      await page.keyboard.press('Escape');
      await page.locator('[data-close-group]').click();
      evidence.cases.push({theme,width,empty,supported:supportStyle,button,inactiveColor:inactive.color,directories:8});
    }
  }
  const resources = bundle ? resolve(bundle,'Contents/Resources/app.asar/web/icons') : resolve('web/icons');
  const nativeIcons = await app.evaluate(({nativeImage}, root) => {
    const template=nativeImage.createFromPath(root+'/trayTemplate.png');
    const dock=nativeImage.createFromPath(root+'/application-dock.png');
    const data=dock.toBitmap();let minX=1024,minY=1024,maxX=-1,maxY=-1;
    for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if(data[(y*1024+x)*4+3]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    return {template:template.isTemplateImage(),size:template.getSize(),scales:template.getScaleFactors(),dockBounds:[minX,minY,maxX+1,maxY+1]};
  },resources);
  assert.equal(nativeIcons.template,true);assert.deepEqual(nativeIcons.size,{width:18,height:18});
  assert.deepEqual(nativeIcons.scales,[1,2]);assert.deepEqual(nativeIcons.dockBounds,[100,100,924,924]);
  evidence.nativeIcons=nativeIcons;
  if (!iconsOnly) {
    // The same full-width surface also represents a real HTTP read failure honestly.
    await page.route(url=>url.pathname==='/api/runtime/marketplace', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'品牌验收：读取失败'})}));
    await page.goto(origin + '/marketplace'); await page.locator('[data-market-empty][role=alert]').waitFor();
    assert.match(await page.locator('[data-market-empty]').innerText(),/读取失败/);
    assert.equal(await page.locator('[data-market-list]').isHidden(),true);
    await page.screenshot({path:join(root,'read-failure.png')});
    // Native confirmation loads compact.css without the renderer stylesheet.
    const dialogFile = bundle ? resolve(bundle,'Contents/Resources/app.asar/apps/electron/cli-confirmation.html') : resolve('apps/electron/cli-confirmation.html');
    await app.evaluate(async ({ BrowserWindow }, file) => {
      const preview = new BrowserWindow({ width:560,height:470,show:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,partition:'brand-native-preview'} });
      await preview.loadFile(file);
    },dialogFile);
    const dialog = app.windows().find(p=>p.url().includes('/cli-confirmation.html')); assert.ok(dialog);
    await dialog.locator('[data-choice=install]').waitFor();
    const dialogButton = await dialog.locator('[data-choice=install]').evaluate(presentation);
    const dialogAccent=await dialog.locator('body').evaluate(node=>{const probe=document.createElement('span');probe.style.color='var(--accent)';node.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;});
    assert.equal(dialogButton.backgroundColor,dialogAccent); assert.ok(contrast(dialogButton)>=4.5,'native dialog retains readable brand action without the renderer component stylesheet');
    await dialog.screenshot({path:join(root,'native-dialog.png')}); await dialog.locator('[data-choice=cancel]').click();
    await app.evaluate(({ BrowserWindow })=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/cli-confirmation.html'))?.destroy());
  }
  assert.deepEqual(errors,[]); evidence.result='PASS'; await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(iconsOnly ? 'PASS application icons:' : 'PASS brand presentation:',root);
} catch(error) { console.error('Evidence:',root);throw error; }
finally {await app.close();}
