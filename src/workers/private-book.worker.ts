import { decryptPrivateBook } from '../lib/private-book';
import { decodeFile, parseText } from '../lib/parser';
self.onmessage = async ({ data }: MessageEvent<{ buffer: ArrayBuffer; secret: string }>) => {
  try {
    self.postMessage({ progress: 15, stage: '正在解密私人藏书…' });
    const { name, file } = await decryptPrivateBook(data.buffer, data.secret);
    const decoded = await decodeFile(file, 'auto', n => self.postMessage({ progress: 20 + Math.round(n * .6), stage: '正在整理书页与目录…' }));
    const parsed = parseText(decoded.text, name, decoded.encoding);
    self.postMessage({ parsed, size: file.size });
  } catch (e) { self.postMessage({ error: e instanceof Error ? e.message : '私人藏书打开失败。' }); }
};
