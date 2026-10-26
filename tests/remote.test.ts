import 'fake-indexeddb/auto';
import { it, expect, vi, afterEach } from 'vitest';
import { createCipheriv, randomBytes, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as db from '../src/lib/db';
import { parseText, decodeFile } from '../src/lib/parser';
import { decryptRemote, validateRemoteBook, readShelfLink } from '../src/lib/remote-format';
import { loadChapter, downloadOffline, clearReadingCache } from '../src/lib/remote';
import type { RemoteBook, Book } from '../src/types';
const seal = (text: string, secret: string, aad: string) => {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(secret, 'base64url'), iv); cipher.setAAD(Buffer.from(aad));
  return Buffer.concat([iv, cipher.update(gzipSync(Buffer.from(text))), cipher.final(), cipher.getAuthTag()]);
};
function fixture() {
  const sourceId = randomBytes(18).toString('base64url'); const secret = randomBytes(32).toString('base64url'); const version = '1234567890abcdef';
  const parsed = parseText('第一章 春\n春风又绿江南岸。\n第二章 夏\n夏日的故事。\n第三章 秋\n秋风起。\n', '远方_佚名.txt', 'utf-8'); let offset = 0;
  const chunks = parsed.chapters.map(c => seal(c.text, secret, `JDC1:${sourceId}:${version}:${c.index}`));
  const descriptor: RemoteBook = { sourceId, title: parsed.title, author: parsed.author, size: 200, encoding: 'utf-8', length: parsed.length,
    chapters: parsed.chapters.map(({ text, ...info }, i) => { const result = { ...info, remoteOffset: offset, remoteSize: chunks[i].length }; offset += chunks[i].length; return result; }),
    remote: { id: sourceId, secret, version, dataStart: 64, totalSize: 64 + offset } };
  return { descriptor, parsed, packed: Buffer.concat([Buffer.alloc(64), ...chunks]) };
}
afterEach(() => { vi.unstubAllGlobals(); clearReadingCache(); });
it('validates online metadata, authenticated chapter identity, and bounded shelf links', async () => {
  const { descriptor } = fixture(); validateRemoteBook(descriptor);
  expect(readShelfLink(`#shelf/${descriptor.sourceId}/${descriptor.remote.secret}`)?.id).toBe(descriptor.sourceId);
  expect(readShelfLink('#shelf/../../bad')).toBeNull();
  const bad = structuredClone(descriptor); bad.chapters[1].remoteOffset = 0; expect(() => validateRemoteBook(bad)).toThrow();
  const packed = seal('一段原文🌿\r\n', descriptor.remote.secret, 'chapter:1');
  expect(new TextDecoder().decode(await decryptRemote(Uint8Array.from(packed).buffer, descriptor.remote.secret, 'chapter:1', 1024))).toBe('一段原文🌿\r\n');
  await expect(decryptRemote(Uint8Array.from(packed).buffer, descriptor.remote.secret, 'chapter:2', 1024)).rejects.toThrow('校验失败');
  await expect(decryptRemote(Uint8Array.from(seal('字'.repeat(500), descriptor.remote.secret, 'test')).buffer, descriptor.remote.secret, 'test', 100)).rejects.toThrow('大小超过限制');
});
it('migrates existing offline books, preserves bookmarks and progress on release, and backs up online sources', async () => {
  const { descriptor, parsed } = fixture();
  const old = await db.importBook(parsed, 200, () => {}, descriptor.sourceId);
  old.position = { chapter: 1, offset: 0, fraction: .4, progress: .5 }; await db.saveBook(old);
  await db.saveBookmark({ id: 'remote-mark', bookId: old.id, title: '夏', snippet: '夏日', position: old.position, createdAt: 1 });
  const access = { id: randomBytes(18).toString('base64url'), secret: randomBytes(32).toString('base64url') };
  const [merged] = await db.mergeRemoteBooks([descriptor], access);
  expect(merged.id).toBe(old.id); expect(merged.storage).toBe('offline'); expect(merged.position).toEqual(old.position);
  await db.releaseOffline(merged.id);
  expect(await db.getChapter(merged.id, 0)).toBeUndefined();
  const book = (await db.listBooks()).find(b => b.id === merged.id)!; expect(book.position).toEqual(old.position);
  expect((await db.listBookmarks()).find(m => m.id === 'remote-mark')?.bookId).toBe(old.id);
  const backup = await db.exportBackup(); db.validateBackup(backup); expect(backup.library?.id).toBe(access.id);
  const invalid = structuredClone(backup); invalid.books.find(b => b.id === old.id)!.storage = 'offline'; expect(() => db.validateBackup(invalid)).toThrow();
  await db.restoreBackup(backup); expect((await db.listBooks()).find(b => b.id === old.id)?.remote?.id).toBe(descriptor.sourceId);
  await db.deleteBook(old.id); await db.mergeRemoteBooks([descriptor], access);
  expect((await db.listBooks()).find(b => b.sourceId === descriptor.sourceId)).toBeUndefined();
});
it('reads just one range without persisting text, rejects full-response fallback, and supports explicit offline download', async () => {
  vi.stubGlobal('navigator', { onLine: true }); const { descriptor, packed, parsed } = fixture();
  const [book] = await db.mergeRemoteBooks([descriptor]);
  let fullResponse = false; const calls: { range: string | undefined; size: number }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    expect(url).not.toContain(descriptor.remote.secret); expect(options.cache).toBe('no-store');
    const range = (options.headers as Record<string, string>)?.Range;
    const match = /bytes=(\d+)-(\d+)/.exec(range ?? ''); const start = Number(match?.[1] ?? 0); const end = Number(match?.[2] ?? packed.length - 1);
    const body = packed.subarray(start, end + 1); calls.push({ range, size: body.length });
    return new Response(body, { status: match && !fullResponse ? 206 : 200, headers: match ? { 'content-range': `bytes ${start}-${end}/${packed.length}` } : {} });
  }));
  expect((await loadChapter(book, 1)).text).toBe(parsed.chapters[1].text);
  expect(calls).toHaveLength(1); expect(calls[0].size).toBe(descriptor.chapters[1].remoteSize);
  expect(await db.getChapter(book.id, 1)).toBeUndefined();
  clearReadingCache(); fullResponse = true; await expect(loadChapter(book, 0)).rejects.toThrow('不会自动下载整本'); fullResponse = false;
  await downloadOffline(book, () => {});
  const offline = (await db.listBooks()).find(b => b.id === book.id)!; expect(offline.storage).toBe('offline');
  vi.stubGlobal('navigator', { onLine: false }); clearReadingCache();
  for (const info of parsed.chapters) expect((await loadChapter(offline, info.index)).text).toBe(info.text);
  await db.releaseOffline(book.id); clearReadingCache(); await expect(loadChapter(book, 2)).rejects.toThrow('尚未离线保存');
});
it('restores every real streaming pack to its decoded source text when local fixtures are available', async () => {
  if (!existsSync('.tools/stream-books')) return;
  for (const name of readdirSync('.tools/stream-books').filter(n => n.endsWith('.json'))) {
    const book = JSON.parse(readFileSync(`.tools/stream-books/${name}`, 'utf8')) as RemoteBook; validateRemoteBook(book);
    const metadata = JSON.parse(readFileSync(`.tools/private-books/${book.sourceId}.json`, 'utf8'));
    const packed = readFileSync(metadata.streamFile); const texts: string[] = [];
    expect(packed.toString('ascii', 0, 4)).toBe('JDS1'); expect(packed.readUInt32BE(4) + 8).toBe(book.remote.dataStart);
    const index = JSON.parse(new TextDecoder().decode(await decryptRemote(Uint8Array.from(packed.subarray(8, book.remote.dataStart)).buffer, book.remote.secret, `JDM1:${book.sourceId}:${book.remote.version}`, 2 * 1024 * 1024)));
    expect(index.chapters.length).toBe(book.chapters.length);
    for (const c of book.chapters) {
      const start = book.remote.dataStart + c.remoteOffset!;
      texts.push(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await decryptRemote(Uint8Array.from(packed.subarray(start, start + c.remoteSize!)).buffer, book.remote.secret, `JDC1:${book.sourceId}:${book.remote.version}:${c.index}`, 80 * 1024)));
    }
    const decoded = await decodeFile(new Blob([readFileSync(metadata.name)]));
    const hash = (s: string) => createHash('sha256').update(s).digest('hex');
    expect(hash(texts.join(''))).toBe(hash(decoded.text));
  }
}, 120000);
