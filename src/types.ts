export type Theme = 'light' | 'paper' | 'dark';
export interface Settings { theme: Theme; fontSize: number; lineHeight: number; paragraphGap: number; margin: number }
export const defaults: Settings = { theme: 'paper', fontSize: 20, lineHeight: 1.9, paragraphGap: 14, margin: 24 };
export interface Position { chapter: number; offset: number; fraction: number; progress: number }
export interface Book {
  remote?: RemoteSource;
  storage?: 'online' | 'offline';
  sourceId?: string;
  id: string; title: string; author: string; size: number; encoding: string;
  chapterCount: number; length: number; createdAt: number; lastRead: number;
  position: Position; chapters: ChapterInfo[];
}
export interface ChapterInfo { index: number; title: string; start: number; length: number; remoteOffset?: number; remoteSize?: number }
export interface RemoteSource { id: string; secret: string; version: string; dataStart: number; totalSize: number }
export interface RemoteBook { sourceId: string; title: string; author: string; size: number; encoding: string; length: number; chapters: ChapterInfo[]; remote: RemoteSource }
export interface LibraryAccess { id: string; secret: string; hidden?: string[] }
export interface Chapter extends ChapterInfo { bookId: string; text: string }
export interface Bookmark { id: string; bookId: string; title: string; snippet: string; position: Position; createdAt: number }
export interface Parsed { title: string; author: string; encoding: string; length: number; chapters: Omit<Chapter, 'bookId'>[] }
export interface Backup { format: 'jingdu'; version: 1; exportedAt: string; books: Book[]; chapters: Chapter[]; bookmarks: Bookmark[]; settings: Settings; library?: LibraryAccess }
