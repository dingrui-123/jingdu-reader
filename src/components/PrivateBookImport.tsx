import { useEffect, useRef, useState } from 'react';
import { importBook, listBooks, mergeRemoteBooks } from '../lib/db';
import { readPrivateLinks } from '../lib/private-book';
import { fetchBookSource } from '../lib/remote';
import type { Book, Parsed } from '../types';
import { Modal } from './Modal';
import { Icon } from './Icon';

export function PrivateBookImport({ hash, onReady, onClose }: { hash: string; onReady: (books: Book[], collection: boolean) => void; onClose: () => void }) {
  const [stage, setStage] = useState('正在打开私人藏书…');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [step, setStep] = useState('');
  const collection = hash.startsWith('#collection/');
  const readyCallback = useRef(onReady); readyCallback.current = onReady;
  useEffect(() => {
    const abort = new AbortController(); let worker: Worker | undefined; let cancelled = false;
    const run = async () => {
      setError(''); setStage('正在打开私人藏书…'); setProgress(0); setSaving(false);
      try {
        const links = readPrivateLinks(hash);
        if (!links) throw new Error('私人阅读链接不完整，请使用包含 # 后内容的完整链接。');
        const saved = await listBooks(); const ready: Book[] = [];
        for (const [index, link] of links.entries()) {
          setStep(links.length > 1 ? `第 ${index + 1} / ${links.length} 本` : ''); setProgress(0); setSaving(false);
          const existing = saved.find(book => book.sourceId === link.id);
          if (cancelled) return;
          if (existing?.remote || (existing && !navigator.onLine)) { ready.push(existing); continue; }
          if (!navigator.onLine) throw new Error('这台设备还没有保存这本书，首次打开需要联网。');
          setStage('正在连接在线目录，不下载整本正文…');
          const remote = await fetchBookSource(link, abort.signal);
          if (cancelled) return;
          if (remote) { const [book] = await mergeRemoteBooks([remote]); ready.push(book); continue; }
          if (existing) { ready.push(existing); continue; }
          setStage('首次打开，正在下载加密书籍…');
          const response = await fetch(`${import.meta.env.BASE_URL}shared/${link.id}.jdb`, { signal: abort.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
          if (!response.ok) throw new Error('暂时无法下载这本书，请检查网络后重试。');
          if (Number(response.headers.get('content-length')) > 81 * 1024 * 1024) throw new Error('书籍文件超过首版支持的大小。');
          // Stream the response for progress feedback and enforce the limit even without Content-Length.
          const reader = response.body?.getReader();
          const parts: Uint8Array<ArrayBuffer>[] = []; let received = 0;
          if (!reader) throw new Error('当前浏览器不支持书籍下载，请更新 Safari 后重试。');
          const total = Number(response.headers.get('content-length'));
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            received += chunk.value.byteLength;
            if (received > 81 * 1024 * 1024) { await reader.cancel(); throw new Error('书籍文件超过支持的大小。'); }
            parts.push(chunk.value);
            if (!cancelled) { setProgress(total > 0 ? Math.min(14, Math.round(received / total * 14)) : 5); setStage(`正在下载加密书籍… ${(received / 1024 / 1024).toFixed(1)} MB`); }
          }
          const buffer = await new Blob(parts).arrayBuffer();
          if (cancelled) return;
          worker = new Worker(new URL('../workers/private-book.worker.ts', import.meta.url), { type: 'module' });
          const decoded = await new Promise<{ parsed: Parsed; size: number }>((resolve, reject) => {
            worker!.onerror = () => reject(new Error('后台解密程序未能启动，请刷新应用后重试。'));
            worker!.onmessage = ({ data }) => {
              if (data.error) reject(new Error(data.error));
              else if (data.parsed) resolve(data);
              else if (!cancelled) { setProgress(data.progress); setStage(data.stage); }
            };
            worker!.postMessage({ buffer, secret: link.secret }, [buffer]);
          });
          worker.terminate();
          if (cancelled) return;
          setSaving(true); setStage('正在保存到这台设备，之后可离线阅读…');
          const book = await importBook(decoded.parsed, decoded.size, n => { if (!cancelled) setProgress(80 + Math.round(n * .2)); }, link.id);
          ready.push(book);
          if (cancelled) return;
        }
        if (!cancelled) readyCallback.current(ready, collection);
      } catch (e) { if (!cancelled) { setError(e instanceof Error ? e.message : '私人藏书打开失败。'); setSaving(false); } }
    };
    void run();
    return () => { cancelled = true; abort.abort(); worker?.terminate(); };
  }, [hash, retry]);
  return <Modal title={collection ? '导入私人书架' : '打开私人藏书'} busy={saving} onClose={onClose}>
    <div className="private-book-message"><Icon name="shield" size={32}/><p className="muted">{collection ? '逐本连接在线目录，正文按章加载。已有离线书籍及进度保留；旧格式书籍仍需完整保存，中断后可重试。' : '优先连接在线目录，正文按章加载。旧格式书籍需首次完整保存。已有书籍和进度会保留。'}</p></div>
    {step && <p className="caption">{step}</p>}
    {error ? <><p role="alert" className="error">{error}</p><button className="primary full" onClick={() => setRetry(n => n + 1)}>重试</button></> : <div role="status"><p className="caption">{stage}</p><progress value={progress} max="100"/><p className="caption">{progress}% · 首次保存请保持页面打开</p></div>}
    <p className="caption">完整链接相当于这本书的钥匙，请勿公开转发。阅读进度保存在当前设备，不会自动同步。</p>
  </Modal>;
}
