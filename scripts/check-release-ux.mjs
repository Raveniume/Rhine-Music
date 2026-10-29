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
async function recordTransition() {
  const cdp=await page.context().newCDPSession(page), frames=[], writes=[];
  const dir=path.resolve(output,'playlist-transition'); await fs.mkdir(dir,{recursive:true});
  cdp.on('Page.screencastFrame',event=>{
    const name=String(frames.length).padStart(4,'0')+'.jpg';
    frames.push({file:name,time:event.metadata.timestamp});
    writes.push(fs.writeFile(path.join(dir,name),Buffer.from(event.data,'base64')));
    void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});
  });
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,maxWidth:1440,maxHeight:900,everyNthFrame:1});
  return async()=>{await cdp.send('Page.stopScreencast');await Promise.all(writes);await cdp.detach();
    await fs.writeFile(path.join(dir,'frames.json'),JSON.stringify(frames,null,2));
    await fs.writeFile(path.join(dir,'frames.txt'),frames.map((f,i)=>`file '${f.file}'\nduration ${Math.max(.01,(frames[i+1]?.time??f.time+.08)-f.time)}`).join('\n')+'\n');};
}
if(desktop) {
  child=spawn(path.resolve(desktop),[],{windowsHide:true,stdio:'ignore',env:{...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9336 --mute-audio',
    WEBVIEW2_USER_DATA_FOLDER:path.resolve(`artifacts/current-native-profile-${process.pid}`),
    RHINE_DESKTOP_DATA_DIR:path.resolve(`artifacts/current-native-data-${process.pid}`)}});
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
const fixtureLyrics = Array.from({length:20},(_,i)=>`[00:${String(i*3).padStart(2,'0')}.00]合成歌词第 ${i+1} 行 · 用于检查底部渐隐`).join('\n');
const searchTracks=tracks.slice(0,2).map((t,i)=>({...t,id:'netease-'+(9000+i),title:'搜索独立曲目 '+(i+1),onlineSource:{...t.onlineSource,id:String(9000+i)}}));
let releaseDelayed;
const delayedPage = new Promise(resolve => { releaseDelayed=resolve; });
await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()), p=url.pathname;
  if (p.endsWith('/auth/start')) { await route.fulfill({json:{id:'synthetic-qr',image:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgc3R5bGU9ImZpbGw6d2hpdGUiLz48L3N2Zz4=',expiresAt:Date.now()+60000}}); return; }
  if(p.includes('/456/') && p.endsWith('/tracks')) { await delayedPage; await route.fulfill({json:{tracks:tracks.slice(0,12),total:12}}).catch(()=>{});return; }
  if(p==='/api/fixture.wav'){await route.fulfill({contentType:'audio/wav',body:silence});return;}
  const json=p.endsWith('/search')?{provider:'netease',query:'fixture',tracks:searchTracks,offset:0,limit:20,total:2,hasMore:false}:p.includes('/prepare/')?{audioUrl:url.origin+'/api/fixture.wav',duration:180}:p==='/api/library'?{version:1,albums:[],genres:[],roots:[],scan:{running:false},onlineEnabled:true}:
    p==='/api/audio/capabilities'?{decoderAvailable:false,nativeAvailable:false,devices:[]}:
    p.endsWith('/auth/status')?{loggedIn:p.includes('/netease/'),profile:{nickname:'合成测试用户',userId:'12345'}}:
    p.endsWith('/playlists')?{playlists:[{id:'123',name:'合成歌单 · 档案测试',trackCount:120,owned:true},{id:'456',name:'延迟歌单',trackCount:12,owned:true}],hasMore:false}:
    p.endsWith('/tracks')?{tracks:p.includes('/456/')?[]:tracks.slice(Number(url.searchParams.get('offset')),Number(url.searchParams.get('offset'))+50),total:p.includes('/456/')?0:120}:
    p.includes('/together')?{session:'test',inRoom:false,active:false,queueIds:[],chat:{connected:false,messages:[]}}:
    p.endsWith('/info')?{track:tracks[0],album:{title:'合成专辑'},lyrics:{original:fixtureLyrics}}:
    p.includes('/lyric')?{original:fixtureLyrics}:{};
  await route.fulfill({json}).catch(()=>{});
});
try {
  if(desktop)await page.reload();else await page.goto(server.resolvedUrls.local[0]);
  await page.locator('.music-app').waitFor();
  if(desktop) await page.evaluate(()=>window.__TAURI__.core.invoke('desktop_tray_action',{action:'show'}));
  await page.evaluate(()=>document.addEventListener('click',()=>{
    window.qaActionAt=performance.now();window.qaPlaylistFrameMs=undefined;
    requestAnimationFrame(()=>{const p=document.querySelector('#album-detail-content');if(p?.querySelector('.playlist-continuous-list')&&p.getBoundingClientRect().width&&p.closest('#music-detail')?.getAttribute('aria-hidden')==='false')window.qaPlaylistFrameMs=performance.now()-window.qaActionAt;});
  },true));
  await page.waitForFunction(()=>!document.querySelector('#music-loading'));
  report.startup=await page.evaluate(()=>JSON.parse(document.querySelector('#three-scene').dataset.startupPreparation||'{}'));
  await page.locator('.music-boot-skip').waitFor({state:'visible'});
  assert.equal(await page.locator('.rhine-loading').count(),0,'Daily startup skips the full loading film');
  await page.locator('.music-boot-skip').click();
  await page.waitForFunction(()=>document.querySelector('.music-app').dataset.musicBoot==='done');
  await page.locator('.open-album').waitFor({state:'visible'});
  await page.waitForTimeout(1500);
  if (desktop) {
    const toggle=page.locator('[data-action="toggle-taskbar-lyrics"]');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'),'false');
    const lyric=browser.contexts()[0].pages().find(p=>p.url().includes('taskbar=1'));
    await page.waitForTimeout(500);
    assert.equal(await lyric.evaluate(()=>window.__TAURI__.window.getCurrentWindow().isVisible()),false);
    await toggle.click();
    await page.waitForTimeout(500);
    assert.equal(await toggle.getAttribute('aria-pressed'),'true');
    assert.equal(await lyric.evaluate(()=>window.__TAURI__.window.getCurrentWindow().isVisible()),true);
    await page.locator('.music-topnav').screenshot({path:output+'/lyrics-toggle.png'});
    report.lyricsQuickToggle=true;
  }
  for(const viewport of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080},{width:1024,height:768}]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(350);
    const geometry=await page.evaluate(()=>{
      const left=s=>document.querySelector(s).getBoundingClientRect().left;
      return {brand:left('.music-identity'),toggle:left('.music-view-toggle'),overview:parseFloat(getComputedStyle(document.querySelector('.overview-heading')).left)};
    });
    assert.ok(Math.abs(geometry.brand-geometry.toggle)<1,JSON.stringify({viewport,geometry}));
    assert.ok(Math.abs(geometry.brand-geometry.overview)<1,JSON.stringify({viewport,geometry}));
    const iconCenters=await page.locator('.music-topnav > .icon-button:visible').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};}));
    assert.ok(Math.max(...iconCenters.map(p=>p.y))-Math.min(...iconCenters.map(p=>p.y))<1,'Header icons share a center line');
    const distances=iconCenters.slice(1).map((p,i)=>p.x-iconCenters[i].x);
    assert.ok(Math.max(...distances)-Math.min(...distances)<1,'Header navigation icons have equal spacing');
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
        return {title:box('#album-detail-content > h1'),artist:box('.detail-artist'),play:box('#song-toggle-stop'),add:box('.song-add-playlist'),tabs:box('.song-view-tabs'),heading:box('.song-view-heading'),firstTab:box('#song-tab-info'),font:getComputedStyle(document.querySelector('#album-detail-content > h1')).fontSize};
      });
      assert.ok(geometry.play.right+4<=geometry.add.left,'Playback and add button must not overlap');
      assert.ok(geometry.add.bottom<=geometry.tabs.top,'Actions precede tabs');
      const gaps=[geometry.artist.top-geometry.title.bottom,geometry.heading.top-geometry.artist.bottom,geometry.tabs.top-geometry.heading.bottom];
      assert.ok(Math.max(...gaps)-Math.min(...gaps)<1,`Equal detail row gaps: ${JSON.stringify(gaps)}`);
      const icons=await page.evaluate(()=>[...document.querySelectorAll('.music-topnav svg')].filter(n=>{const b=n.getBoundingClientRect();return b.width&&b.height&&getComputedStyle(n.parentElement).opacity!=='0'&&!n.closest('.mini-playback-below')}).map(n=>{const b=n.getBoundingClientRect();return {id:n.closest('button')?.id||n.closest('button')?.dataset.action,center:b.top+b.height/2}}));
      assert.ok(Math.max(...icons.map(n=>n.center))-Math.min(...icons.map(n=>n.center))<1,`Icon centers: ${JSON.stringify(icons)}`);
      geometry.gaps=gaps;geometry.icons=icons;
      tabs.push(geometry);
      await page.screenshot({path:`${output}/detail-${viewport.width}-${tab}.png`});
    }
    for(const item of tabs.slice(1)) {assert.equal(item.font,tabs[0].font);assert.equal(item.title.height,tabs[0].title.height);assert.equal(item.title.y,tabs[0].title.y);}
    report.sizes.push({viewport,geometry,tabs});
    await page.locator('.music-back').click(); await page.waitForTimeout(1000);
  }
  await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(300);
  // Real wheel events and per-frame observations catch a one-frame old-title return.
  await page.evaluate(()=>{window.titleFrames=[];window.captureTitles=true;const frame=()=>{if(!window.captureTitles)return;const n=document.querySelector('#selection-title');window.titleFrames.push({title:n.getAttribute('aria-label'),rapid:document.querySelector('.music-title-rapid').hidden,faces:[...n.querySelectorAll('.music-title-face')].filter(n=>{const b=n.getBoundingClientRect(),s=n.closest('.music-title-slot').getBoundingClientRect();return getComputedStyle(n.closest('.music-title-slot')).visibility!=='hidden'&&b.top>=s.top-1&&b.top<s.bottom-1;}).map(n=>n.textContent).join(''),counterTop:document.querySelector('#selection-number').getBoundingClientRect().top,numberAnimation:document.querySelector('#selection-code-number').getAnimations({subtree:true}).length});requestAnimationFrame(frame);};frame();});
  await page.mouse.move(400,400);
  for(let i=0;i<6;i++){await page.mouse.wheel(0,120);await page.waitForTimeout(120);}
  await page.waitForTimeout(1100);
  const frames=await page.evaluate(()=>{window.captureTitles=false;return window.titleFrames;});
  assert.ok(new Set(frames.map(f=>f.title)).size>2,'Real wheel changes selection');
  assert.ok(frames.some(f=>f.numberAnimation>0),'SONG number has a live rolling animation');
  assert.ok(Math.max(...frames.map(f=>f.counterTop))-Math.min(...frames.map(f=>f.counterTop))<1,'Counter position stays fixed throughout the animation');
  for(const f of frames)if(f.rapid&&f.title&&f.faces)assert.equal(f.faces,f.title,'Every painted settled title matches the current selection');
  report.wheel=frames;
  for(const number of [18,20]) {
    await page.locator('[data-song-bar="'+(number-1)+'"]').dispatchEvent('click');
    await page.waitForTimeout(650);
    await page.screenshot({path:output+'/number-'+number+'.png'});
  }
  await page.locator('#selection-genre').click();
  await page.locator('[aria-label="歌单歌曲列表"]').waitFor({state:'visible'});
  assert.equal(await page.locator('.playlist-detail-tools').count(),0);
  assert.ok(await page.locator('[data-playlist-detail-track]').count()<40,'Full playlist keeps a bounded visible row pool');
  await page.locator('#album-detail-content').evaluate(n=>n.scrollTop=n.scrollHeight);
  await page.locator('[data-playlist-detail-track="119"]:not([disabled])').waitFor();
  report.continuousPlaylist=true;
  await page.locator('#album-detail-content').evaluate(n=>n.scrollTop=0);
  await page.screenshot({path:`${output}/playlist-detail.png`});
  await page.locator('.music-back').click();await page.waitForTimeout(1000);
  await page.locator('.music-view-toggle').click();await page.waitForTimeout(1500);
  await page.screenshot({path:`${output}/overview.png`});
  const stopRecording=await recordTransition();
  const openedAt=Date.now();
  await page.locator('[data-overview-playlist-open]').filter({hasText:'合成歌单'}).first().click();
  await page.locator('[aria-label="歌单歌曲列表"]').waitFor({state:'visible'});
  assert.ok((await page.locator('#album-detail-content > h1').textContent()).includes('合成歌单'));
  report.overviewOpenMs=await page.evaluate(()=>performance.now()-window.qaActionAt);
  assert.ok(report.overviewOpenMs<2400,`Overview opens promptly: ${report.overviewOpenMs}ms`);
  // Opening a playlist must keep the mini player visible, and the early header
  // mask may finish once but must not restart when extraction settles.
  assert.equal(await page.locator('#mini-playback-below').isVisible(),true);
  assert.ok(await page.locator('.playlist-continuous-row .document-redaction-window').count()>0,'Playlist rows participate in the entrance mask');
  assert.equal(await page.locator('#music-overview').isVisible(),false,'Outgoing overview controls cannot overlap the incoming playlist');
  const header = await page.locator('#album-detail-content > h1').elementHandle();
  await page.waitForTimeout(1800);
  assert.equal(await header.evaluate(n=>n.isConnected),true,'Metadata refresh retains the revealed header');
  assert.equal(await page.locator('#album-detail-content > h1 .document-redaction-window').count(),0);
  await stopRecording();
  await page.locator('.music-topnav').screenshot({path:`${output}/statusbar-playlist.png`});
  report.repeatedPlaylistOpen=[];
  for(let cycle=0;cycle<3;cycle++) {
    await page.locator('.music-back').click();await page.waitForTimeout(1300);
    await page.locator('.music-view-toggle').click();await page.waitForTimeout(1100);
    if(cycle===2)await page.evaluate(()=>{
      window.qaOriginalRAF=requestAnimationFrame;window.qaOriginalCancelRAF=cancelAnimationFrame;
      window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),100);
      window.cancelAnimationFrame=id=>clearTimeout(id);
    });
    await page.evaluate(()=>{window.miniHiddenFrames=0;window.watchMini=true;const f=()=>{if(!window.watchMini)return;if(document.querySelector('#mini-playback-below').hidden)window.miniHiddenFrames++;requestAnimationFrame(f);};f();});
    const at=Date.now();await page.locator('[data-overview-playlist-open]').filter({hasText:'合成歌单'}).first().click();
    await page.locator('[aria-label="歌单歌曲列表"]').waitFor({state:'visible'});
    const elapsed=await page.evaluate(()=>window.qaPlaylistFrameMs ?? performance.now()-window.qaActionAt);assert.ok(elapsed<2400,`Playlist entrance ${elapsed}ms`);
    // A slow frame must not stretch the text-mask timeline.
    await page.locator('#album-detail-content > h1 .document-redaction-window').waitFor({state:'detached', timeout:2500});
    assert.equal(await page.evaluate(()=>{window.watchMini=false;return window.miniHiddenFrames;}),0,'Mini lyrics stay continuous across archive/overview/playlist');
    report.repeatedPlaylistOpen.push(elapsed);
    if(cycle===2){
      report.lowFrameMaskComplete=true;
      await page.evaluate(()=>{window.requestAnimationFrame=window.qaOriginalRAF;window.cancelAnimationFrame=window.qaOriginalCancelRAF;});
    }
  }
  await page.locator('.music-back').click();await page.waitForTimeout(1300);
  await page.locator('.music-view-toggle').click();await page.waitForTimeout(1100);
  const delayedAt=Date.now();
  await page.locator('[data-overview-playlist-open]').filter({hasText:'延迟歌单'}).first().click();
  await page.locator('[aria-label="歌单歌曲列表"]').waitFor({state:'visible'});
  report.delayedPlaylistShellMs=await page.evaluate(()=>window.qaPlaylistFrameMs ?? performance.now()-window.qaActionAt);
  assert.ok(report.delayedPlaylistShellMs<2400,'Playlist shell does not wait for the network');
  const delayedHeader=await page.locator('#album-detail-content > h1').elementHandle();
  assert.ok(await page.locator('#album-detail-content > h1 .document-redaction-window').count()>0,'Mask starts with initial zoom');
  assert.equal(await page.locator('[data-playlist-detail-track]:disabled').count(),12);
  await page.screenshot({path:`${output}/playlist-entering.png`});
  await page.waitForTimeout(1600);
  assert.equal(await page.locator('#album-detail-content > h1 .document-redaction-window').count(),0);
  releaseDelayed();
  await page.locator('[data-playlist-detail-track="0"]:enabled').waitFor();
  await page.waitForTimeout(400);
  assert.equal(await delayedHeader.evaluate(n=>n.isConnected),true);
  assert.equal(await page.locator('#album-detail-content > h1 .document-redaction-window').count(),0,'Loaded tracks do not restart the mask');
  assert.equal(await page.locator('[data-action^="playlist-detail-"]').count(),0,'Single-page playlists have no paging controls');
  await page.screenshot({path:`${output}/playlist-loaded.png`});
  report.delayedPlaylistMaskOnce=true;
  await page.locator('[data-action="settings"]').first().click();
  const categories=await page.locator('[data-category]').evaluateAll(ns=>ns.map(n=>n.dataset.category));
  report.settingsCategories=categories;
  for(const category of categories) {
    await page.locator(`[data-category="${category}"]`).click();
    assert.equal(await page.locator('.settings-page:visible').count(),1);
    assert.ok(await page.locator(`.settings-page[data-settings-page="${category}"] .panel-section`).count()>0);
    await page.screenshot({path:`${output}/settings-${category}.png`});
  }
  if(desktop) {
    await page.locator('[data-category="desktop"]').click();
    await page.locator('#taskbar-lyrics-enabled').uncheck();
    const lyric=browser.contexts()[0].pages().find(p=>p.url().includes('taskbar=1'));
    assert.ok(lyric);
    await page.waitForTimeout(600);
    assert.equal(await lyric.evaluate(()=>window.__TAURI__.window.getCurrentWindow().isVisible()),false);
    await page.locator('[data-action="restore-taskbar-lyrics"]').click();
    await page.waitForTimeout(600);
    assert.equal(await lyric.evaluate(()=>window.__TAURI__.window.getCurrentWindow().isVisible()),true);
    await lyric.waitForFunction(async()=>Math.abs(innerHeight*devicePixelRatio-(await window.__TAURI__.window.getCurrentWindow().innerSize()).height)<2 && innerHeight>=24);
    const lyricLayout=await lyric.evaluate(()=>({height:innerHeight,bottom:document.querySelector('[data-current]').getBoundingClientRect().bottom}));
    assert.ok(lyricLayout.bottom<=lyricLayout.height,JSON.stringify(lyricLayout));
    assert.equal(await page.locator('#taskbar-lyrics-enabled').isChecked(),true);
    await page.evaluate(()=>window.__TAURI__.core.invoke('desktop_tray_action',{action:'controls'}));
    const tray=browser.contexts()[0].pages().find(p=>p.url().includes('tray=1'));
    await page.waitForTimeout(800);
    const bounds=await tray.evaluate(async()=>({position:await window.__TAURI__.window.getCurrentWindow().outerPosition(),size:await window.__TAURI__.window.getCurrentWindow().outerSize(),screen:{w:screen.width*devicePixelRatio,h:screen.availHeight*devicePixelRatio},title:document.querySelector('[data-title]').textContent}));
    assert.ok(bounds.position.x>0 && bounds.position.y>0,JSON.stringify(bounds));
    assert.ok(bounds.position.x+bounds.size.width<=bounds.screen.w+1 && bounds.position.y+bounds.size.height<=bounds.screen.h+1,JSON.stringify(bounds));
    assert.match(bounds.title,/合成曲目/);report.trayPopup=bounds;
    assert.equal(await tray.evaluate(()=>Math.round(innerHeight*devicePixelRatio)),bounds.size.height,'Tray WebView fills native client area');
    await tray.screenshot({path:`${output}/tray-controls.png`});
    const beforeToggle=await tray.locator('[data-toggle]').getAttribute('aria-label');
    await tray.locator('[data-tray-action="toggle"]').click();
    await tray.waitForFunction(before=>document.querySelector('[data-toggle]').getAttribute('aria-label')!==before,beforeToggle);
    await tray.locator('[data-tray-action="toggle"]').click();
    await tray.waitForFunction(before=>document.querySelector('[data-toggle]').getAttribute('aria-label')===before,beforeToggle);
    await tray.evaluate(()=>window.__TAURI__.core.invoke('desktop_tray_action',{action:'hide'}));
  }
  await page.locator('[data-category="appearance"]').click();
  const follow=page.locator('#follow-system-theme');
  await follow.check();assert.equal(await page.locator('[data-theme]:disabled').count(),2);
  await follow.uncheck();assert.equal(await page.locator('[data-theme]:disabled').count(),0);
  assert.equal(await page.locator('.theme-follow-system').evaluate(n=>getComputedStyle(n).borderBottomWidth),'0px');
  const mask=page.locator('#page-text-mask');
  assert.equal(await mask.isChecked(),true);
  await mask.uncheck();
  assert.equal(await page.locator('.music-app').evaluate(n=>n.classList.contains('no-text-masks')),true);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rhine-music-preferences')).pageTextMask),false);
  await page.screenshot({path:`${output}/settings-appearance.png`});
  await page.locator('[data-category="appearance"]').click();
  await page.locator('[data-action="replay-boot"]').click();
  await page.locator('.rhine-loading').waitFor({state:'visible'});
  await page.waitForFunction(()=>Number(document.querySelector('.rhine-loading .opening-stage')?.dataset.bootFrame)>=330);
  await page.screenshot({path:`${output}/manual-full-opening.png`});
  await page.locator('.opening-skip').click();
  await page.locator('.music-boot-skip').waitFor({state:'visible'});
  await page.locator('.music-boot-skip').click();
  await page.waitForFunction(()=>document.querySelector('.music-app').dataset.musicBoot==='done');
  report.manualFullOpening=true;
  const beforeSearch = await page.evaluate(()=>({id:window.rhineMusic.selectedAlbum?.id,title:document.querySelector('#album-detail-content > h1')?.textContent}));
  await page.locator('[data-action="search"]').first().click();
  await page.locator('[data-search-source="network"]').click();
  await page.locator('#online-search').fill('fixture');await page.locator('#online-search').press('Enter');
  await page.locator('[data-online-track="netease-9000"]').click();
  await page.waitForFunction(()=>window.rhineMusic.player.currentTrack?.id==='netease-9000' && document.querySelector('#song-view') && document.querySelector('#music-detail')?.getAttribute('aria-hidden')==='false');
  assert.ok((await page.locator('#album-detail-content > h1').textContent()).includes('搜索独立曲目 1'));
  await page.waitForFunction(()=>window.rhineMusic.presentation.cameraReady);
  await page.screenshot({path:output+'/search-playing-detail.png'});
  await page.locator('.music-back').click(); await page.waitForTimeout(1300);
  assert.equal(await page.evaluate(()=>window.rhineMusic.selectedAlbum?.id),beforeSearch.id,'Search back restores the previous shelf selection');
  report.searchReturn=true;
  await page.locator('#transport-track').click();
  await page.waitForFunction(()=>document.querySelector('#album-detail-content > h1')?.textContent.includes('搜索独立曲目 1') && document.querySelector('#music-detail')?.getAttribute('aria-hidden')==='false');
  await page.locator('[data-action="search"]').first().click();
  await page.locator('[data-online-track="netease-9001"]').click();
  await page.waitForFunction(()=>window.rhineMusic.player.currentTrack?.id==='netease-9001' && document.querySelector('#album-detail-content > h1')?.textContent.includes('搜索独立曲目 2'));
  await page.waitForFunction(()=>window.rhineMusic.presentation.cameraReady);
  await page.locator('#transport-track').click();
  await page.waitForFunction(()=>window.rhineMusic.presentation.cameraReady && document.querySelector('#album-detail-content > h1')?.textContent.includes('搜索独立曲目 2'));
  report.searchPlayingDetail=true;
  await page.locator('#netease-login-button').click();
  await page.locator('[data-login-provider="qq"]').click();
  await page.locator('[data-qq-login-method]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-login-provider="qq"]').getAttribute('aria-selected'),'true');
  await page.locator('[data-qq-login-method]').selectOption('wechat');
  await page.screenshot({path:`${output}/qq-login.png`});
  report.qqLoginEntry=true;
  await page.locator('[data-action="close-panel"]').click();
  report.performance=await page.evaluate(()=>({frame:JSON.parse(document.querySelector('#three-scene').dataset.frameTiming||'{}'),stats:window.rhineMusic.stats()}));
  assert.deepEqual(errors,[]);
  if(desktop) {
    const closePreference=await page.evaluate(()=>window.__TAURI__.core.invoke('desktop_close_preference'));
    try {
      await page.evaluate(()=>window.__TAURI__.core.invoke('desktop_close_decision',{behavior:'tray',remember:false}));
      assert.equal(await page.evaluate(()=>window.__TAURI__.window.getCurrentWindow().isVisible()),false);
      await page.evaluate(()=>window.__TAURI__.core.invoke('desktop_tray_action',{action:'show'}));
      assert.equal(await page.evaluate(()=>window.__TAURI__.window.getCurrentWindow().isVisible()),true);
    } finally {
      await page.evaluate(behavior=>window.__TAURI__.core.invoke('desktop_set_close_preference',{behavior:behavior||'ask'}),closePreference);
    }
    report.trayHideRestore=true;
  }
  report.runtimeChecked=true;report.playlistEntrances=true;report.errors=errors;
  await fs.writeFile(`${output}/results.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,sizes:report.sizes.length,wheelFrames:frames.length,playlistEntrances:true}));
} catch(error) {await page.screenshot({path:`${output}/failure.png`});console.error(errors);console.error(await page.evaluate(()=>({stage:document.querySelector('.music-app')?.dataset,stats:window.rhineMusic?.stats(),presentation:window.rhineMusic?.presentation?.phase})));throw error;}
finally {releaseDelayed();await browser.close();await server?.close();child?.kill();}
