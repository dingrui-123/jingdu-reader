import { decodeFile, parseText } from '../lib/parser';
self.onmessage = async ({ data }: MessageEvent<{ file: File; encoding: string }>) => {
  try {
    const result = await decodeFile(data.file, data.encoding, progress => self.postMessage({ progress }));
    self.postMessage({ parsed: parseText(result.text, data.file.name, result.encoding) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : '无法解析文件，请手动选择编码重试。' }); }
};
