import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Book } from '../types';
import { Icon } from './Icon';
const ROW = 52;
export function ChapterDirectory({ book, index, onSelect }: { book: Book; index: number; onSelect: (n: number) => void }) {
  const [search, setSearch] = useState(''); const [offset, setOffset] = useState(0); const [height, setHeight] = useState(400);
  const [target, setTarget] = useState(index); const [center, setCenter] = useState(0); const [jump, setJump] = useState(String(index + 1));
  const viewport = useRef<HTMLDivElement>(null);
  const results = useMemo(() => book.chapters.filter(c => c.title.toLowerCase().includes(search.toLowerCase())), [book.chapters, search]);
  useLayoutEffect(() => {
    const root = viewport.current; if (!root) return;
    const resize = () => setHeight(root.clientHeight);
    resize(); const observer = new ResizeObserver(resize); observer.observe(root); return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const root = viewport.current; if (!root || root.clientHeight === 0) return;
    const row = results.findIndex(c => c.index === target);
    root.scrollTop = Math.max(0, row * ROW - root.clientHeight / 2 + ROW / 2); setOffset(root.scrollTop);
  }, [center, target, height]);
  const first = Math.max(0, Math.floor(offset / ROW) - 5);
  const last = Math.min(results.length, first + Math.ceil(height / ROW) + 12);
  return <><label className="search-box"><Icon name="search"/><input aria-label="搜索章节" placeholder="搜索章节名称" value={search} onChange={e => { setSearch(e.target.value); if (viewport.current) viewport.current.scrollTop = 0; setOffset(0); }}/></label>
    <p className="caption">共 {book.chapterCount.toLocaleString()} 个阅读节 · 当前第 {index + 1} 节 · 可直接滚动查看相邻章节</p>
    <div className="toc-tools"><button className="secondary" onClick={() => { setSearch(''); setTarget(index); setCenter(n => n + 1); }}>定位当前阅读节</button><form onSubmit={e => { e.preventDefault(); const n = Number(jump); if (!Number.isInteger(n) || n < 1 || n > book.chapterCount) return; setSearch(''); setTarget(n - 1); setCenter(v => v + 1); }}><input type="number" min="1" max={book.chapterCount} value={jump} onChange={e => setJump(e.target.value)} aria-label="目录节号"/><button className="secondary" type="submit">转到目录位置</button></form></div>
    <div className="toc-viewport" ref={viewport} tabIndex={0} role="region" aria-label="快速章节目录" onScroll={e => setOffset(e.currentTarget.scrollTop)}>
      <div className="toc-list" style={{ height: results.length * ROW, margin: 0, position: 'relative' }}>{results.slice(first, last).map((c, i) => <button key={c.index} aria-label={`第${c.index + 1}节 ${c.title}`} aria-current={index === c.index ? 'true' : undefined} className={index === c.index ? 'active' : ''} style={{ position: 'absolute', top: (first + i) * ROW, height: ROW, width: '100%', overflow: 'hidden' }} title={c.title} onClick={() => onSelect(c.index)}><span>{c.index + 1}</span><strong className="toc-title">{c.title}</strong>{index === c.index && <Icon name="book" size={16}/>}</button>)}</div>
      {!results.length && <p className="muted">没有找到对应章节。</p>}
    </div></>;
}
