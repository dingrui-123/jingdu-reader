import { defaults, type Backup, type Book, type Bookmark, type Chapter, type Parsed, type Settings } from '../types';

let connection: Promise<IDBDatabase> | undefined;
function db() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('当前浏览器无法使用本地数据库，请使用普通模式的 Safari 或 Chrome。')); return; }
    const request = indexedDB.open('jingdu', 1);
    request.onupgradeneeded = () => {
      const d = request.result;
      d.createObjectStore('books', { keyPath: 'id' });
      d.createObjectStore('chapters', { keyPath: ['bookId', 'index'] }).createIndex('bookId', 'bookId');
      d.createObjectStore('bookmarks', { keyPath: 'id' }).createIndex('bookId', 'bookId');
      d.createObjectStore('settings');
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onblocked = () => reject(new Error('数据库被其他窗口占用，请关闭其他静读窗口再试。'));
  });
}
async function transact<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (v: T) => void) => void): Promise<T> {
  const database = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction(stores, mode);
    let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error ?? new Error('本地数据操作失败，可能空间不足。'));
    tx.onabort = () => reject(tx.error ?? new Error('数据操作已取消。'));
    try { run(tx, v => { value = v; }); } catch (e) { tx.abort(); reject(e); }
  });
}
function all<T>(store: string): Promise<T[]> {
  return transact([store], 'readonly', (tx, done) => { tx.objectStore(store).getAll().onsuccess = e => done((e.target as IDBRequest).result); });
}
export const listBooks = () => all<Book>('books');
export const listBookmarks = () => all<Bookmark>('bookmarks');
export async function getChapter(bookId: string, index: number): Promise<Chapter> {
  return transact(['chapters'], 'readonly', (tx, done) => {
    tx.objectStore('chapters').get([bookId, index]).onsuccess = e => done((e.target as IDBRequest).result);
  });
}
export async function getSettings(): Promise<Settings> {
  const saved = await transact<Settings | undefined>(['settings'], 'readonly', (tx, done) => { tx.objectStore('settings').get('reader').onsuccess = e => done((e.target as IDBRequest).result); });
  return { ...defaults, ...saved };
}
export const saveSettings = (settings: Settings) => transact<void>(['settings'], 'readwrite', tx => { tx.objectStore('settings').put(settings, 'reader'); });
export const saveBook = (book: Book) => transact<void>(['books'], 'readwrite', tx => { tx.objectStore('books').put(book); });
export const saveBookmark = (mark: Bookmark) => transact<void>(['bookmarks'], 'readwrite', tx => { tx.objectStore('bookmarks').put(mark); });
export const deleteBookmark = (id: string) => transact<void>(['bookmarks'], 'readwrite', tx => { tx.objectStore('bookmarks').delete(id); });
export async function importBook(parsed: Parsed, size: number, onProgress: (percent: number) => void = () => {}, sourceId?: string) {
  const id = crypto.randomUUID();
  const book: Book = { id, sourceId, title: parsed.title.trim() || '未命名书籍', author: parsed.author, size, encoding: parsed.encoding,
    chapterCount: parsed.chapters.length, length: parsed.length, createdAt: Date.now(), lastRead: 0,
    position: { chapter: 0, offset: 0, fraction: 0, progress: 0 },
    chapters: parsed.chapters.map(({ text: _, ...info }) => info) };
  let saved = 0; let reported = -1;
  onProgress(0);
  await transact<void>(['books', 'chapters'], 'readwrite', tx => {
    tx.objectStore('books').add(book);
    for (const chapter of parsed.chapters) {
      tx.objectStore('chapters').add({ ...chapter, bookId: id }).onsuccess = () => {
        const progress = Math.floor(++saved / parsed.chapters.length * 20) * 5;
        if (progress !== reported) { reported = progress; onProgress(Math.min(95, progress)); }
      };
    }
  });
  onProgress(100);
  return book;
}
export const deleteBook = (id: string) => transact<void>(['books', 'chapters', 'bookmarks'], 'readwrite', tx => {
  tx.objectStore('books').delete(id);
  for (const store of ['chapters', 'bookmarks']) {
    tx.objectStore(store).index('bookId').openCursor(IDBKeyRange.only(id)).onsuccess = e => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
  }
});
export async function exportBackup(): Promise<Backup> {
  // One transaction gives a consistent snapshot even with other tabs open.
  return transact(['books', 'chapters', 'bookmarks', 'settings'], 'readonly', (tx, done) => {
    const backup: Backup = { format: 'jingdu', version: 1, exportedAt: new Date().toISOString(), books: [], chapters: [], bookmarks: [], settings: defaults };
    for (const key of ['books', 'chapters', 'bookmarks'] as const) tx.objectStore(key).getAll().onsuccess = e => { Object.assign(backup, { [key]: (e.target as IDBRequest).result }); };
    tx.objectStore('settings').get('reader').onsuccess = e => { backup.settings = (e.target as IDBRequest).result ?? defaults; done(backup); };
  });
}
const finite = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
export function validateBackup(value: unknown): asserts value is Backup {
  const b = value as Backup;
  const fail = () => { throw new Error('备份格式或数据不完整，未修改本地书架。'); };
  if (!b || b.format !== 'jingdu' || b.version !== 1 || !Array.isArray(b.books) || !Array.isArray(b.chapters) || !Array.isArray(b.bookmarks)) return fail();
  const s = b.settings;
  if (!s || !['light', 'paper', 'dark'].includes(s.theme) || !finite(s.fontSize, 14, 32) || !finite(s.lineHeight, 1.3, 2.6) || !finite(s.paragraphGap, 0, 32) || !finite(s.margin, 12, 48)) return fail();
  const ids = new Set<string>(); const keys = new Set<string>();
  for (const book of b.books) {
    if (!book || typeof book.id !== 'string' || ids.has(book.id) || typeof book.title !== 'string' || typeof book.author !== 'string' || typeof book.encoding !== 'string' || !finite(book.length, 1, 200e6) || !finite(book.size, 0, 200e6) || !finite(book.createdAt, 0, 1e15) || !finite(book.lastRead, 0, 1e15) || !Array.isArray(book.chapters) || !book.chapters.length || book.chapterCount !== book.chapters.length) return fail();
    ids.add(book.id);
    let start = 0;
    for (const [i, c] of book.chapters.entries()) {
      if (!c || c.index !== i || typeof c.title !== 'string' || c.start !== start || !Number.isInteger(c.length) || c.length < 1 || c.length > 18000) return fail();
      start += c.length;
    }
    if (start !== book.length || !validPosition(book.position, book)) return fail();
  }
  const books = new Map(b.books.map(book => [book.id, book]));
  for (const c of b.chapters) {
    const book = c && books.get(c.bookId); const info = book?.chapters[c.index]; const key = `${c?.bookId}:${c?.index}`;
    if (!info || keys.has(key) || typeof c.text !== 'string' || c.text.length !== info.length || c.start !== info.start || c.length !== info.length || c.title !== info.title) return fail();
    keys.add(key);
  }
  if (keys.size !== b.books.reduce((n, book) => n + book.chapterCount, 0)) return fail();
  const markIds = new Set<string>();
  for (const m of b.bookmarks) {
    const book = m && books.get(m.bookId);
    if (!book || typeof m.id !== 'string' || markIds.has(m.id) || typeof m.title !== 'string' || typeof m.snippet !== 'string' || !finite(m.createdAt, 0, 1e15) || !validPosition(m.position, book)) return fail();
    markIds.add(m.id);
  }
}
function validPosition(p: Book['position'], book: Book) {
  return p && Number.isInteger(p.chapter) && p.chapter >= 0 && p.chapter < book.chapterCount && Number.isInteger(p.offset) && finite(p.offset, 0, book.chapters[p.chapter].length) && finite(p.fraction, 0, 1) && finite(p.progress, 0, 1);
}
export async function restoreBackup(backup: Backup) {
  validateBackup(backup);
  await transact<void>(['books', 'chapters', 'bookmarks', 'settings'], 'readwrite', tx => {
    for (const name of ['books', 'chapters', 'bookmarks']) tx.objectStore(name).clear();
    for (const book of backup.books) tx.objectStore('books').put(book);
    for (const c of backup.chapters) tx.objectStore('chapters').put(c);
    for (const m of backup.bookmarks) tx.objectStore('bookmarks').put(m);
    tx.objectStore('settings').put(backup.settings, 'reader');
  });
}
