import { describe, expect, it } from 'vitest';
import { randomBytes, createCipheriv, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { decryptPrivateBook, readPrivateLink, readPrivateLinks } from '../src/lib/private-book';

function seal(name: string, raw: Buffer, gzip = false) {
  const filename = Buffer.from(name); const length = Buffer.alloc(4); length.writeUInt32BE(filename.length);
  const key = randomBytes(32); const iv = randomBytes(12); const magic = Buffer.from(gzip ? 'JDP2' : 'JDP1');
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(magic);
  const plain = Buffer.concat([length, filename, raw]);
  const body = Buffer.concat([magic, iv, cipher.update(gzip ? gzipSync(plain) : plain), cipher.final(), cipher.getAuthTag()]);
  return { body: Uint8Array.from(body).buffer, secret: key.toString('base64url') };
}
describe('private book links and authenticated encryption', () => {
  it('validates identifiers without accepting path traversal or query string secrets', () => {
    const secret = randomBytes(32).toString('base64url');
    expect(readPrivateLink(`#private/abcdefghijklmnop/${secret}`)).toEqual({ id: 'abcdefghijklmnop', secret });
    expect(readPrivateLink(`#private/../../evil/${secret}`)).toBeNull();
    expect(readPrivateLink(`#private/abcdefghijklmnop/short`)).toBeNull();
    expect(readPrivateLink(`?key=${secret}`)).toBeNull();
  });
  it('round-trips exact original file bytes, including UTF-8 BOM', async () => {
    const raw = Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from('第一章 山间\r\n故事从这里开始。🌿')]);
    const encrypted = seal('一本书_作者.txt', raw);
    const result = await decryptPrivateBook(encrypted.body, encrypted.secret);
    expect(result.name).toBe('一本书_作者.txt');
    expect(Buffer.from(await result.file.arrayBuffer())).toEqual(raw);
    expect(new TextDecoder().decode(encrypted.body)).not.toContain('故事从这里开始');
  });
  it('accepts bounded collections, preserves single links, and rejects malformed or duplicate entries', () => {
    const links = Array.from({ length: 5 }, () => ({ id: randomBytes(18).toString('base64url'), secret: randomBytes(32).toString('base64url') }));
    const collection = (value: unknown) => '#collection/' + Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(readPrivateLinks(collection(links))).toEqual(links);
    expect(readPrivateLinks(`#private/${links[0].id}/${links[0].secret}`)).toEqual([links[0]]);
    for (const invalid of [[], {}, [links[0], links[0]], [{ ...links[0], id: '../outside' }], [{ ...links[0], secret: 'bad' }], Array(21).fill(links[0])]) expect(readPrivateLinks(collection(invalid))).toBeNull();
    expect(readPrivateLinks('#collection/broken')).toBeNull();
    expect(readPrivateLinks('#collection/' + 'a'.repeat(3001))).toBeNull();
  });
  it('rejects wrong keys and tampered ciphertext', async () => {
    const encrypted = seal('测试.txt', Buffer.from('第一章 初见\n你好'));
    await expect(decryptPrivateBook(encrypted.body, randomBytes(32).toString('base64url'))).rejects.toThrow('无法解密');
    const damaged = encrypted.body.slice(0); new Uint8Array(damaged)[20] ^= 1;
    await expect(decryptPrivateBook(damaged, encrypted.secret)).rejects.toThrow('无法解密');
  });
  it('decodes compressed books to exact bytes and rejects a tampered format marker', async () => {
    const raw = Buffer.from('第一章 春\n风吹过树梢。🌿\r\n'.repeat(500));
    const packed = seal('压缩书籍.txt', raw, true);
    expect(packed.body.byteLength).toBeLessThan(raw.length / 4);
    const result = await decryptPrivateBook(packed.body, packed.secret);
    expect(Buffer.from(await result.file.arrayBuffer())).toEqual(raw);
    const altered = packed.body.slice(0); new Uint8Array(altered)[3] = 49;
    await expect(decryptPrivateBook(altered, packed.secret)).rejects.toThrow('无法解密');
  });
  it('verifies the real locally generated package against the original file when available', async () => {
    if (!existsSync('.tools/private-books')) return;
    for (const name of readdirSync('.tools/private-books').filter(f => f.endsWith('.json'))) {
    const metadata = JSON.parse(readFileSync(`.tools/private-books/${name}`, 'utf8'));
    if (!metadata.file?.endsWith('.jdb')) continue;
    if (!existsSync(metadata.file) || !existsSync(metadata.name)) continue;
    const result = await decryptPrivateBook(Uint8Array.from(readFileSync(metadata.file)).buffer, metadata.secret);
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    expect(hash(new Uint8Array(await result.file.arrayBuffer()))).toBe(hash(readFileSync(metadata.name)));
    expect(result.name).toBe(metadata.name);
    }
  });
});
