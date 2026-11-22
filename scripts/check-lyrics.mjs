import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseLyricDocument, parseLyrics, lyricIndex, untimedLyrics } from '../src/music-lyrics.ts';

globalThis.DOMParser = DOMParser;

test('LRC documents keep translations and legacy compatibility', () => {
  const document = parseLyricDocument({ original: '[00:01.00]Hello', translated: '[00:01.00]你好' });
  assert.equal(document.sourceFormat, 'lrc');
  assert.equal(document.lines[0].words[0].word, 'Hello');
  assert.equal(document.lines[0].translatedLyric, '你好');
  assert.deepEqual(parseLyrics('[00:01.00]Hello', '[00:01.00]你好'), [{ time: 1, text: 'Hello', translation: '你好' }]);
});

test('QRC and YRC documents retain word timing', () => {
  const qrc = parseLyricDocument({ qrc: '[0,1000]hel(0,500)lo(500,500)' });
  assert.equal(qrc.sourceFormat, 'qrc');
  assert.equal(qrc.hasWordTiming, true);
  assert.deepEqual(qrc.lines[0].words.map(word => [word.word, word.startTime, word.endTime]), [['hel', 0, 500], ['lo', 500, 1000]]);
  const yrc = parseLyricDocument({ yrc: '[1000,1000](1000,500,0)你(1500,500,0)好' });
  assert.equal(yrc.sourceFormat, 'yrc');
  assert.equal(yrc.lines[0].words.length, 2);
  assert.equal(yrc.lines[0].words[1].word, '好');
});

test('TTML and offset normalization produce a stable document', () => {
  const ttml = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="3s">Hello</p></div></body></tt>`;
  const document = parseLyricDocument({ ttml, offset: 0.5 });
  assert.equal(document.sourceFormat, 'ttml');
  assert.equal(document.lines[0].startTime, 500);
  assert.equal(lyricIndex([{ time: 0, text: 'a' }, { time: 1, text: 'b' }], 1.1), 1);
});

test('generic TTML keeps explicit word timing and ignores translation spans', () => {
  const ttml = `<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="2s" end="5s"><span begin="2s" end="3s">Good</span><span begin="3s" end="5s">bye</span><span ttm:role="x-translation" xmlns:ttm="urn:example">再见</span></p></body></tt>`;
  const document = parseLyricDocument({ ttml });
  assert.equal(document.lines.length, 1);
  assert.deepEqual(document.lines[0].words.map(word => [word.word, word.startTime, word.endTime]), [['Good', 2000, 3000], ['bye', 3000, 5000]]);
  assert.equal(document.hasWordTiming, true);
});

test('malformed TTML returns an unavailable empty document without throwing', () => {
  const document = parseLyricDocument({ ttml: '<tt><body><p begin="broken">oops' });
  assert.equal(document.lines.length, 0);
  assert.equal(document.sourceFormat, 'ttml');
});

test('instrumental and unavailable states do not fabricate lyric lines', () => {
  const document = parseLyricDocument({ instrumental: true, unavailable: true });
  assert.equal(document.lines.length, 0);
  assert.equal(document.instrumental, true);
  assert.equal(document.unavailable, true);
});

test('invalid enhanced lyrics fall back to a valid line document', () => {
  const document = parseLyricDocument({ yrc: 'broken', original: '[00:02]仍然可以显示', translated: '[00:02]Still readable' });
  assert.equal(document.sourceFormat, 'lrc');
  assert.equal(document.hasWordTiming, false);
  assert.equal(document.lines[0].translatedLyric, 'Still readable');
});

test('enhanced translation follows the word-timed line rather than the older LRC stamp', () => {
  const document = parseLyricDocument({ yrc: '[1200,1000](1200,500,0)你(1700,500,0)好', translated: '[00:01]old', ytranslated: '[00:01.2]Hello' });
  assert.equal(document.lines[0].translatedLyric, 'Hello');
});


test('NetEase credit records stay out of all lyric surfaces', () => {
  const credit = JSON.stringify({t:214504,c:[{tx:'和声编录: '},{tx:'测试歌手',li:'unused'}]});
  const original = '[00:01]主唱\n' + credit;
  const doc = parseLyricDocument({original, yrc:credit});
  assert.deepEqual(doc.credits,['和声编录: 测试歌手']);
  assert.deepEqual(doc.lines.map(l=>l.words.map(w=>w.word).join('')),['主唱']);
  assert.equal(untimedLyrics(original),'主唱');
  assert.equal(untimedLyrics(credit),'');
});

test('duet labels select a side and retain the original syllable clock across a handoff', () => {
  const yrc = '[0,100](0,100,0)【甲方】\n[100,900](100,500,0)唱(600,400,0)句\n[1000,700](1000,100,0)【甲方】(1100,200,0)前(1300,20,0)【乙(1320,20,0)方】(1340,360,0)后\n[1700,300](1700,300,0)【合】齐唱';
  const doc = parseLyricDocument({yrc},'乙方 / 甲方');
  assert.deepEqual(doc.lines.map(l=>[l.words.map(w=>w.word).join(''),l.startTime,l.isDuet]),[
    ['唱句',100,false],['前',1100,false],['后',1340,true],['齐唱',1700,false]
  ]);
  const shared = '【甲方】前 【乙方】后';
  assert.equal(parseLyricDocument({original:'[00:01]'+shared},'甲方 / 乙方').lines[0].words[0].word,shared);
  assert.equal(parseLyricDocument({original:'[00:01]【序章】'},'甲方 / 乙方').lines[0].words[0].word,'【序章】');
});

test('generic TTML preserves backing voices and their lead singer alignment', () => {
  const ttml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p ttm:agent="a" begin="1s" end="2s">One</p><p ttm:agent="b" begin="3s" end="6s">Two<span ttm:role="x-bg"><span begin="4s" end="5s">Echo</span></span></p></body></tt>';
  const doc = parseLyricDocument({ttml,original:'[00:01]One'});
  assert.deepEqual(doc.lines.map(l=>[l.words[0].word,l.startTime,l.isDuet,l.isBG]),[
    ['One',1000,false,false],['Two',3000,true,false],['Echo',4000,true,true]
  ]);
});
