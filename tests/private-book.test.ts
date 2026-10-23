import { describe, expect, it } from 'vitest';
import { randomBytes, createCipheriv, createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { decryptPrivateBook, readPrivateLink } from '../src/lib/private-book';

function seal(name: string, raw: Buffer) {
  const filename = Buffer.from(name); const length = Buffer.alloc(4); length.writeUInt32BE(filename.length);
  const key = randomBytes(32); const iv = randomBytes(12); const magic = Buffer.from('JDP1');
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(magic);
  const body = Buffer.concat([magic, iv, cipher.update(Buffer.concat([length, filename, raw])), cipher.final(), cipher.getAuthTag()]);
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
  it('rejects wrong keys and tampered ciphertext', async () => {
    const encrypted = seal('测试.txt', Buffer.from('第一章 初见\n你好'));
    await expect(decryptPrivateBook(encrypted.body, randomBytes(32).toString('base64url'))).rejects.toThrow('无法解密');
    const damaged = encrypted.body.slice(0); new Uint8Array(damaged)[20] ^= 1;
    await expect(decryptPrivateBook(damaged, encrypted.secret)).rejects.toThrow('无法解密');
  });
  it('verifies the real locally generated package against the original file when available', async () => {
    if (!existsSync('.tools/private-books')) return;
    const name = readdirSync('.tools/private-books').find(f => f.endsWith('.json')); if (!name) return;
    const metadata = JSON.parse(readFileSync(`.tools/private-books/${name}`, 'utf8'));
    if (!existsSync(metadata.file) || !existsSync(metadata.name)) return;
    const result = await decryptPrivateBook(Uint8Array.from(readFileSync(metadata.file)).buffer, metadata.secret);
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    expect(hash(new Uint8Array(await result.file.arrayBuffer()))).toBe(hash(readFileSync(metadata.name)));
    expect(result.name).toBe(metadata.name);
  });
});
