// Production UI + real Three.js scene; synthetic account, tracks and lyrics only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
const desktop=process.env.RHINE_DESKTOP_EXE;
const output = desktop ? 'artifacts/current-native-ux' : 'artifacts/current-ux';
await fs.mkdir(output, {recursive:true});
let server,browser,page,child;
if(desktop) {
  child=spawn(path.resolve(desktop),[],{windowsHide:true,stdio:'ignore',env:{...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9336 --mute-audio',
    WEBVIEW2_USER_DATA_FOLDER:path.resolve('artifacts/current-native-profile'),
    RHINE_DESKTOP_DATA_DIR:path.resolve('artifacts/current-native-data')}});
  try {
    for(let i=0;i<100&&!browser;i++) {
      if(child.exitCode!==null)throw Error('Desktop exited before WebView initialization');
      try{browser=await chromium.connectOverCDP('http://127.0.0.1:9336',{timeout:2000});}catch{await new Promise(r=>setTimeout(r,300));}
    }
    if(!browser)throw Error('Desktop debugging connection unavailable');
    for(let i=0;i<100&&!page;i++) {
      page=browser.contexts()[0].pages().find(p=>p.url().includes('desktop=1')&&!/taskbar=1|tray=1/.test(p.url()));
      if(!page)await new Promise(r=>setTimeout(r,300));
    }
    if(!page)throw Error('Desktop main window missing');
  } catch(error) {await browser?.close();child.kill();throw error;}
} else {
  server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/src-tauri/**','**/artifacts/**','**/release/**','**/desktop-runtime/**']}},logLevel:'error'});
  await server.listen();
  browser=await chromium.launch({executablePath:process.env.RHINE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--mute-audio','--use-angle=d3d11']});
  page=await browser.newPage({viewport:{width:1280,height:800}});
}
page.setDefaultTimeout(90000);
const errors = [], report = {runtimeChecked:false,scope:desktop?'Windows production WebView2; isolated profile, synthetic data and muted audio':'Real browser WebGL; synthetic account/data, muted, no private library',sizes:[]};
page.on('pageerror',e=>errors.push(e.stack));
await page.addInitScript(()=>{localStorage.setItem('rhine-music-preferences',JSON.stringify({startupOpening:true,reduced:false,sfx:false,theme:'night',quality:'performance'}));});
const silence=Buffer.alloc(44+8000*2*180);silence.write('RIFF');silence.writeUInt32LE(silence.length-8,4);silence.write('WAVEfmt ',8);silence.writeUInt32LE(16,16);silence.writeUInt16LE(1,20);silence.writeUInt16LE(1,22);silence.writeUInt32LE(8000,24);silence.writeUInt32LE(16000,28);silence.writeUInt16LE(2,32);silence.writeUInt16LE(16,34);silence.write('data',36);silence.writeUInt32LE(silence.length-44,40);
const tracks = Array.from({length:120},(_,i)=>({id:`netease-${1000+i}`,title:`合成曲目 ${String(i+1).padStart(3,'0')}`,artist:'测试歌手 / 合作歌手',albumId:`album-${i}`,duration:180,format:'在线音频',browserPlayable:true,onlineSource:{provider:'netease',id:String(1000+i),albumTitle:'合成专辑'}}));
await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()), p=url.pathname;
  if(p==='/api/fixture.wav'){await route.fulfill({contentType:'audio/wav',body:silence});return;}
  const json=p.includes('/prepare/')?{audioUrl:url.origin+'/api/fixture.wav',duration:180}:p==='/api/library'?{version:1,albums:[],genres:[],roots:[],scan:{running:false},onlineEnabled:true}:
    p==='/api/audio/capabilities'?{decoderAvailable:false,nativeAvailable:false,devices:[]}:
    p.endsWith('/auth/status')?{loggedIn:p.includes('/netease/'),profile:{nickname:'合成测试用户',userId:'12345'}}:
    p.endsWith('/playlists')?{playlists:[{id:'123',name:'合成歌单 · 档案测试',trackCount:120,owned:true},{id:'456',name:'空歌单',trackCount:0,owned:true}],hasMore:false}:
    p.endsWith('/tracks')?{tracks:p.includes('/456/')?[]:tracks.slice(Number(url.searchParams.get('offset')),Number(url.searchParams.get('offset'))+50),total:p.includes('/456/')?0:120}:
    p.includes('/together')?{session:'test',inRoom:false,active:false,queueIds:[],chat:{connected:false,messages:[]}}:
    p.endsWith('/info')?{track:tracks[0],album:{title:'合成专辑'},lyrics:{original:'[00:00.00]合成歌词第一行\n[00:03.00]合成歌词第二行'}}:
    p.includes('/lyric')?{original:'[00:00.00]合成歌词第一行\n[00:03.00]合成歌词第二行'}:{};
  await route.fulfill({json}).catch(()=>{});
});
try {
  if(desktop)await page.reload();else await page.goto(server.resolvedUrls.local[0]);
  await page.locator('.music-app').waitFor();
  await page.waitForFunction(()=>!document.querySelector('#music-loading'));
  await page.locator('.music-boot-skip').waitFor({state:'visible'});
  assert.equal(await page.locator('.rhine-loading').count(),0,'Daily startup skips the full loading film');
  await page.locator('.music-boot-skip').click();
  await page.waitForFunction(()=>document.querySelector('.music-app').dataset.musicBoot==='done');
  await page.locator('.open-album').waitFor({state:'visible'});
  await page.waitForTimeout(1500);
  for(const viewport of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080},{width:1024,height:768}]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(350);
    const geometry=await page.evaluate(()=>{
      const left=s=>document.querySelector(s).getBoundingClientRect().left;
      return {brand:left('.music-identity'),toggle:left('.music-view-toggle'),overview:parseFloat(getComputedStyle(document.querySelector('.overview-heading')).left)};
    });
    assert.ok(Math.abs(geometry.brand-geometry.toggle)<1,JSON.stringify({viewport,geometry}));
    assert.ok(Math.abs(geometry.brand-geometry.overview)<1,JSON.stringify({viewport,geometry}));
    await page.screenshot({path:`${output}/home-${viewport.width}.png`});
    await page.locator('.open-album').click();
    await page.locator('#song-tab-info').waitFor({state:'visible'});
    await page.waitForTimeout(500);
    const tabs=[];
    for(const tab of ['lyrics','info','together']) {
      if(tab==='together'&&await page.locator('#song-tab-together').count()===0)continue;
      await page.locator(`#song-tab-${tab}`).click(); await page.waitForTimeout(1000);
      const geometry=await page.evaluate(()=>{
        const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();
        return {title:box('#album-detail-content > h1'),artist:box('.detail-artist'),play:box('#song-toggle-stop'),add:box('.song-add-playlist'),tabs:box('.song-view-tabs'),font:getComputedStyle(document.querySelector('#album-detail-content > h1')).fontSize};
      });
      assert.ok(geometry.play.right+4<=geometry.add.left,'Playback and add button must not overlap');
      assert.ok(geometry.add.bottom<=geometry.tabs.top,'Actions precede tabs');
      tabs.push(geometry);
      await page.screenshot({path:`${output}/detail-${viewport.width}-${tab}.png`});
    }
    for(const item of tabs.slice(1)) {assert.equal(item.font,tabs[0].font);assert.equal(item.title.height,tabs[0].title.height);assert.equal(item.title.y,tabs[0].title.y);}
    report.sizes.push({viewport,geometry,tabs});
    await page.locator('.music-back').click(); await page.waitForTimeout(1000);
  }
  await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(300);
  // Real wheel events and per-frame observations catch a one-frame old-title return.
  await page.evaluate(()=>{window.titleFrames=[];window.captureTitles=true;const frame=()=>{if(!window.captureTitles)return;const n=document.querySelector('#selection-title');window.titleFrames.push({title:n.getAttribute('aria-label'),rapid:document.querySelector('.music-title-rapid').hidden,faces:[...n.querySelectorAll('.music-title-face')].filter(n=>{const b=n.getBoundingClientRect(),s=n.closest('.music-title-slot').getBoundingClientRect();return getComputedStyle(n.closest('.music-title-slot')).visibility!=='hidden'&&b.top>=s.top-1&&b.top<s.bottom-1;}).map(n=>n.textContent).join(''),numberAnimation:document.querySelector('#selection-code-number').getAnimations({subtree:true}).length});requestAnimationFrame(frame);};frame();});
  await page.mouse.move(400,400);
  for(let i=0;i<6;i++){await page.mouse.wheel(0,120);await page.waitForTimeout(120);}
  await page.waitForTimeout(1100);
  const frames=await page.evaluate(()=>{window.captureTitles=false;return window.titleFrames;});
  assert.ok(new Set(frames.map(f=>f.title)).size>2,'Real wheel changes selection');
  assert.ok(frames.some(f=>f.numberAnimation>0),'SONG number has a live rolling animation');
  for(const f of frames)if(f.rapid&&f.title&&f.faces)assert.equal(f.faces,f.title,'Every painted settled title matches the current selection');
  report.wheel=frames;
  await page.locator('#selection-genre').click();
  await page.locator('[aria-label="歌单歌曲列表"]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-playlist-detail-track]').count(),50);
  await page.locator('[data-action="playlist-detail-next"]').click();
  await page.locator('[data-playlist-detail-track="50"]').waitFor();
  await page.screenshot({path:`${output}/playlist-detail.png`});
  await page.locator('.music-back').click();await page.waitForTimeout(1000);
  await page.locator('.music-view-toggle').click();await page.waitForTimeout(1500);
  await page.screenshot({path:`${output}/overview.png`});
  await page.locator('[data-overview-playlist-open]').filter({hasText:'合成歌单'}).first().click();
  await page.locator('[aria-label="歌单歌曲列表"]').waitFor({state:'visible'});
  assert.ok((await page.locator('#album-detail-content > h1').textContent()).includes('合成歌单'));
  await page.locator('[data-action="settings"]').first().click();
  await page.locator('[data-category="developer"]').click();
  await page.locator('[data-action="replay-boot"]').click();
  await page.locator('.rhine-loading').waitFor({state:'visible'});
  await page.waitForFunction(()=>Number(document.querySelector('.rhine-loading .opening-stage')?.dataset.bootFrame)>=330);
  await page.screenshot({path:`${output}/manual-full-opening.png`});
  await page.locator('.opening-skip').click();
  await page.locator('.music-boot-skip').waitFor({state:'visible'});
  await page.locator('.music-boot-skip').click();
  await page.waitForFunction(()=>document.querySelector('.music-app').dataset.musicBoot==='done');
  report.manualFullOpening=true;
  assert.deepEqual(errors,[]);
  if(desktop) {
    await page.evaluate(()=>window.__TAURI__.core.invoke('desktop_close_decision',{behavior:'tray',remember:false}));
    assert.equal(await page.evaluate(()=>window.__TAURI__.window.getCurrentWindow().isVisible()),false);
    await page.evaluate(()=>window.__TAURI__.core.invoke('desktop_tray_action',{action:'show'}));
    assert.equal(await page.evaluate(()=>window.__TAURI__.window.getCurrentWindow().isVisible()),true);
    report.trayHideRestore=true;
  }
  report.runtimeChecked=true;report.playlistEntrances=true;report.errors=errors;
  await fs.writeFile(`${output}/results.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,sizes:report.sizes.length,wheelFrames:frames.length,playlistEntrances:true}));
} catch(error) {await page.screenshot({path:`${output}/failure.png`});console.error(errors);throw error;}
finally {await browser.close();await server?.close();child?.kill();}
