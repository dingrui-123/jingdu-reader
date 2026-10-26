import { useEffect, useRef, useState } from 'react';
import type { Book } from '../types';
import { downloadOffline, clearReadingCache } from '../lib/remote';
import { releaseOffline } from '../lib/db';
export function BookStorageActions({ book, onBusy, onChanged }: { book: Book; onBusy: (busy: boolean) => void; onChanged: () => Promise<void> }) {
  const [progress, setProgress] = useState<number>(); const [error, setError] = useState(''); const abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => { abort.current?.abort(); }, []);
  if (!book.remote) return <p className="caption">本地导入的书籍，已保存完整正文。</p>;
  const offline = book.storage === 'offline';
  return <section><p className="caption">{offline ? '已整本离线保存 · 可断网阅读' : '在线按章加载 · 阅读正文不写入长期存储'}<br/>整本下载约 {(book.remote.totalSize / 1e6).toFixed(1)} MB；离线正文解压后会占用更多空间。</p>{progress !== undefined ? <><p role="status" className="caption">正在下载并保存离线正文：{progress}%</p><progress value={progress} max="100"/><button className="secondary full" onClick={() => abort.current?.abort()}>取消下载</button></> : <div className="data-actions"><button className="secondary" disabled={offline} onClick={async () => {
    const controller = new AbortController(); abort.current = controller; setError(''); setProgress(0); onBusy(true);
    try { await downloadOffline(book, setProgress, controller.signal); } catch (e) { setError(controller.signal.aborted ? '已取消下载。已保存的部分可在下次下载时覆盖，或移除以释放空间。' : String(e)); }
    finally { setProgress(undefined); onBusy(false); await onChanged(); }
  }}>{offline ? '已下载整本' : '下载整本离线'}</button><button className="secondary" onClick={async () => {
    if (!confirm('移除这本书的离线正文以释放空间？阅读进度、书签和在线目录会保留，联网可重新下载。')) return;
    setError(''); onBusy(true); try { await releaseOffline(book.id); clearReadingCache(); await onChanged(); } catch (e) { setError(String(e)); } finally { onBusy(false); }
  }}>移除离线正文</button></div>}{error && <p className="error" role="alert">{error}</p>}</section>;
}
