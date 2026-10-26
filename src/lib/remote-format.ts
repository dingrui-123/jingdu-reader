import type { LibraryAccess, RemoteBook } from '../types';
export const sourceIdPattern = /^[A-Za-z0-9_-]{16,64}$/;
export const keyPattern = /^[A-Za-z0-9_-]{43}$/;
export const versionPattern = /^[a-f0-9]{16}$/;
export function readShelfLink(hash: string): LibraryAccess | null {
  const match = /^#shelf\/([^/]+)\/([^/]+)$/.exec(hash);
  return match && sourceIdPattern.test(match[1]) && keyPattern.test(match[2]) ? { id: match[1], secret: match[2] } : null;
}
export function validLibrary(value: unknown): value is LibraryAccess {
  const v = value as LibraryAccess;
  return !!v && typeof v.id === 'string' && typeof v.secret === 'string' && sourceIdPattern.test(v.id) && keyPattern.test(v.secret) && (!v.hidden || (Array.isArray(v.hidden) && v.hidden.every(id => typeof id === 'string' && sourceIdPattern.test(id))));
}
export function validateRemoteBook(value: unknown): asserts value is RemoteBook {
  const v = value as RemoteBook; const r = v?.remote;
  const fail = () => { throw new Error('在线书籍目录格式不完整，请重新打开私人书架链接。'); };
  if (!v || !r || typeof v.sourceId !== 'string' || typeof r.secret !== 'string' || typeof r.version !== 'string' || !sourceIdPattern.test(v.sourceId) || r.id !== v.sourceId || !keyPattern.test(r.secret) || !versionPattern.test(r.version) || !Number.isInteger(r.dataStart) || r.dataStart < 40 || r.dataStart > 2 * 1024 * 1024 || !Number.isInteger(r.totalSize) || r.totalSize <= r.dataStart || r.totalSize > 100 * 1024 * 1024 || typeof v.title !== 'string' || !v.title || typeof v.author !== 'string' || typeof v.encoding !== 'string' || !Number.isInteger(v.size) || v.size < 1 || v.size > 80 * 1024 * 1024 || !Number.isInteger(v.length) || v.length < 1 || v.length > 100e6 || !Array.isArray(v.chapters) || !v.chapters.length || v.chapters.length > 50000) return fail();
  let start = 0; let offset = 0;
  for (const [i, c] of v.chapters.entries()) {
    if (!c || c.index !== i || typeof c.title !== 'string' || c.title.length > 200 || c.start !== start || !Number.isInteger(c.length) || c.length < 1 || c.length > 18000 || c.remoteOffset !== offset || !Number.isInteger(c.remoteSize) || c.remoteSize! < 32 || c.remoteSize! > 128 * 1024) return fail();
    start += c.length; offset += c.remoteSize!;
  }
  if (start !== v.length || r.dataStart + offset !== r.totalSize) fail();
}
export async function decryptRemote(buffer: ArrayBuffer, secret: string, aad: string, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!crypto.subtle || !keyPattern.test(secret)) throw new Error('请使用 HTTPS 和新版 Safari 打开私人书架。');
  if (buffer.byteLength < 32 || buffer.byteLength > maxBytes + 1024) throw new Error('在线书籍数据大小异常。');
  const bytes = new Uint8Array(buffer);
  const raw = Uint8Array.from(atob(secret.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  let plain: ArrayBuffer;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(aad) }, key, bytes.slice(12)); }
  catch { throw new Error('在线书籍校验失败，请确认私人链接完整后重试。'); }
  if (typeof DecompressionStream === 'undefined') throw new Error('请更新浏览器后使用在线书架。');
  const reader = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('在线书籍解压大小超过限制。'); }
    parts.push(chunk.value);
  }
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}
