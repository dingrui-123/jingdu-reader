import { useEffect, useRef, useState } from 'react';
import type { Book, Bookmark, Position, Settings } from './types';
import { defaults } from './types';
import * as db from './lib/db';
import { Icon } from './components/Icon';
import { Modal } from './components/Modal';
import { ImportDialog } from './components/ImportDialog';
import { ReadingSettings } from './components/Settings';
import { Reader } from './components/Reader';
import { PrivateBookImport } from './components/PrivateBookImport';
import { useRegisterSW } from 'virtual:pwa-register/react';

function Cover({ book, small = false }: { book: Book; small?: boolean }) {
  const palette = [...book.title].reduce((n, c) => n + c.charCodeAt(0), 0) % 5;
  return <div aria-hidden="true" className={`book-cover palette-${palette} ${small ? 'small' : ''}`}><div className="cover-top">静 读 藏 书</div><div className="cover-lines"/><strong>{book.title}</strong><span>{book.author || '私人珍藏'}</span><Icon name="leaf" size={small ? 22 : 34}/><div className="cover-bottom">JINGDU LIBRARY</div></div>;
}
export default function App() {
  const [books, setBooks] = useState<Book[]>([]); const [marks, setMarks] = useState<Bookmark[]>([]);
  const [settings, setSettings] = useState<Settings>(defaults);
  const [view, setView] = useState<'library' | 'marks' | 'settings'>('library');
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [importing, setImporting] = useState(false); const [detail, setDetail] = useState<Book>();
  const [active, setActive] = useState<{ book: Book; position?: Position }>();
  const [routeHash, setRouteHash] = useState(location.hash);
  const [query, setQuery] = useState(''); const [sort, setSort] = useState('recent');
  const [online, setOnline] = useState(navigator.onLine); const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(''); const [persisted, setPersisted] = useState<boolean | null>(null);
  const [restore, setRestore] = useState<import('./types').Backup>();
  const restoreInput = useRef<HTMLInputElement>(null);
  const { needRefresh: [needRefresh], offlineReady: [offlineReady], updateServiceWorker } = useRegisterSW({ onRegisterError(e) { setError('离线资源注册失败：' + String(e)); } });
  async function refresh() { const [b, m] = await Promise.all([db.listBooks(), db.listBookmarks()]); setBooks(b); setMarks(m); }
  useEffect(() => {
    Promise.all([refresh(), db.getSettings().then(setSettings)]).catch(e => setError(String(e))).finally(() => setLoading(false));
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
    const status = () => setOnline(navigator.onLine);
    window.addEventListener('online', status); window.addEventListener('offline', status);
    const focus = () => { if (!active) void refresh().catch(e => setError(String(e))); };
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('online', status); window.removeEventListener('offline', status); window.removeEventListener('focus', focus); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = settings.theme; }, [settings.theme]);
  function changeSettings(s: Settings) { setSettings(s); void db.saveSettings(s).catch(e => setError('设置保存失败：' + String(e))); }
  function open(book: Book, position?: Position) { setActive({ book, position }); location.hash = `read/${book.id}`; }
  useEffect(() => {
    const sync = (event?: Event) => {
      setRouteHash(location.hash);
      const id = location.hash.match(/^#read\/(.+)$/)?.[1];
      if (!id) { if (active) setActive(undefined); if (event) void refresh().catch(e => setError(String(e))); }
      else if (!active && !loading) { const book = books.find(b => b.id === id); if (book) setActive({ book }); else location.hash = ''; }
    };
    sync(); window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [loading, books, active]);
  async function backup() {
    setBusy(true); setError('');
    try {
      const data = await db.exportBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `静读备份-${new Date().toISOString().slice(0, 10)}.jingdu.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice('备份文件已生成，请在下载或“文件”中确认保存。');
    } catch (e) { setError('备份失败：' + String(e)); } finally { setBusy(false); }
  }
  const sorted = [...books].filter(b => b.title.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : sort === 'added' ? b.createdAt - a.createdAt : b.lastRead - a.lastRead || b.createdAt - a.createdAt);
  const recent = [...books].sort((a, b) => b.lastRead - a.lastRead || b.createdAt - a.createdAt)[0];
  const readCount = books.filter(b => b.lastRead > 0).length;
  if (active) return <Reader key={active.book.id} book={active.book} initialPosition={active.position} settings={settings} onSettings={changeSettings} onClose={() => { setActive(undefined); location.hash = ''; void refresh().catch(e => setError(String(e))); }} onMarksChanged={() => { void db.listBookmarks().then(setMarks).catch(e => setError(String(e))); }}/ >;
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#" onClick={() => setView('library')}><span className="brand-icon"><Icon name="book" size={23}/></span><span>静读<small>JINGDU</small></span></a><p className="sidebar-label">属于你的阅读时光</p>
      <nav aria-label="主导航">{([['library', 'grid', '我的书架'], ['marks', 'bookmark', '我的书签'], ['settings', 'settings', '阅读与数据']] as const).map(([v, icon, label]) => <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}><Icon name={icon}/><span>{label}</span>{v === 'library' && <small>{books.length}</small>}</button>)}</nav>
      <div className="sidebar-note"><Icon name="leaf" size={26}/><p>不必赶路，<br/>在文字里停留一会儿。</p><span>READ AT YOUR OWN PACE</span></div>
      <div className="local-badge"><Icon name="shield" size={17}/><span>只属于你的本地书房</span><i/></div>
    </aside>
    <main className="workspace"><header className="topbar"><span>私人书房 <span className="slash">/</span> {view === 'library' ? '我的书架' : view === 'marks' ? '我的书签' : '阅读与数据'}</span><div className="connection"><span className={`status-dot ${online ? '' : 'offline'}`}/>{online ? offlineReady ? '已就绪，可离线阅读' : '本地存储' : '离线阅读中'}<Icon name="shield" size={15}/></div></header>
      {error && <div className="alert" role="alert">{error}<button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><Icon name="close" size={16}/></button></div>}
      {notice && <div className="notice" role="status">{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={16}/></button></div>}
      {needRefresh && <div className="notice">新版本已经准备好。阅读进度将保留。<button className="secondary" onClick={() => { void updateServiceWorker(true); }}>更新应用</button></div>}
      {view === 'library' && <>
        <div className="page-heading"><div><p className="eyebrow">A LITTLE SPACE, A THOUSAND STORIES</p><h1>我的书架<span className="title-dot">.</span></h1><p className="muted">让世界慢下来，从翻开一本书开始。</p></div><button className="primary" onClick={() => setImporting(true)} disabled={loading}><Icon name="plus" size={18}/>导入书籍</button></div>
        {recent ? <section className="continue-card"><div className="continue-copy"><span className="eyebrow"><span className="tiny-line"/>{recent.lastRead ? '继续上次的旅程' : '一本新书，一段新旅程'}</span><h2>{recent.title}</h2><p>{recent.author || '私人藏书'}<span>·</span>{recent.chapters[recent.position.chapter]?.title}</p><div className="continue-progress"><div className="progress-track"><i style={{ width: `${recent.position.progress * 100}%` }}/></div><span>已读 {(recent.position.progress * 100).toFixed(1)}%</span></div><button className="continue-button" onClick={() => open(recent)}>{recent.lastRead ? '继续阅读' : '开始阅读'}<Icon name="arrow" size={16}/></button></div><div className="hero-cover"><Cover book={recent} small/></div><div className="hero-arc"/></section> : <section className="welcome-card"><div><span className="eyebrow"><span className="tiny-line"/>为好故事留一个位置</span><h2>一方书房，<br/>万千世界。</h2><p>带上你喜欢的文字。<br/>这里没有打扰，只有你和下一页。</p><button className="text-button accent" onClick={() => setImporting(true)}>导入第一本书<Icon name="arrow" size={16}/></button></div><div className="welcome-art" aria-hidden="true"><div className="art-sun"/><div className="art-book b1"/><div className="art-book b2"/><div className="art-book b3"/><div className="art-shelf"/><span>THE JOY OF GETTING LOST<br/>IN A GOOD BOOK.</span></div></section>}
        <section className="library-section"><div className="section-toolbar"><div className="section-title"><h2>全部书籍</h2><span>{books.length} 本藏书</span></div><div className="library-tools"><label className="search-box"><Icon name="search" size={17}/><input aria-label="搜索书名" placeholder="搜索书名" value={query} onChange={e => setQuery(e.target.value)}/></label><select aria-label="书籍排序" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">最近阅读</option><option value="added">最近添加</option><option value="title">书名排序</option></select></div></div>
          {loading ? <div className="empty-state" role="status">正在打开你的书房…</div> : <div className="books-grid">{sorted.map(book => <article className="book-card" key={book.id}><button className="cover-button" aria-label={`阅读 ${book.title}`} onClick={() => open(book)}><Cover book={book}/></button><div className="book-info"><div><button className="book-title" onClick={() => open(book)}>{book.title}</button><p>{book.author || '作者未填写'}</p></div><button className="icon-button" aria-label={`${book.title}的详情`} onClick={() => setDetail(book)}><Icon name="more" size={18}/></button></div><div className="book-progress"><span>{book.lastRead ? `已读 ${(book.position.progress * 100).toFixed(1)}%` : '尚未翻开'}</span><small>{book.lastRead ? new Date(book.lastRead).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : 'TXT'}</small></div><div className="progress-track"><i style={{ width: `${book.position.progress * 100}%` }}/></div></article>)}{!query && <button className="add-book" onClick={() => setImporting(true)}><span><Icon name="plus" size={26}/></span><strong>添一本好书</strong><small>导入本地 TXT 文件</small></button>}</div>}
          {query && !sorted.length && <div className="empty-state"><Icon name="search" size={32}/><h3>暂时没找到这本书</h3><p>试试其他书名关键词。</p></div>}
        </section>
        <footer className="library-footer"><span><Icon name="shield" size={15}/>书籍与阅读记录仅存于此设备</span><span>{readCount} 本正在阅读 <i>·</i> {marks.length} 枚书签</span></footer>
      </>}
      {view === 'marks' && <><div className="page-heading"><div><p className="eyebrow">WORDS WORTH KEEPING</p><h1>我的书签<span className="title-dot">.</span></h1><p className="muted">为想回来的地方，折一角书页。</p></div><span className="count-label">{marks.length} 枚书签</span></div>{!marks.length ? <div className="empty-state bordered"><Icon name="bookmark" size={34}/><h3>留住一个片刻</h3><p>阅读时，点击右上角的书签按钮即可保存当前位置。</p></div> : <div className="bookmark-list">{[...marks].sort((a, b) => b.createdAt - a.createdAt).map(mark => { const book = books.find(b => b.id === mark.bookId); return <article className="bookmark-card" key={mark.id}><Icon name="bookmark"/><button onClick={() => { if (book) open(book, mark.position); }}><small>{book?.title ?? '书籍已移除'} · {new Date(mark.createdAt).toLocaleDateString('zh-CN')}</small><h3>{mark.title}</h3><p>{mark.snippet || '章节起始位置'}</p></button><button className="icon-button" aria-label="删除书签" onClick={async () => { try { await db.deleteBookmark(mark.id); await refresh(); } catch (e) { setError(String(e)); } }}><Icon name="trash" size={17}/></button></article>; })}</div>}</>}
      {view === 'settings' && <><div className="page-heading"><div><p className="eyebrow">MAKE YOURSELF AT HOME</p><h1>阅读与数据<span className="title-dot">.</span></h1><p className="muted">习惯由你定义，故事由你保管。</p></div></div><div className="settings-grid"><section className="settings-card"><h2>舒适地阅读</h2><ReadingSettings settings={settings} onChange={changeSettings}/></section><div><section className="settings-card"><h2>把书房备份好</h2><p className="muted">备份包含全文、阅读进度、书签和外观设置。换设备或清理浏览器前，请先导出备份。</p><div className="data-actions"><button className="secondary" onClick={() => { void backup(); }} disabled={busy}><Icon name="download" size={17}/>{busy ? '正在处理…' : '导出完整备份'}</button><button className="secondary" onClick={() => restoreInput.current?.click()} disabled={busy}><Icon name="upload" size={17}/>从备份恢复</button></div><input hidden ref={restoreInput} type="file" accept=".json,application/json" aria-label="选择备份文件" onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        setBusy(true);
        try { if (file.size > 200 * 1024 * 1024) throw new Error('备份大于 200 MB，请在桌面端拆分书架后备份。'); const data: unknown = JSON.parse(await file.text()); db.validateBackup(data); setRestore(data); } catch (e) { setError(String(e)); } finally { setBusy(false); }
      }}/><p className="caption">备份是明文文件，请保存在你信任的位置。</p></section><section className="settings-card"><h2>随时离线，安心本地</h2><p className="muted">在 iPhone Safari 中点“分享 → 添加到主屏幕”。建议先安装，再从主屏幕打开并导入小说；两种打开方式可能使用独立存储。</p><p className="muted">浏览器清理数据、无痕模式或空间不足都可能使数据丢失。离线缓存保存应用，IndexedDB 保存书籍，二者各自独立。</p><button className="secondary" disabled={persisted === true} onClick={async () => { try { const granted = await navigator.storage?.persist?.(); setPersisted(granted ?? false); setNotice(granted ? '浏览器已授予持久存储。仍建议定期备份。' : '浏览器暂未授予持久存储；你仍可正常阅读，请定期备份。'); } catch (e) { setError(String(e)); } }}><Icon name="shield" size={17}/>{persisted ? '已启用持久存储' : '申请持久存储'}</button><p className="caption">无账户 · 无追踪 · 无正文上传<br/>离线功能需通过 HTTPS 或本机 localhost 使用；首次在线打开后，请用断网重开确认缓存已完成。</p></section></div></div></>}
    </main>
    {!loading && routeHash.startsWith('#private/') && <PrivateBookImport hash={routeHash} onClose={() => { history.replaceState(null, '', location.pathname + location.search); setRouteHash(''); }} onReady={book => { history.replaceState(null, '', `#read/${book.id}`); setRouteHash(location.hash); setActive({ book }); void refresh().catch(e => setError(String(e))); }}/ >}
    {importing && <ImportDialog onClose={() => setImporting(false)} onImported={() => { setImporting(false); void refresh().catch(e => setError(String(e))); setNotice('书籍已加入书架。愿你读得尽兴。'); }}/ >}
    {detail && <Modal title="书籍详情" onClose={() => setDetail(undefined)}><div className="detail-layout"><Cover book={detail} small/><div><h3>{detail.title}</h3><p className="muted">{detail.author || '作者未填写'}</p><p className="caption">{detail.chapterCount.toLocaleString()} 个阅读节<br/>{(detail.size / 1024 / 1024).toFixed(2)} MB · {detail.encoding.toUpperCase()}<br/>添加于 {new Date(detail.createdAt).toLocaleDateString('zh-CN')}<br/>已读 {(detail.position.progress * 100).toFixed(1)}%</p></div></div><button className="primary full" onClick={() => { open(detail); setDetail(undefined); }}>打开阅读<Icon name="arrow" size={16}/></button><button className="danger-button full" onClick={async () => { if (!confirm(`删除《${detail.title}》？正文、进度和书签会从本设备移除。此操作无法撤销，请先备份。`)) return; try { await db.deleteBook(detail.id); setDetail(undefined); await refresh(); } catch (e) { setError(String(e)); } }}><Icon name="trash" size={16}/>删除这本书</button></Modal>}
    {restore && <Modal title="恢复整个书房" busy={busy} onClose={() => setRestore(undefined)}><p>备份中有 <strong>{restore.books.length}</strong> 本书、<strong>{restore.bookmarks.length}</strong> 枚书签。</p><p className="error">恢复会替换当前设备上的全部书籍、进度、书签和设置。建议先导出当前书架备份。</p><div className="data-actions"><button className="secondary" disabled={busy} onClick={() => { void backup(); }}>先备份当前书架</button><button className="primary" disabled={busy} onClick={async () => { setBusy(true); try { await db.restoreBackup(restore); await refresh(); setSettings(restore.settings); setRestore(undefined); setNotice('书房已从备份恢复。'); } catch (e) { setError('恢复失败，原书架已保留：' + String(e)); } finally { setBusy(false); } }}>{busy ? '正在恢复…' : '确认替换并恢复'}</button></div></Modal>}
  </div>;
}
