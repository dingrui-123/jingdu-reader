import type { Book, Chapter, LibraryAccess, RemoteBook } from '../types';
import * as db from './db';
import { decryptRemote, keyPattern, sourceIdPattern, validateRemoteBook, validLibrary, versionPattern } from './remote-format';
const memory = new Map<string, Chapter>();
const base = import.meta.env.BASE_URL;
export function clearReadingCache() { memory.clear(); }
export function remotePath(remote: Book['remote']) {
  if (!remote || !sourceIdPattern.test(remote.id) || !versionPattern.test(remote.version)) throw new Error('在线来源不完整。');
  return `${base}stream/${remote.id}-${remote.version}.jds`;
}
async function boundedBody(response: Response, max: number): Promise<ArrayBuffer> {
  const reader = response.body?.getReader(); if (!reader) throw new Error('当前浏览器不支持在线加载。');
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > max) { void reader.cancel().catch(() => {}); throw new Error('服务器返回的数据超过预期大小，已停止加载。'); }
    chunks.push(chunk.value);
  }
  return new Blob(chunks).arrayBuffer();
}
async function range(url: string, start: number, end: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal, headers: { Range: `bytes=${start}-${end}` }, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${start}-${end}/`)) {
    void response.body?.cancel().catch(() => {});
    throw new Error('当前网络未能按章加载，请检查网络后重试。不会自动下载整本书。');
  }
  const buffer = await boundedBody(response, end - start + 1);
  if (buffer.byteLength !== end - start + 1) throw new Error('章节下载不完整，请重试。');
  return buffer;
}
export async function fetchLibrary(access: LibraryAccess, signal?: AbortSignal): Promise<RemoteBook[]> {
  if (!validLibrary(access)) throw new Error('私人书架链接不完整。');
  const response = await fetch(`${base}stream/${access.id}.jdi`, { signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('暂时无法更新私人书架，请检查网络后重试。');
  const bytes = await decryptRemote(await boundedBody(response, 2 * 1024 * 1024), access.secret, `JDL1:${access.id}`, 16 * 1024 * 1024);
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (data.format !== 'jingdu-stream-library' || data.version !== 1 || !Array.isArray(data.books) || !data.books.length || data.books.length > 100) throw new Error('不支持的私人书架格式。');
  data.books.forEach(validateRemoteBook);
  if (new Set(data.books.map((book: RemoteBook) => book.sourceId)).size !== data.books.length) throw new Error('私人书架中存在重复来源。');
  return data.books;
}
export async function syncLibrary(access: LibraryAccess, signal?: AbortSignal) {
  const books = await fetchLibrary(access, signal); signal?.throwIfAborted();
  return db.mergeRemoteBooks(books, access);
}
export async function fetchBookSource(link: { id: string; secret: string }, signal?: AbortSignal): Promise<RemoteBook | null> {
  if (!sourceIdPattern.test(link.id) || !keyPattern.test(link.secret)) throw new Error('私人阅读链接不完整。');
  const response = await fetch(`${base}stream/${link.id}.jdx`, { signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (response.status === 404) { void response.body?.cancel().catch(() => {}); return null; }
  if (!response.ok) throw new Error('在线目录暂时无法加载，请检查网络后重试。');
  const bytes = await decryptRemote(await boundedBody(response, 2 * 1024 * 1024), link.secret, `JDB1:${link.id}`, 8 * 1024 * 1024);
  const book: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); validateRemoteBook(book);
  if (book.sourceId !== link.id || book.remote.secret !== link.secret) throw new Error('在线目录与私人链接不一致。');
  return book;
}
export async function loadChapter(book: Book, index: number, signal?: AbortSignal): Promise<Chapter> {
  const local = await db.getChapter(book.id, index);
  if (local) return local;
  if (!book.remote) throw new Error('这一节的本地数据丢失，请从备份恢复。');
  const info = book.chapters[index]; if (!info || info.remoteOffset === undefined || info.remoteSize === undefined) throw new Error('这一节的在线目录不完整。');
  const key = `${book.id}:${book.remote.version}:${index}`;
  const cached = memory.get(key); if (cached) return cached;
  if (!navigator.onLine) throw new Error('这一节尚未离线保存，请联网阅读，或提前在书籍详情下载整本离线。');
  const start = book.remote.dataStart + info.remoteOffset;
  const packed = await range(remotePath(book.remote), start, start + info.remoteSize - 1, signal);
  const chapter = await decodeChapter(book, index, packed); signal?.throwIfAborted();
  memory.set(key, chapter); while (memory.size > 3) memory.delete(memory.keys().next().value!);
  return chapter;
}
async function decodeChapter(book: Book, index: number, buffer: ArrayBuffer): Promise<Chapter> {
  const info = book.chapters[index];
  const bytes = await decryptRemote(buffer, book.remote!.secret, `JDC1:${book.remote!.id}:${book.remote!.version}:${index}`, 80 * 1024);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.length !== info.length) throw new Error('章节内容与目录不一致，请重试。');
  return { ...info, bookId: book.id, text };
}
export async function downloadOffline(book: Book, onProgress: (n: number) => void, signal?: AbortSignal) {
  if (!book.remote) throw new Error('这本书已经保存在本地。');
  if (!navigator.onLine) throw new Error('下载整本书需要联网。');
  onProgress(0);
  const response = await fetch(remotePath(book.remote), { signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('离线书籍下载失败，请稍后重试。');
  const packed = await boundedBody(response, book.remote.totalSize);
  if (packed.byteLength !== book.remote.totalSize) throw new Error('整本书下载不完整，请重试。');
  onProgress(25);
  for (let i = 0; i < book.chapterCount; i += 24) {
    signal?.throwIfAborted();
    const chapters = await Promise.all(book.chapters.slice(i, i + 24).map(async info => {
      const offset = book.remote!.dataStart + info.remoteOffset!;
      return decodeChapter(book, info.index, packed.slice(offset, offset + info.remoteSize!));
    }));
    signal?.throwIfAborted(); await db.cacheChapters(chapters);
    onProgress(Math.min(99, 25 + Math.round((i + chapters.length) / book.chapterCount * 74)));
  }
  signal?.throwIfAborted(); await db.markOffline(book.id); onProgress(100);
}
