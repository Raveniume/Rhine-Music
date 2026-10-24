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

const textContent = (node: Node) => (node.textContent || "").replace(/\s+/g, " ").trim();

const isAuxiliaryElement = (element: Element) => {
  const name = elementName(element);
  if (["translation", "transliteration", "romanization", "romaji"].includes(name)) return true;
  const role = Array.from(element.attributes).find(attribute => (attribute.localName || attribute.name.split(":").pop()) === "role")?.value || "";
  return /translation|transliteration|roman/i.test(role);
};

const lyricTextContent = (node: Node): string => {
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  if (isAuxiliaryElement(element)) return "";
  return Array.from(element.childNodes).map(lyricTextContent).join("");
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
  for (const paragraph of paragraphs) {
    const startTime = ttmlTime(elementAttribute(paragraph, "begin"));
    const explicitEnd = ttmlTime(elementAttribute(paragraph, "end"));
    const duration = ttmlTime(elementAttribute(paragraph, "dur"));
    const endTime = explicitEnd || (duration ? startTime + duration : 0);
    const words: AmllLyricLine["words"] = [];
    const appendWord = (element: Element) => {
      const word = textContent(element);
      if (!word) return;
      const wordStart = ttmlTime(elementAttribute(element, "begin"), startTime);
      const wordEnd = ttmlTime(elementAttribute(element, "end"), endTime || wordStart);
      words.push({ word, startTime: wordStart, endTime: Math.max(wordStart, wordEnd) });
    };
    for (const child of Array.from(paragraph.childNodes)) {
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      if (isAuxiliaryElement(element)) continue;
      if (elementName(element) === "span" && (elementAttribute(element, "begin") || elementAttribute(element, "end"))) appendWord(element);
    }
    const lineText = lyricTextContent(paragraph).replace(/\s+/g, " ").trim();
    if (!lineText) continue;
    const lineEnd = endTime || startTime + 3000;
    if (!words.length) words.push({ word: lineText, startTime, endTime: lineEnd });
    lines.push({
      words,
      startTime,
      endTime: Math.max(startTime, lineEnd),
      translatedLyric: "",
      romanLyric: "",
      isBG: false,
      isDuet: false,
    });
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
      const parsed = parseTTML(source).lines;
      return parsed.length ? parsed : parseGenericTtml(source);
    }
    if (format === "lrc") return parseLrcLike(source, { mode: "spl" }).lines;
  } catch {
    // A malformed enhanced lyric should fall back to the simpler format.
  }
  return [];
};

const parseAuxiliary = (source: string) => parseSource(source, "lrc");

const auxiliaryByStart = (lines: AmllLyricLine[]) => new Map(
  lines.map(line => [Math.round(line.startTime), line.words.map(word => word.word).join("").trim()]),
);

/** Convert NetEase lyric payloads into the AMLL line/word model. */
export function parseLyricDocument(payload: LyricPayload = {}): LyricDocument {
  const source = payload.yrc?.trim() || payload.qrc?.trim() || payload.ttml?.trim() || payload.original?.trim() || "";
  const sourceFormat: LyricSourceFormat = payload.yrc?.trim()
    ? "yrc"
    : payload.qrc?.trim()
      ? "qrc"
      : payload.ttml?.trim()
        ? "ttml"
        : payload.original?.trim()
          ? "lrc"
          : "plain";
  const offsetMs = finite(payload.offset) * 1000;
  let lines = normalizeLines(parseSource(source, sourceFormat), offsetMs);
  const translated = auxiliaryByStart(normalizeLines(parseAuxiliary(payload.translated || ""), offsetMs));
  const romanized = auxiliaryByStart(normalizeLines(parseAuxiliary(payload.yromanized || payload.romanized || ""), offsetMs));
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
    lines,
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
  return document.lines.map(line => ({
    time: line.startTime / 1000,
    text: lineText(line),
    translation: line.translatedLyric || undefined,
  }));
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
  const lines = parse(source), translations = parse(translated);
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
  return source.slice(0, 200000).split(/\r?\n/).filter(line => !/^\[(?:ar|ti|al|by|offset|re|ve):/i.test(line))
    .map(line => line.replace(/\[[^\]]*\]/g, '').trim()).filter(Boolean).slice(0, 4000).join('\n');
}
