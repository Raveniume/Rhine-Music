import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = 'artifacts/word-lyrics';
await fs.mkdir(output, { recursive: true });
await fs.writeFile(`${output}/index.html`, `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;width:100%;height:100%}.music-app{position:relative!important;width:100vw;height:100vh;background:var(--page-bg)!important}.music-detail{left:0!important}#mini{display:none}#album-detail-content{left:12%!important;width:76%!important;top:60px!important;height:calc(100% - 100px)!important}</style>
<main class="music-app" data-layout="desktop" data-theme="night"><section class="music-detail"><article id="album-detail-content"></article></section><div id="mini"><span data-mini-lyric></span></div></main>
<script type="module">
import '/src/style.css';import '/src/music.css';import '/src/music-theme.css';import '/src/music-song-view.css';
import {MusicSongView} from '/src/music-song-view.ts';
import {parseLyricDocument,lyricDocumentToLegacyLines} from '/src/music-lyrics.ts';
const texts=['夜色渐渐落在窗前','风带着旋律经过身边','这一刻让音乐慢慢流动','把每个字唱给你听','The light is falling softly','让下一句接住此刻'];
window.reduced=false;window.seeks=[];
window.track={id:'word-test',title:'逐字歌词',artist:'Rhine Music · 显示测试',duration:180,onlineSource:{provider:'netease',id:'123'}};
window.state={currentTrack:track,currentTime:0,duration:180,transport:'playing',playing:true,loading:false,playbackMode:'sequential'};
const album={id:'test',title:track.title,artist:track.artist,tracks:[track]};
window.view=new MusicSongView(document.querySelector('#mini'),t=>window.seeks.push(t),()=>window.reduced);
window.replaceLyrics=(enhanced=true)=>{
 const source=texts.map((text,i)=>'['+(i*6000)+',5400]'+Array.from(text).map((word,j,all)=>'('+(i*6000+Math.floor(j*5400/all.length))+','+Math.floor(5400/all.length)+',0)'+word).join('')).join(String.fromCharCode(10));
 const original=texts.map((text,i)=>'[00:'+String(i*6).padStart(2,'0')+']'+text).join(String.fromCharCode(10));
 const lyrics=enhanced?{original,yrc:source}:{original};const document=parseLyricDocument(lyrics);
 view.cache.set('netease:123',{at:Date.now(),lyricAt:Date.now(),document,lines:lyricDocumentToLegacyLines(document),info:{track,album:{title:'显示测试'},lyrics}});
};
window.replaceLyrics();
document.querySelector('#album-detail-content').innerHTML='<div class="detail-overline">MUSIC ARCHIVE / 歌词显示</div><h1>逐字歌词</h1><p class="detail-artist">Rhine Music · 显示测试</p>'+view.markup(album);
view.mount(album,state,true);view.setVisible(true);view.update(state,true);
window.advance=(time,playing=true)=>{state={...state,currentTime:time,playing,transport:playing?'playing':'paused'};view.update(state,true);};
</script>`);
let server, browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' }); await server.listen();
  browser = await chromium.launch({ executablePath: process.env.RHINE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 }, recordVideo: { dir: output, size: { width: 1100, height: 850 } } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.goto(server.resolvedUrls.local[0] + output + '/index.html');
  await page.waitForSelector('#song-lyrics[data-engine="amll"]');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.amll-lyric-player').count(), 1);
  const style = await page.locator('.amll-lyric-player').evaluate(node => ({ font: parseFloat(getComputedStyle(node).fontSize), height: node.clientHeight, parent: node.parentElement.clientHeight }));
  assert.ok(style.font >= 20 && style.font <= 32, JSON.stringify(style));
  assert.ok(style.height > 250 && style.height <= style.parent + 1, 'word viewport fills lyric area');
  const engine = await page.evaluate(() => ({
    blend: getComputedStyle(document.querySelector('.amll-lyric-player')).mixBlendMode,
    gradientLines: document.querySelectorAll('.FmKaba_gradientMask').length,
    wordBodies: document.querySelectorAll('.FmKaba_emphasizeWrapper, .FmKaba_wordBody').length,
    interludeDots: document.querySelectorAll('.FmKaba_interludeDots').length,
  }));
  assert.equal(engine.blend, 'plus-lighter');
  assert.ok(engine.gradientLines > 0, 'AMLL gradient mask is active on the current line');
  assert.ok(engine.wordBodies > 0, 'AMLL word-level DOM is present');
  await page.evaluate(() => {
    window.updateCount = 0;
    const player = view.amll.player, update = player.update.bind(player);
    player.update = delta => { window.updateCount++; return update(delta); };
    window.advance(12.5);
  });
  await page.waitForTimeout(700);
  const frames = await page.evaluate(() => window.updateCount);
  assert.ok(frames > 5 && frames < 55, `bounded active frames: ${frames}`);
  await page.screenshot({ path: `${output}/words-night.png` });
  await page.evaluate(() => window.advance(14, false));
  await page.waitForTimeout(1600);
  const paused = await page.evaluate(() => window.updateCount);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.updateCount), paused, 'paused renderer reaches zero idle updates');
  await page.locator('.amll-lyric-player').getByText('这一刻让音乐慢慢流动', { exact: true }).click({ force: true }).catch(async () => {
    const line = page.locator('.amll-lyric-player [class*="lyricMainLine"]').filter({ hasText: '这一刻让音乐慢慢流动' });
    await line.click({ force: true });
  });
  assert.equal(await page.evaluate(() => window.seeks.at(-1)), 12, 'clicking a timed line seeks');
  await page.evaluate(() => { window.advance(19); window.dispatchEvent(new CustomEvent('rhine-desktop-visibility', { detail: { hidden: true } })); });
  const hidden = await page.evaluate(() => window.updateCount);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.updateCount), hidden, 'desktop-hidden lyrics do no rendering work');
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('rhine-desktop-visibility', { detail: { hidden: false } })); window.advance(6.5); });
  await page.waitForTimeout(450);
  assert.ok(await page.evaluate(() => window.updateCount) > hidden);
  await page.locator('#song-tab-info').click();
  const tab = await page.evaluate(() => window.updateCount);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.updateCount), tab, 'other tabs suspend the lyric loop');
  await page.locator('#song-tab-lyrics').click();
  await page.evaluate(() => { document.querySelector('.music-app').dataset.theme = 'day'; window.advance(13, false); });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${output}/words-day.png` });
  await page.evaluate(() => { window.reduced = true; window.advance(20); });
  assert.equal(await page.evaluate(() => view.amll.player.getEnableSpring()), false);
  assert.equal(await page.evaluate(() => view.amll.player.getEnableScale()), false);
  await page.evaluate(() => { window.replaceLyrics(false); window.advance(6, false); });
  assert.equal(await page.locator('.amll-lyric-player').count(), 0);
  assert.equal(await page.locator('.lyric-line').count(), 6, 'ordinary lyrics remain available after word lyrics');
  await page.evaluate(() => view.dispose());
  assert.deepEqual(errors, []);
  const report = { activeUpdatesIn700ms: frames, pausedUpdatesIn400ms: 0, hiddenUpdatesIn400ms: 0, seekSeconds: 12, syntheticData: true, runtime: 'Edge browser', checks: ['YRC', 'fallback', 'seek', 'both themes', 'pause', 'hidden', 'tab', 'reduced motion', 'dispose'] };
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  const video = page.video();
  await context.close();
  if (video) { await video.saveAs(`${output}/word-lyrics.webm`); await video.delete(); }
} finally { await browser?.close(); await server?.close(); }
