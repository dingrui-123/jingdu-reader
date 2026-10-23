import { useEffect, useRef, useState } from 'react';
import type { Parsed } from '../types';
import { importBook } from '../lib/db';
import { Modal } from './Modal';
import { Icon } from './Icon';

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File>();
  const [encoding, setEncoding] = useState('auto');
  const [parsed, setParsed] = useState<Parsed>();
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  function parse(selected: File, selectedEncoding: string) {
    worker.current?.terminate(); setParsed(undefined); setError(''); setFile(selected);
    if (!/\.txt$/i.test(selected.name)) { setError('请选择 TXT 文件；EPUB 将在后续版本支持。'); setProgress(undefined); return; }
    if (selected.size > 80 * 1024 * 1024) { setError('首版支持 80 MB 以内的 TXT 文件。请先拆分更大的文件。'); setProgress(undefined); return; }
    setProgress(0);
    try {
      const w = new Worker(new URL('../workers/import.worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      w.onmessage = ({ data }) => {
        if (data.error) { setError(data.error + ' 可尝试切换编码。'); setProgress(undefined); w.terminate(); }
        else if (data.parsed) { setParsed(data.parsed); setProgress(undefined); w.terminate(); }
        else setProgress(data.progress);
      };
      w.onerror = () => { setError('解析程序未能启动，请刷新后重试。'); setProgress(undefined); w.terminate(); };
      w.postMessage({ file: selected, encoding: selectedEncoding });
    } catch { setError('当前浏览器不支持后台文件解析，请更新浏览器。'); setProgress(undefined); }
  }
  return <Modal title="把故事带进书房" busy={saving} onClose={onClose}>
    <p className="muted">选择自己的 TXT 小说。文件只在这台设备上处理。</p>
    <label className="drop-zone"><Icon name="upload" size={30}/><strong>{file?.name ?? '选择 TXT 文件'}</strong><span>支持 UTF-8、GB18030 和带 BOM 的 UTF-16 · 最大 80 MB</span><input type="file" accept=".txt,text/plain" aria-label="选择 TXT 文件" disabled={saving} onChange={e => { if (e.target.files?.[0]) parse(e.target.files[0], encoding); }}/></label>
    <label className="field">文字编码<select value={encoding} disabled={saving} onChange={e => { setEncoding(e.target.value); if (file) parse(file, e.target.value); }}><option value="auto">自动识别（推荐）</option><option value="utf-8">UTF-8</option><option value="gb18030">GB18030 / GBK</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label>
    {progress !== undefined && <div role="status"><p>正在后台解析… {progress}%</p><progress value={progress} max="100"/></div>}
    {error && <p className="error" role="alert">{error}</p>}
    {parsed && <div className="import-preview">
      <div className="preview-facts"><span>{(file!.size / 1024 / 1024).toFixed(2)} MB</span><span>{parsed.chapters.length.toLocaleString()} 个阅读节</span><span>{parsed.encoding.toUpperCase()}</span></div>
      <label className="field">书名<input value={parsed.title} disabled={saving} maxLength={150} onChange={e => setParsed({ ...parsed, title: e.target.value })}/></label>
      <label className="field">作者（可选）<input value={parsed.author} disabled={saving} maxLength={100} onChange={e => setParsed({ ...parsed, author: e.target.value })}/></label>
      <p className="text-preview">{parsed.chapters[0]?.text.slice(0, 260)}</p>
      <p className="caption">请检查文字是否正常。长章节会拆成阅读节，正文内容完整保留。</p>
      <button className="primary full" disabled={saving || !parsed.title.trim()} onClick={async () => {
        setSaving(true); setError('');
        try { await importBook(parsed, file!.size, setSaveProgress); onImported(); }
        catch (e) { setError(`保存失败：${e instanceof Error ? e.message : '请检查本地空间。'}`); setSaving(false); }
      }}>{saving ? `正在存入书架… ${saveProgress}%` : '加入书架' }<Icon name="arrow" size={16}/></button>
    </div>}
  </Modal>;
}
