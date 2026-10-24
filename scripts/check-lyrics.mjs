import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseLyricDocument, parseLyrics, lyricIndex } from '../src/music-lyrics.ts';

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

