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
 const source=texts.map((text,i)=>i===0?'[0,5400](0,500,0)夜(500,500,0)色(1000,500,0)渐(1500,500,0)渐(2000,500,0)落(2500,500,0)在(3000,600,0)窗(3600,1800,0)前':'['+(i*6000)+',5400]'+Array.from(text).map((word,j,all)=>'('+(i*6000+Math.floor(j*5400/all.length))+','+Math.floor(5400/all.length)+',0)'+word).join('')).join(String.fromCharCode(10));
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
  browser = await chromium.launch({ executablePath: process.env.RHINE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--mute-audio', '--no-proxy-server'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 }, recordVideo: { dir: output, size: { width: 1100, height: 850 } } });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.goto(server.resolvedUrls.local[0] + output + '/index.html', {waitUntil: 'domcontentloaded', timeout: 90000});
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
  await page.evaluate(() => window.advance(.1));
  const wordMotion = await page.evaluate(async () => {
    const samples = [], start = performance.now();
    while (performance.now() - start < 7000) {
      const root = document.querySelector('.amll-lyric-player');
      const animated = root.getAnimations({subtree:true});
      samples.push({
        y: root.querySelector('[class*="lyricLineWrapper"]').getBoundingClientRect().top,
        animations: animated.map(a => ({id:a.id, time:Math.round(Number(a.currentTime)), state:a.playState,
          transform:getComputedStyle(a.effect.target).transform, shadow:getComputedStyle(a.effect.target).textShadow})),
      });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return samples;
  });
  const running = wordMotion.flatMap(sample => sample.animations).filter(a => a.state === 'running');
  await fs.writeFile(`${output}/motion-samples.json`, JSON.stringify({wordMotion},null,2));
  assert.ok(running.some(a => /emphasize/.test(a.id)), 'long syllables play upstream emphasis animations');
  assert.ok(new Set(running.map(a => a.transform)).size > 5, 'word transforms actually change during playback');
  assert.ok(new Set(wordMotion.map(sample => Math.round(sample.y))).size > 5, 'YRC line transitions include intermediate spring positions');
  await fs.writeFile(`${output}/motion-samples.json`, JSON.stringify({wordMotion},null,2));
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
  assert.equal(await page.locator('.amll-lyric-player').count(), 1);
  assert.equal(await page.evaluate(() => view.amll.player.isNonDynamic), true, 'LRC keeps the line animation without invented word timings');
  await page.evaluate(() => { window.reduced = false; document.querySelector('.music-app').dataset.theme = 'night'; window.advance(4.7); });
  const lineMotion = await page.evaluate(async () => {
    const samples = [];
    const start = performance.now();
    while (performance.now() - start < 2400) {
      const lines = [...document.querySelectorAll('[class*="lyricLineWrapper"]')].slice(0, 3);
      samples.push(lines.map(line => ({y: line.getBoundingClientRect().top, transform: getComputedStyle(line).transform, blur: getComputedStyle(line).filter})));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return samples;
  });
  assert.ok(new Set(lineMotion.map(frame => Math.round(frame[1]?.y))).size > 5, 'LRC moves through intermediate spring positions across a real line boundary');
  assert.ok(lineMotion.some(frame => frame.some(line => /blur\((?!0px)/.test(line.blur))), 'distant lines retain blur hierarchy');
  await page.screenshot({path: `${output}/lines-night.png`});
  await page.evaluate(() => { document.querySelector('.music-app').dataset.theme = 'day'; window.advance(7.5, false); });
  await page.waitForTimeout(1300);
  assert.equal(await page.locator('.amll-lyric-player').evaluate(node => getComputedStyle(node).mixBlendMode), 'normal', 'dark ink remains visible in light theme');
  await page.screenshot({path: `${output}/lines-day.png`});
  await page.evaluate(() => view.dispose());
  assert.deepEqual(errors, []);
  const report = { activeUpdatesIn700ms: frames, pausedUpdatesIn400ms: 0, hiddenUpdatesIn400ms: 0, seekSeconds: 12, wordTransformSamples: new Set(running.map(a => a.transform)).size, yrcSpringPositions: new Set(wordMotion.map(sample => Math.round(sample.y))).size, lrcSpringPositions: new Set(lineMotion.map(frame => Math.round(frame[1]?.y))).size, syntheticData: true, runtime: 'Edge browser', checks: ['YRC emphasis and springs', 'LRC springs and blur', 'seek', 'both themes', 'pause', 'hidden', 'tab', 'reduced motion', 'dispose'] };
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  const video = page.video();
  await context.close();
  if (video) { await video.saveAs(`${output}/word-lyrics.webm`); await video.delete(); }
} finally { await browser?.close(); await server?.close(); }
