import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Book, Bookmark, Chapter, Position, Settings } from '../types';
import { getChapter, saveBook, saveBookmark } from '../lib/db';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { ReadingSettings } from './Settings';

export function Reader({ book, initialPosition, settings, onSettings, onClose, onMarksChanged }: {
  book: Book; initialPosition?: Position; settings: Settings; onSettings: (s: Settings) => void; onClose: () => void; onMarksChanged: () => void;
}) {
  const [index, setIndex] = useState((initialPosition ?? book.position).chapter);
  const [chapter, setChapter] = useState<Chapter>();
  const [menu, setMenu] = useState(true);
  const [panel, setPanel] = useState<'toc' | 'settings' | null>(null);
  const [search, setSearch] = useState(''); const [limit, setLimit] = useState(80);
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [progress, setProgress] = useState((initialPosition ?? book.position).progress);
  const scroller = useRef<HTMLDivElement>(null);
  const current = useRef<Book>({ ...book, position: initialPosition ?? book.position, lastRead: Date.now() });
  const pending = useRef<Position | null>(initialPosition ?? book.position);
  const ready = useRef(false); const dirty = useRef(true); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const changedSettings = useRef<Position | null>(null);
  const write = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (!dirty.current) return;
    dirty.current = false;
    void saveBook({ ...current.current }).catch(e => { dirty.current = true; setError('进度保存失败：' + String(e)); });
  }, []);
  function capture() {
    const root = scroller.current;
    if (!root || !ready.current || !chapter) return current.current.position;
    const blocks = root.querySelectorAll<HTMLElement>('[data-offset]');
    const line = root.getBoundingClientRect().top + 84;
    let anchor: HTMLElement | undefined;
    for (const element of blocks) {
      if (element.getBoundingClientRect().top <= line) anchor = element;
      else break;
    }
    const rect = anchor?.getBoundingClientRect();
    const offset = Number(anchor?.dataset.offset ?? 0);
    const fraction = rect ? Math.max(0, Math.min(1, (line - rect.top) / Math.max(1, rect.height))) : 0;
    const length = Number(anchor?.dataset.length ?? 0);
    const atBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 4;
    const overall = atBottom ? (chapter.start + chapter.length) / book.length : (chapter.start + offset + length * fraction) / book.length;
    const position = { chapter: index, offset, fraction, progress: Math.max(0, Math.min(1, overall)) };
    current.current = { ...current.current, position, lastRead: Date.now() };
    dirty.current = true;
    return position;
  }
  function restore(position: Position) {
    const root = scroller.current;
    if (!root) return;
    const blocks = [...root.querySelectorAll<HTMLElement>('[data-offset]')];
    const target = blocks.find(element => Number(element.dataset.offset) === position.offset) ?? [...blocks].reverse().find(element => Number(element.dataset.offset) <= position.offset);
    root.scrollTop = 0;
    if (target && (position.offset > 0 || position.fraction > 0)) {
      const rect = target.getBoundingClientRect();
      root.scrollTop += rect.top - root.getBoundingClientRect().top - 84 + rect.height * position.fraction;
    }
  }
  useEffect(() => {
    let active = true; ready.current = false; setChapter(undefined); setError('');
    void getChapter(book.id, index).then(value => {
      if (!active) return;
      if (!value) { setError('这一节的本地数据丢失，请从备份恢复。'); return; }
      setChapter(value);
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [book.id, index]);
  useLayoutEffect(() => {
    if (!chapter) return;
    restore(pending.current ?? { chapter: index, offset: 0, fraction: 0, progress: progress });
    pending.current = null; ready.current = true;
    const position = capture(); setProgress(position.progress); write();
  }, [chapter]);
  useLayoutEffect(() => {
    if (changedSettings.current) { restore(changedSettings.current); changedSettings.current = null; }
  }, [settings]);
  const captureRef = useRef(capture); captureRef.current = capture;
  useEffect(() => {
    const flush = () => { if (ready.current) captureRef.current(); write(); };
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', visibility);
    return () => { flush(); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', visibility); };
  }, [write]);
  useEffect(() => {
    const resized = () => { if (ready.current) restore(current.current.position); };
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, [chapter]);
  function go(next: number) {
    if (next < 0 || next >= book.chapterCount || next === index || !ready.current) return;
    capture(); write(); ready.current = false;
    const position = { chapter: next, offset: 0, fraction: 0, progress: book.chapters[next].start / book.length };
    current.current = { ...current.current, position, lastRead: Date.now() }; dirty.current = true; write();
    pending.current = position; setIndex(next); setPanel(null); setProgress(position.progress); setMenu(true);
  }
  const paragraphs = useMemo(() => {
    let offset = 0;
    return chapter?.text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(line => line.length).map(line => {
      const start = offset; offset += line.length;
      return <p key={start} data-offset={start} data-length={line.length}>{line.replace(/[\r\n]+$/, '') || '\u00a0'}</p>;
    }) ?? [];
  }, [chapter]);
  const results = useMemo(() => book.chapters.filter(c => c.title.toLowerCase().includes(search.toLowerCase())), [book.chapters, search]);
  return <div className={`reader theme-${settings.theme}`}>
    <header className={`reader-toolbar ${menu ? '' : 'hidden'}`} inert={!menu}>
      <button className="text-button" onClick={() => { capture(); write(); onClose(); }}><Icon name="back"/><span>书架</span></button>
      <div className="reader-book-name"><strong>{book.title}</strong><small>{chapter?.title ?? '正在打开…'}</small></div>
      <div className="toolbar-actions"><button className="icon-button" aria-label="添加书签" disabled={!chapter} onClick={async () => {
        const position = capture(); write();
        const mark: Bookmark = { id: crypto.randomUUID(), bookId: book.id, title: chapter!.title, snippet: chapter!.text.slice(position.offset, position.offset + 90).trim(), position, createdAt: Date.now() };
        try { await saveBookmark(mark); onMarksChanged(); setMessage('书签已保存'); setTimeout(() => setMessage(''), 2200); } catch (e) { setError('书签保存失败：' + String(e)); }
      }}><Icon name="bookmark"/></button><button className="icon-button" aria-label="阅读设置" onClick={() => setPanel('settings')}><span className="aa">Aa</span></button><button className="icon-button" aria-label="章节目录" onClick={() => { setPanel('toc'); setLimit(80); }}><Icon name="list"/></button></div>
    </header>
    <div ref={scroller} className="reading-scroll" onScroll={() => {
      if (!ready.current) return;
      capture();
      if (!timer.current) timer.current = setTimeout(() => { timer.current = undefined; setProgress(current.current.position.progress); write(); }, 600);
    }} onClick={e => { if (!(e.target as HTMLElement).closest('button,a,input') && !window.getSelection()?.toString()) setMenu(m => !m); }}>
      <article className="reading-article" style={{ '--reader-size': `${settings.fontSize}px`, '--reader-line': settings.lineHeight, '--reader-gap': `${settings.paragraphGap}px`, '--reader-margin': `${settings.margin}px` } as CSSProperties}>
        <div className="chapter-kicker">{book.title} · {index + 1} / {book.chapterCount}</div>
        <h1>{chapter?.title ?? '正在打开书页…'}</h1>
        {paragraphs}
        {chapter && <div className="chapter-navigation"><button className="secondary" disabled={index === 0} onClick={() => go(index - 1)}><Icon name="back" size={16}/>上一节</button><span>{index === book.chapterCount - 1 ? '全书完 · 感谢这段相伴' : '把故事再翻一页'}</span><button className="secondary" disabled={index === book.chapterCount - 1} onClick={() => go(index + 1)}>下一节<Icon name="arrow" size={16}/></button></div>}
        {error && <p className="error" role="alert">{error}</p>}
      </article>
    </div>
    <button className={`reader-menu-trigger ${menu ? 'hidden' : ''}`} aria-label="显示阅读菜单" onClick={() => setMenu(true)}><Icon name="more"/></button>
    <footer className={`reader-footer ${menu ? '' : 'hidden'}`} inert={!menu}><button className="text-button" disabled={index === 0 || !chapter} onClick={() => go(index - 1)}><Icon name="back" size={16}/>上一节</button><span>{(progress * 100).toFixed(1)}%<small>已读</small></span><button className="text-button" disabled={index === book.chapterCount - 1 || !chapter} onClick={() => go(index + 1)}>下一节<Icon name="arrow" size={16}/></button></footer>
    {message && <div className="toast" role="status"><Icon name="check"/>{message}</div>}
    {panel === 'settings' && <Modal title="让阅读更合心意" onClose={() => setPanel(null)}><ReadingSettings settings={settings} onChange={s => { changedSettings.current = capture(); write(); onSettings(s); }}/><p className="caption">轻点正文可以收起或唤出菜单。</p></Modal>}
    {panel === 'toc' && <Modal title="章节目录" onClose={() => setPanel(null)}><label className="search-box"><Icon name="search"/><input aria-label="搜索章节" placeholder="搜索章节名称" value={search} onChange={e => { setSearch(e.target.value); setLimit(80); }}/></label><p className="caption">共 {book.chapterCount.toLocaleString()} 个阅读节 · 当前第 {index + 1} 节</p>{!search && index >= 80 && <button className="secondary full" onClick={() => { setSearch(book.chapters[index].title); setLimit(80); }}>定位当前阅读节</button>}<div className="toc-list">{results.slice(0, limit).map(c => <button key={c.index} className={index === c.index ? 'active' : ''} onClick={() => { if (index === c.index) setPanel(null); else go(c.index); }}><span>{c.index + 1}</span>{c.title}{index === c.index && <Icon name="book" size={16}/>}</button>)}{!results.length && <p className="muted">没有找到对应章节。</p>}</div>{results.length > limit && <button className="secondary full" onClick={() => setLimit(l => l + 80)}>再显示 80 节（剩余 {results.length - limit}）</button>}</Modal>}
  </div>;
}
