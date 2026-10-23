import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { decodeFile, parseText } from '../src/lib/parser';
describe('TXT decoding and section indexing', () => {
  it('recognizes Chinese numeric and English headings without sentence matches', () => {
    const text = '书籍说明\r\n第一章 初见\r\n第一章的故事，已经结束了。\r\n第一千三百零七章 风起\n正文\n第1章 再来\nChapter 2: Return\n尾声\n全文完';
    const parsed = parseText(text, '测试_作者.txt', 'utf-8');
    expect(parsed.chapters.map(c => c.title)).toEqual(['卷首', '第一章 初见', '第一千三百零七章 风起', '第1章 再来', 'Chapter 2: Return', '尾声']);
    expect(parsed.chapters.map(c => c.text).join('')).toBe(text);
    expect(parsed.author).toBe('作者');
  });
  it('splits unstructured and giant paragraphs into bounded lossless sections', () => {
    const text = '无章节的文字🌿'.repeat(50000);
    const result = parseText(text, '随笔.txt', 'utf-8');
    expect(result.chapters.length).toBeGreaterThan(10);
    expect(result.chapters.every(c => c.length <= 18000)).toBe(true);
    expect(result.chapters.every(c => !/[\uD800-\uDBFF]$/.test(c.text))).toBe(true);
    expect(result.chapters.map(c => c.text).join('')).toBe(text);
    expect(() => parseText(' \n', '空.txt', 'utf-8')).toThrow();
  });
  it('coalesces adjacent duplicate exported headings without removing text', () => {
    const text = '第1章 第一章 林间\r\n\r\n第一章 林间\r\n风吹过树梢。\n第2章 第二章 远行\n第二章 远行\n正文';
    const parsed = parseText(text, '一本书.txt', 'utf-8');
    expect(parsed.chapters.map(c => c.title)).toEqual(['第一章 林间', '第二章 远行']);
    expect(parsed.chapters.map(c => c.text).join('')).toBe(text);
  });
  it('bounds the paragraph count for very short lines', () => {
    const text = '字\r\n'.repeat(10000);
    const parsed = parseText(text, '短行.txt', 'utf-8');
    expect(parsed.chapters.every(c => c.text.split('\n').length <= 321)).toBe(true);
    expect(parsed.chapters.map(c => c.text).join('')).toBe(text);
  });
  it('decodes UTF-8 BOM, GBK, GB18030 four-byte and UTF-16 BOM', async () => {
    expect((await decodeFile(new Blob([new Uint8Array([239,187,191,228,189,160,229,165,189])]))).text).toBe('你好');
    const gbk = await decodeFile(new Blob([new Uint8Array([0xc4,0xe3,0xba,0xc3])]));
    expect(gbk.text).toBe('你好'); expect(gbk.encoding).toBe('gb18030');
    expect((await decodeFile(new Blob([new Uint8Array([0x90,0x30,0x81,0x30])]))).text).toBe('\u{10000}');
    expect((await decodeFile(new Blob([new Uint8Array([255,254,96,79,125,89])]))).text).toBe('你好');
    expect((await decodeFile(new Blob([new Uint8Array([254,255,79,96,89,125])]))).text).toBe('你好');
  });
  it('preserves multi-byte characters crossing the decode chunk boundary', async () => {
    const text = 'a'.repeat(512 * 1024 - 1) + '中文🌿';
    expect((await decodeFile(new Blob([text]))).text).toBe(text);
  });
  it('indexes a four-million-character novel and preserves every character', () => {
    const text = Array.from({ length: 1500 }, (_, i) => `第${i + 1}章 远行\n${'山间的风吹过树梢，故事还在继续。\n'.repeat(150)}`).join('');
    const start = performance.now(); const parsed = parseText(text, '大书.txt', 'utf-8');
    expect(parsed.chapters.length).toBe(1500);
    expect(parsed.chapters.map(c => c.text).join('')).toBe(text);
    console.log(`Synthetic ${text.length.toLocaleString()} chars: ${(performance.now() - start).toFixed(0)} ms`);
  });
  it('checks the local user-provided novel when available, without bundling it', async () => {
    const file = readdirSync('.').find(name => name.endsWith('.txt'));
    if (!file) return;
    const bytes = readFileSync(file); const start = performance.now();
    const decoded = await decodeFile(new Blob([bytes])); const result = parseText(decoded.text, file, decoded.encoding);
    expect(result.chapters.map(c => c.text).join('')).toBe(decoded.text);
    expect(result.chapters.length).toBeGreaterThan(1000);
    console.log(`Local novel: ${bytes.length} bytes, ${decoded.text.length} chars, ${result.chapters.length} sections, ${decoded.encoding}, ${(performance.now() - start).toFixed(0)} ms`);
  });
});
