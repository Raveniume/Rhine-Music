import {
  parseLrcLike,
  parseQrc,
  parseTTML,
  parseYrc,
  type LyricLine as AmllLyricLine,
} from "@applemusic-like-lyrics/lyric";

export interface LyricLine { time: number; text: string; translation?: string }

export type LyricSourceFormat = "lrc" | "qrc" | "yrc" | "ttml" | "plain";

export interface LyricDocument {
  lines: AmllLyricLine[];
  credits: string[];
  sourceFormat: LyricSourceFormat;
  offset: number;
  original: string;
  translated: string;
  romanized: string;
  hasWordTiming: boolean;
  instrumental: boolean;
  unavailable: boolean;
}

type LyricPayload = {
  original?: string;
  translated?: string;
  qrc?: string;
  yrc?: string;
  ytranslated?: string;
  ttml?: string;
  romanized?: string;
  yromanized?: string;
  offset?: number;
  instrumental?: boolean;
  unavailable?: boolean;
};

const finite = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const cloneLine = (line: AmllLyricLine): AmllLyricLine => ({
  ...line,
  // The parser package exposes the common lyric word shape.  Keep the clone
  // deliberately structural so it also accepts core-only fields when a
  // TTML parser provides them at runtime.
  words: line.words.map(word => ({ ...word })),
});

const ttmlTime = (value: string | null, fallback = 0) => {
  const raw = value?.trim();
  if (!raw) return fallback;
  if (raw.endsWith("s")) {
    const seconds = Number(raw.slice(0, -1));
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : fallback;
  }
  const parts = raw.split(":");
  const numbers = parts.map(Number);
  if (numbers.some(number => !Number.isFinite(number))) return fallback;
  if (numbers.length === 3) return Math.round((numbers[0] * 3600 + numbers[1] * 60 + numbers[2]) * 1000);
  if (numbers.length === 2) return Math.round((numbers[0] * 60 + numbers[1]) * 1000);
  return numbers.length === 1 ? Math.round(numbers[0] * 1000) : fallback;
};

const elementName = (element: Element) => (element.localName || element.tagName.split(":").pop() || "").toLowerCase();

const elementAttribute = (element: Element, name: string) => {
  const direct = element.getAttribute(name);
  if (direct) return direct;
  for (const attribute of Array.from(element.attributes)) {
    if ((attribute.localName || attribute.name.split(":").pop()) === name) return attribute.value;
  }
  return null;
};

const isAuxiliaryElement = (element: Element) => {
  const name = elementName(element);
  if (["translation", "transliteration", "romanization", "romaji"].includes(name)) return true;
  const role = Array.from(element.attributes).find(attribute => (attribute.localName || attribute.name.split(":").pop()) === "role")?.value || "";
  return /translation|transliteration|roman/i.test(role);
};

/**
 * Some providers return standards-oriented TTML without AMLL's required
 * `itunes:key` attributes. Keep that input usable without weakening the
 * AMLL parser itself, which remains the preferred implementation.
 */
const parseGenericTtml = (source: string): AmllLyricLine[] => {
  if (typeof DOMParser === "undefined") return [];
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.getElementsByTagName("parsererror").length) return [];
  const paragraphs = Array.from(document.getElementsByTagName("p"));
  const lines: AmllLyricLine[] = [];
  const agents = new Map<string, boolean>();
  for (const paragraph of paragraphs) {
    const begin = ttmlTime(elementAttribute(paragraph, "begin"));
    const end = ttmlTime(elementAttribute(paragraph, "end")) || begin + (ttmlTime(elementAttribute(paragraph, "dur")) || 3000);
    const agent = elementAttribute(paragraph, "agent");
    if (agent && !agents.has(agent)) agents.set(agent, agents.size % 2 === 1);
    const background = Array.from(paragraph.getElementsByTagName("*")).filter(el => elementAttribute(el, "role") === "x-bg");
    for (const voice of [paragraph, ...background]) {
      const words: AmllLyricLine["words"] = [];
      const startTime = ttmlTime(elementAttribute(voice, "begin"), begin);
      const endTime = ttmlTime(elementAttribute(voice, "end"), end);
      const visit = (node: Node, start: number, stop: number) => {
        if (node.nodeType === 3) {
          const word = node.nodeValue || "";
          if (word.trim() || word === " ") words.push({word, startTime:start, endTime:Math.max(start, stop)});
          return;
        }
        if (node.nodeType !== 1) return;
        const el = node as Element;
        if (isAuxiliaryElement(el) || (el !== voice && elementAttribute(el, "role") === "x-bg")) return;
        const childStart = ttmlTime(elementAttribute(el, "begin"), start);
        const childEnd = ttmlTime(elementAttribute(el, "end"), stop);
        for (const child of Array.from(el.childNodes)) visit(child, childStart, childEnd);
      };
      visit(voice, startTime, endTime);
      if (words.some(word => word.word.trim())) lines.push({
        words, startTime:words[0].startTime, endTime:words[words.length - 1].endTime,
        translatedLyric:"", romanLyric:"", isBG:voice !== paragraph || elementAttribute(voice, "role") === "x-bg",
        isDuet:agent ? agents.get(agent)! : false,
      });
    }
  }
  return lines;
};

const normalizeLines = (lines: AmllLyricLine[], offsetMs: number) => {
  const sorted = lines
    .map(cloneLine)
    .filter(line => Number.isFinite(line.startTime) && Number.isFinite(line.endTime))
    .sort((a, b) => a.startTime - b.startTime);
  for (const line of sorted) {
    line.startTime = Math.max(0, finite(line.startTime) - offsetMs);
    line.endTime = Math.max(line.startTime, finite(line.endTime) - offsetMs);
    line.words = line.words.map(word => ({
      ...word,
      startTime: Math.max(0, finite(word.startTime) - offsetMs),
      endTime: Math.max(0, finite(word.endTime) - offsetMs),
    }));
  }
  return sorted;
};

const parseSource = (source: string, format: LyricSourceFormat): AmllLyricLine[] => {
  if (!source.trim()) return [];
  try {
    if (format === "yrc") return parseYrc(source);
    if (format === "qrc") return parseQrc(source);
    if (format === "ttml") {
      try {
        const parsed = parseTTML(source).lines;
        if (parsed.length) return parsed;
      } catch { /* Try standards-oriented TTML without Apple-specific keys. */ }
      return parseGenericTtml(source);
    }
    if (format === "lrc") return parseLrcLike(source, { mode: "spl" }).lines;
  } catch {
    // A malformed enhanced lyric should fall back to the simpler format.
  }
  return [];
};

const parseAuxiliary = (source: string) => parseSource(source, "lrc");

// NetEase interleaves display credits with the timed lines. Passing those
// records to an LRC parser can append the literal JSON to the previous verse.
function withoutCredits(source: string, credits?: Set<string>) {
  return source.slice(0, 200000).split(/\r?\n/).filter(raw => {
    const record = raw.replace(/^\s*(?:\[\d{1,3}:\d{2}(?:[.:]\d+)?\])?\s*/, "");
    if (!/^\{\s*"(?:t|c)"\s*:/.test(record)) return true;
    try {
      const data = JSON.parse(record);
      if (!Array.isArray(data.c) || !Number.isFinite(data.t)) return true;
      const text = data.c.map((item: { tx?: unknown } | null) => typeof item?.tx === 'string' ? item.tx : '').join('').trim();
      if (text && credits && credits.size < 150) credits.add(text);
    } catch { /* A truncated record at the size limit still isn't sung text. */ }
    return false;
  }).join('\n');
}

function applyVocalLabels(lines: AmllLyricLine[], artist: string) {
  const performers = artist.split(/\s*[/、&]\s*/).map(name => name.trim()).filter(Boolean);
  const labels = new Set<string>();
  for (const line of lines) {
    for (const match of lineText(line).matchAll(/【([^【】\n]{1,32})】/g)) labels.add(match[1]);
  }
  if (!labels.size) return lines;
  // A short form printed in the lyrics can link a stage name and its alias.
  const roles = new Map<string, string>();
  for (const label of labels) {
    const candidates = performers.filter(name => {
      if (name === label) return true;
      for (let len = 2; len <= Math.min(label.length, name.length); len++) {
        const prefix = label.slice(0, len);
        if (!name.startsWith(prefix)) break;
        if (labels.has(prefix)) return true;
      }
      return false;
    });
    if (candidates.length === 1) roles.set(label, candidates[0]);
  }
  const sides = new Map<string, boolean>();
  let duet = false, background = false;
  const result: AmllLyricLine[] = [];
  for (const line of lines) {
    const text = lineText(line);
    const marks = [...text.matchAll(/【([^【】\n]{1,32})】/g)].filter(m =>
      roles.has(m[1]) || /^(合|合唱|齐唱|和声|伴唱)$/.test(m[1]));
    if (!marks.length) {
      result.push({ ...line, isDuet: duet || line.isDuet, isBG: background || line.isBG });
      continue;
    }
    // With only a line timestamp, two exchanges share one cue. Keep their
    // labels readable together instead of guessing when the second voice enters.
    const sharedCue = line.words.length === 1 && marks.length > 1;
    const fragments: AmllLyricLine[] = [];
    let wordIndex = 0, offset = 0;
    const slice = (start: number, end: number) => {
      if (sharedCue || start >= end || !text.slice(start, end).trim()) return;
      const words: AmllLyricLine["words"] = [];
      while (wordIndex < line.words.length && offset < end) {
        const word = line.words[wordIndex];
        const part = word.word.slice(Math.max(0, start - offset), end - offset);
        if (part) words.push({ ...word, word: part });
        if (offset + word.word.length > end) break;
        offset += word.word.length;
        wordIndex++;
      }
      fragments.push({ ...line, words, startTime: words[0].startTime, endTime: words[words.length-1].endTime,
        isDuet: duet || line.isDuet, isBG: background || line.isBG });
    };
    let start = 0;
    for (const mark of marks) {
      slice(start, mark.index!);
      const role = roles.get(mark[1]);
      background = /^(和声|伴唱)$/.test(mark[1]);
      if (role) {
        if (!sides.has(role)) sides.set(role, sides.size % 2 === 1);
        duet = sides.get(role)!;
      } else if (!background) duet = false;
      start = mark.index! + mark[0].length;
    }
    slice(start, text.length);
    if (sharedCue) result.push(line);
    else fragments.forEach((fragment, index) => result.push(index ? {...fragment, translatedLyric:'', romanLyric:''} : fragment));
    if (fragments.length && background) background = false;
  }
  return result;
}

const auxiliaryByStart = (lines: AmllLyricLine[]) => new Map(
  lines.map(line => [Math.round(line.startTime), line.words.map(word => word.word).join("").trim()]),
);

/** Convert NetEase lyric payloads into the AMLL line/word model. */
export function parseLyricDocument(payload: LyricPayload = {}, artist = ""): LyricDocument {
  const offsetMs = finite(payload.offset) * 1000;
  const credits = new Set<string>();
  const original = withoutCredits(payload.original || "", credits);
  const candidates = [["ttml", payload.ttml], ["yrc", withoutCredits(payload.yrc || "", credits)], ["qrc", payload.qrc], ["lrc", original]] as const;
  let source = "", sourceFormat: LyricSourceFormat = "plain", lines: AmllLyricLine[] = [];
  for (const [format, value] of candidates) {
    if (!value?.trim()) continue;
    if (!source) { source = value; sourceFormat = format; }
    const parsed = normalizeLines(parseSource(value.slice(0, 200000), format).slice(0, 4000), offsetMs);
    if (parsed.length) { source = value; sourceFormat = format; lines = parsed; break; }
  }
  const translatedText = sourceFormat === 'yrc' && payload.ytranslated?.trim() ? payload.ytranslated : payload.translated || "";
  const translated = auxiliaryByStart(normalizeLines(parseAuxiliary(withoutCredits(translatedText)), offsetMs));
  const romanized = auxiliaryByStart(normalizeLines(parseAuxiliary(withoutCredits(payload.yromanized || payload.romanized || "")), offsetMs));
  if (lines.length) {
    lines = lines.map((line, index) => {
      const key = Math.round(line.startTime);
      const next = lines[index + 1];
      const endTime = Math.max(line.startTime, line.endTime || next?.startTime || line.startTime + 3000);
      const words = line.words.length
        ? line.words.map(word => ({ ...word, startTime: Math.max(0, word.startTime), endTime: Math.max(word.startTime, word.endTime) }))
        : [{ startTime: line.startTime, endTime, word: "" }];
      return {
        ...line,
        endTime,
        words,
        translatedLyric: line.translatedLyric || translated.get(key) || "",
        romanLyric: line.romanLyric || romanized.get(key) || "",
        isBG: Boolean(line.isBG),
        isDuet: Boolean(line.isDuet),
      };
    });
  }
  return {
    lines: payload.instrumental ? [] : sourceFormat === "ttml" ? lines : applyVocalLabels(lines, artist),
    credits: [...credits],
    sourceFormat,
    offset: finite(payload.offset),
    original: payload.original || source,
    translated: payload.translated || "",
    romanized: payload.yromanized || payload.romanized || "",
    hasWordTiming: lines.some(line => line.words.length > 1 || (line.words[0]?.word.length ?? 0) < lineText(line).length),
    instrumental: payload.instrumental === true,
    unavailable: payload.unavailable === true,
  };
}

function lineText(line: AmllLyricLine) {
  return line.words.map(word => word.word).join("");
}

export function lyricDocumentToLegacyLines(document: LyricDocument): LyricLine[] {
  const foreground = document.lines.filter(line => !line.isBG);
  return (foreground.length ? foreground : document.lines).map(line => ({
    time: line.startTime / 1000,
    text: lineText(line),
    translation: line.translatedLyric || undefined,
  })).sort((a,b) => a.time - b.time);
}

/** Standard LRC: multiple timestamps, decimal precision, offsets and untimed text. */
export function parseLyrics(source: string, translated = ''): LyricLine[] {
  const parse = (input: string) => {
    const offset = Number(/\[offset:([+-]?\d+)\]/i.exec(input)?.[1] || 0) / 1000;
    const result: LyricLine[] = [];
    for (const raw of input.slice(0, 200000).split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const text = raw.replace(/\[[^\]]*\]/g, '').trim();
      if (!text) continue;
      for (const stamp of stamps) {
        const time = Number(stamp[1]) * 60 + Number(stamp[2]) + Number(`0.${stamp[3] || 0}`) - offset;
        if (Number(stamp[2]) < 60 && Number.isFinite(time)) result.push({ time: Math.max(0, Math.round(time * 1000) / 1000), text });
      }
      if (result.length >= 4000) break;
    }
    return result.sort((a, b) => a.time - b.time).slice(0, 4000);
  };
  const lines = parse(withoutCredits(source)), translations = parse(withoutCredits(translated));
  const byTime = new Map(translations.map(line => [Math.round(line.time * 100), line.text]));
  return lines.map(line => ({ ...line, translation: byTime.get(Math.round(line.time * 100)) }));
}

export function lyricIndex(lines: readonly LyricLine[], time: number) {
  let left = 0, right = lines.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (lines[middle].time <= time) left = middle + 1; else right = middle;
  }
  return left - 1;
}

export function untimedLyrics(source: string) {
  return withoutCredits(source).split(/\r?\n/).filter(line => !/^\[(?:ar|ti|al|by|offset|re|ve):/i.test(line))
    .map(line => line.replace(/\[[^\]]*\]/g, '').trim()).filter(Boolean).slice(0, 4000).join('\n');
}
