import { useEffect, useRef, useState } from 'react';
import { readShelfLink } from '../lib/remote-format';
import { syncLibrary } from '../lib/remote';
import { Modal } from './Modal';
export function RemoteLibraryImport({ hash, onReady, onClose }: { hash: string; onReady: (count: number) => void; onClose: () => void }) {
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const callback = useRef(onReady); callback.current = onReady;
  useEffect(() => {
    const abort = new AbortController(); setError('');
    const access = readShelfLink(hash);
    if (!access) { setError('私人书架链接不完整。'); return; }
    void syncLibrary(access, abort.signal).then(books => { if (!abort.signal.aborted) callback.current(books.length); }).catch(e => { if (!abort.signal.aborted) setError(String(e)); });
    return () => abort.abort();
  }, [hash, retry]);
  return <Modal title="连接在线书架" onClose={onClose}><p className="muted">只保存书籍目录和阅读进度，正文按章在线加载。需要离线时，可在书籍详情下载整本。</p>{error ? <><p className="error" role="alert">{error}</p><button className="primary full" onClick={() => setRetry(n => n + 1)}>重试</button></> : <p role="status" className="caption">正在连接私人书架，获取目录…</p>}<p className="caption">已有离线书籍和进度会保留。以后联网打开书架时，会检查新增书籍。完整链接和备份包含解密钥匙，请妥善保管。</p></Modal>;
}
