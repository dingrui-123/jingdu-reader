// Node.js 24+. No novel text or keys are written into tracked source.
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { randomBytes, createCipheriv, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { decodeFile, parseText } from '../src/lib/parser.ts';
const seal = (bytes, secret, aad) => {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(secret, 'base64url'), iv);
  cipher.setAAD(Buffer.from(aad)); return Buffer.concat([iv, cipher.update(gzipSync(bytes)), cipher.final(), cipher.getAuthTag()]);
};
await mkdir('.tools/private-books', { recursive: true }); await mkdir('.tools/stream-books', { recursive: true }); await mkdir('public/stream', { recursive: true });
const metadata = [];
for (const file of await readdir('.tools/private-books')) if (file.endsWith('.json') && !file.endsWith('.stream.json')) metadata.push(JSON.parse(await readFile(`.tools/private-books/${file}`, 'utf8')));
const books = []; const report = [];
for (const name of (await readdir('.')).filter(n => /\.txt$/i.test(n)).sort()) {
  const raw = await readFile(name); if (!raw.length || raw.length > 80 * 1024 * 1024) throw Error(`Unsupported TXT size: ${name}`);
  const hash = createHash('sha256').update(raw).digest('hex'); const version = hash.slice(0, 16);
  let meta = metadata.find(m => m.name === name);
  if (!meta) { meta = { id: randomBytes(18).toString('base64url'), name, secret: randomBytes(32).toString('base64url') }; metadata.push(meta); }
  const path = `public/stream/${meta.id}-${version}.jds`;
  const cacheFile = `.tools/stream-books/${meta.id}.json`;
  if (meta.streamHash === hash && await stat(path).catch(() => null)) {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
    await writeFile(`public/stream/${meta.id}.jdx`, seal(Buffer.from(JSON.stringify(cached)), meta.secret, `JDB1:${meta.id}`));
    books.push(cached); continue;
  }
  const decoded = await decodeFile(new Blob([raw])); const parsed = parseText(decoded.text, name, decoded.encoding);
  if (parsed.chapters.map(c => c.text).join('') !== decoded.text) throw Error(`Text preservation failed: ${name}`);
  let offset = 0;
  const chunks = parsed.chapters.map(c => seal(Buffer.from(c.text, 'utf8'), meta.secret, `JDC1:${meta.id}:${version}:${c.index}`));
  const chapters = parsed.chapters.map(({ text, ...c }, i) => { const info = { ...c, remoteOffset: offset, remoteSize: chunks[i].length }; offset += chunks[i].length; return info; });
  // Relative chapter offsets let the encrypted manifest length be determined without a fixed-point loop.
  const manifest = { sourceId: meta.id, title: parsed.title, author: parsed.author, size: raw.length, encoding: decoded.encoding, length: parsed.length, chapters, remote: { id: meta.id, secret: meta.secret, version, dataStart: 0, totalSize: 0 } };
  // The manifest does not need its own size fields; the pack header determines these after decrypting.
  const inner = { ...manifest, remote: { id: meta.id, version } };
  const encryptedIndex = seal(Buffer.from(JSON.stringify(inner)), meta.secret, `JDM1:${meta.id}:${version}`);
  const header = Buffer.alloc(8); header.write('JDS1'); header.writeUInt32BE(encryptedIndex.length, 4);
  manifest.remote.dataStart = 8 + encryptedIndex.length; manifest.remote.totalSize = manifest.remote.dataStart + offset;
  await writeFile(path, Buffer.concat([header, encryptedIndex, ...chunks]));
  await writeFile(`public/stream/${meta.id}.jdx`, seal(Buffer.from(JSON.stringify(manifest)), meta.secret, `JDB1:${meta.id}`));
  meta.streamHash = hash; meta.streamFile = path; meta.format = meta.file ? meta.format : 'stream'; if (!meta.file) meta.file = path;
  await writeFile(`.tools/private-books/${meta.id}.json`, JSON.stringify(meta, null, 2)); await writeFile(cacheFile, JSON.stringify(manifest));
  books.push(manifest); report.push({ title: parsed.title, author: parsed.author, encoding: decoded.encoding, sections: chapters.length, bytes: manifest.remote.totalSize, file: path });
}
const privateFile = '.tools/remote-library.json';
let access;
try { access = JSON.parse(await readFile(privateFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; access = { id: randomBytes(18).toString('base64url'), secret: randomBytes(32).toString('base64url') }; }
const payload = Buffer.from(JSON.stringify({ format: 'jingdu-stream-library', version: 1, books }));
const file = `public/stream/${access.id}.jdi`;
await writeFile(file, seal(payload, access.secret, `JDL1:${access.id}`));
await writeFile(privateFile, JSON.stringify({ ...access, file, link: `https://dingrui-123.github.io/jingdu-reader/#shelf/${access.id}/${access.secret}`, count: books.length }, null, 2));
console.log(JSON.stringify({ books: books.length, catalogPlainBytes: payload.length, report, privateLinkSavedTo: privateFile }, null, 2));
