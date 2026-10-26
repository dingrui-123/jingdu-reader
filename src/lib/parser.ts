import type { Parsed } from '../types';

// Headings must occupy an entire short line. Sentence punctuation rejects prose-like matches.
const heading = /^(?:第[〇零一二三四五六七八九十百千万两\d０-９]+[章回节卷部篇](?:\s*[^。！？!?；;]{0,44})?|chapter\s+\d+(?:[\s:：.\-]+[^。！？!?；;]{0,44})?|序章|楔子|前言|尾声|后记|引子)$/i;
const MAX_SECTION = 18000;

export function parseText(text: string, filename: string, encoding: string): Parsed {
  if (!text.trim()) throw new Error('文件没有可阅读的正文。');
  const stem = filename.replace(/\.txt$/i, '');
  const named = /^《(.+?)》.*?作者[：:]\s*(.+)$/.exec(stem);
  const parts = named ? [named[1], named[2]] : stem.split(/[_＿]/);
  const markers: { start: number; title: string; lineEnd?: number }[] = [];
  const lines = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = lines.exec(text)) && match[0].length) {
    const candidate = match[0].trim();
    if (candidate.length <= 65 && heading.test(candidate)) {
      const previous = markers.at(-1);
      // Some exports repeat a numbered heading immediately above the original heading.
      // Keep both lines in the text, but expose only one navigation entry.
      if (previous?.lineEnd !== undefined && !text.slice(previous.lineEnd, match.index).trim() && (previous.title.endsWith(candidate) || candidate.endsWith(previous.title))) {
        previous.title = previous.title.length <= candidate.length ? previous.title : candidate;
        previous.lineEnd = match.index + match[0].length;
      } else markers.push({ start: match.index, title: candidate, lineEnd: match.index + match[0].length });
    }
  }
  if (!markers.length || markers[0].start > 0) markers.unshift({ start: 0, title: markers.length ? '卷首' : '正文' });
  const chapters: Parsed['chapters'] = [];
  for (let i = 0; i < markers.length; i++) {
    const end = markers[i + 1]?.start ?? text.length;
    let start = markers[i].start;
    let part = 1;
    while (start < end) {
      let stop = Math.min(start + MAX_SECTION, end);
      if (stop < end) {
        const lineEnd = text.lastIndexOf('\n', stop);
        if (lineEnd > start + MAX_SECTION / 2) stop = lineEnd + 1;
        if (/[\uD800-\uDBFF]/.test(text[stop - 1])) stop--;
      }
      // Bound DOM size even for pathological files containing thousands of tiny lines.
      const breaks = /\r\n|\r|\n/g;
      const section = text.slice(start, stop);
      let lineCount = 0; let lineBreak: RegExpExecArray | null;
      while ((lineBreak = breaks.exec(section))) {
        if (++lineCount === 320) { stop = start + lineBreak.index + lineBreak[0].length; break; }
      }
      chapters.push({ index: chapters.length, title: markers[i].title + (part > 1 ? ` · 续 ${part}` : ''), start, length: stop - start, text: text.slice(start, stop) });
      start = stop; part++;
    }
  }
  return { title: parts[0] || '未命名书籍', author: parts.slice(1).join('_'), encoding, length: text.length, chapters };
}

export async function decodeFile(file: Blob, requested = 'auto', onProgress = (_: number) => {}): Promise<{ text: string; encoding: string }> {
  const decode = async (encoding: string, fatal: boolean) => {
    const decoder = new TextDecoder(encoding, { fatal, ignoreBOM: false });
    const chunks: string[] = [];
    const size = 512 * 1024;
    for (let i = 0; i < file.size; i += size) {
      chunks.push(decoder.decode(await file.slice(i, i + size).arrayBuffer(), { stream: true }));
      onProgress(Math.min(95, Math.round((i + size) / file.size * 90)));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  };
  const prefix = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  let encoding = requested;
  if (encoding === 'auto') {
    if (prefix[0] === 255 && prefix[1] === 254) encoding = 'utf-16le';
    else if (prefix[0] === 254 && prefix[1] === 255) encoding = 'utf-16be';
    else {
      try { return { text: await decode('utf-8', true), encoding: 'utf-8' }; }
      catch { encoding = 'gb18030'; }
    }
  }
  return { text: await decode(encoding, true), encoding };
}
