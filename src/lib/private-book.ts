export interface PrivateLink { id: string; secret: string }
const idPattern = /^[A-Za-z0-9_-]{16,64}$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
export function readPrivateLink(hash: string): PrivateLink | null {
  const match = /^#private\/([^/]+)\/([^/]+)$/.exec(hash);
  if (!match || !idPattern.test(match[1]) || !secretPattern.test(match[2])) return null;
  return { id: match[1], secret: match[2] };
}
export function readPrivateLinks(hash: string): PrivateLink[] | null {
  const single = readPrivateLink(hash);
  if (single) return [single];
  const match = /^#collection\/([A-Za-z0-9_-]{1,3000})$/.exec(hash);
  if (!match) return null;
  try {
    const encoded = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const links: unknown = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (!Array.isArray(links) || !links.length || links.length > 20) return null;
    if (!links.every(link => link && typeof link === 'object' && typeof link.id === 'string' && idPattern.test(link.id) && typeof link.secret === 'string' && secretPattern.test(link.secret))) return null;
    if (new Set(links.map(link => link.id)).size !== links.length) return null;
    return links.map(({ id, secret }) => ({ id, secret }));
  } catch { return null; }
}
export async function decryptPrivateBook(buffer: ArrayBuffer, secret: string): Promise<{ file: Blob; name: string }> {
  if (!crypto.subtle) throw new Error('当前浏览器无法解密私人藏书，请用 HTTPS 打开并更新 Safari。');
  if (!secretPattern.test(secret) || buffer.byteLength < 36 || buffer.byteLength > 81 * 1024 * 1024) throw new Error('私人阅读链接或书籍文件不完整。');
  const bytes = new Uint8Array(buffer);
  const format = new TextDecoder().decode(bytes.subarray(0, 4));
  if (format !== 'JDP1' && format !== 'JDP2') throw new Error('不支持的私人藏书格式。');
  const keyBytes = Uint8Array.from(atob(secret.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
  if (keyBytes.byteLength !== 32) throw new Error('私人阅读链接不完整。');
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  let plain: ArrayBuffer;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(4, 16), additionalData: bytes.slice(0, 4) }, key, buffer.slice(16)); }
  catch { throw new Error('无法解密这本书，请确认打开的是完整的私人阅读链接。'); }
  if (format === 'JDP2') {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持压缩藏书，请更新 Safari 后重试。');
    const reader = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 81 * 1024 * 1024) { await reader.cancel(); throw new Error('解压后的书籍超过支持的大小。'); }
        chunks.push(chunk.value);
      }
      plain = await new Blob(chunks).arrayBuffer();
    } catch (e) { throw new Error(e instanceof Error ? `书籍解压失败：${e.message}` : '书籍解压失败。'); }
  }
  if (plain.byteLength < 5) throw new Error('私人藏书内容不完整。');
  const nameLength = new DataView(plain).getUint32(0);
  if (nameLength < 1 || nameLength > 1024 || nameLength + 4 >= plain.byteLength) throw new Error('私人藏书内容不完整。');
  const name = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(plain, 4, nameLength));
  if (!/\.txt$/i.test(name)) throw new Error('这份私人藏书不是 TXT 格式。');
  return { name, file: new Blob([plain.slice(4 + nameLength)], { type: 'text/plain' }) };
}
