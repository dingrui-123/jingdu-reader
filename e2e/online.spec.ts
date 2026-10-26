import { test, expect, type Page } from '@playwright/test';
import { createCipheriv, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
const temporaryFiles: string[] = [];
test.afterEach(async () => { await Promise.all(temporaryFiles.splice(0).map(path => unlink(path).catch(() => {}))); });
function fixture(count: number) {
  const id = randomBytes(18).toString('base64url'); const secret = randomBytes(32).toString('base64url'); const version = '1234567890abcdef';
  const libraryId = randomBytes(18).toString('base64url'); const libraryKey = randomBytes(32).toString('base64url');
  const seal = (text: string, key: string, aad: string) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), iv); cipher.setAAD(Buffer.from(aad)); return Buffer.concat([iv, cipher.update(gzipSync(Buffer.from(text))), cipher.final(), cipher.getAuthTag()]); };
  let start = 0; let offset = 0; const chunks: Buffer[] = [];
  const chapters = Array.from({ length: count }, (_, index) => {
    const title = `第${index + 1}章 远行`; const text = `${title}\n${'山间的风吹过树梢，故事从这里慢慢展开，把时光留给文字。\n'.repeat(70)}`;
    const body = seal(text, secret, `JDC1:${id}:${version}:${index}`); chunks.push(body);
    const info = { index, title, start, length: text.length, remoteOffset: offset, remoteSize: body.length }; start += text.length; offset += body.length; return info;
  });
  const packed = Buffer.concat([Buffer.alloc(64), ...chunks]);
  const descriptor = { sourceId: id, title: '在线远行', author: '佚名', size: start * 3, encoding: 'utf-8', length: start, chapters, remote: { id, secret, version, dataStart: 64, totalSize: packed.length } };
  const catalog = seal(JSON.stringify({ format: 'jingdu-stream-library', version: 1, books: [descriptor] }), libraryKey, `JDL1:${libraryId}`);
  const pointer = seal(JSON.stringify(descriptor), secret, `JDB1:${id}`);
  return { id, secret, version, packed, catalog, pointer, descriptor, reCatalog: (books: unknown[]) => seal(JSON.stringify({ format: 'jingdu-stream-library', version: 1, books }), libraryKey, `JDL1:${libraryId}`), libraryId, libraryKey, count, link: `./#shelf/${libraryId}/${libraryKey}` };
}
async function attach(page: Page, book: ReturnType<typeof fixture>) {
  const requests: { range?: string; size: number }[] = [];
  await mkdir('dist/stream', { recursive: true });
  for (const [name, body] of [[`${book.libraryId}.jdi`, book.catalog], [`${book.id}-${book.version}.jds`, book.packed], [`${book.id}.jdx`, book.pointer]] as const) {
    const path = `dist/stream/${name}`; await writeFile(path, body); temporaryFiles.push(path);
  }
  page.on('request', request => {
    if (!request.url().endsWith(`${book.id}-${book.version}.jds`)) return;
    const range = request.headers()['range']; const match = /bytes=(\d+)-(\d+)/.exec(range ?? '');
    expect(request.url()).not.toContain(book.secret);
    requests.push({ range, size: match ? Number(match[2]) - Number(match[1]) + 1 : book.packed.length });
  });
  return requests;
}
async function chapterCount(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => { const request = indexedDB.open('jingdu', 1); request.onerror = reject; request.onsuccess = () => { const d = request.result; const r = d.transaction('chapters').objectStore('chapters').count(); r.onsuccess = () => { resolve(r.result); d.close(); }; r.onerror = reject; }; }));
}
test('online reading fetches one chapter, restores progress, and locates chapter 1200 alongside its neighbors', async ({ page }) => {
  const book = fixture(1600); const requests = await attach(page, book);
  await page.goto(book.link); await expect(page.getByRole('button', { name: '阅读 在线远行', exact: true })).toBeVisible();
  expect(requests).toHaveLength(0); expect(await chapterCount(page)).toBe(0);
  await page.getByRole('button', { name: '阅读 在线远行', exact: true }).click();
  await expect(page.locator('.reading-article h1')).toHaveText('第1章 远行');
  expect(requests).toHaveLength(1); expect(requests[0].range).toBeTruthy(); expect(requests[0].size).toBeLessThan(4000); expect(await chapterCount(page)).toBe(0);
  await page.getByRole('button', { name: '章节目录', exact: true }).click();
  await page.getByLabel('搜索章节').fill('第1200章'); await page.getByRole('button', { name: '第1200节 第1200章 远行', exact: true }).click();
  await expect(page.locator('.reading-article h1')).toHaveText('第1200章 远行');
  await page.locator('.reading-scroll').evaluate(el => { el.scrollTop = 1300; }); await page.waitForTimeout(850);
  await page.getByRole('button', { name: '章节目录', exact: true }).click();
  await expect(page.getByRole('button', { name: '第1199节 第1199章 远行', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '第1201节 第1201章 远行', exact: true })).toBeVisible();
  await page.getByLabel('搜索章节').fill('第20章'); await page.getByRole('button', { name: '定位当前阅读节', exact: true }).click();
  await expect(page.getByLabel('搜索章节')).toHaveValue('');
  await expect(page.getByRole('button', { name: '第1199节 第1199章 远行', exact: true })).toBeVisible();
  expect(await page.locator('.toc-list>button').count()).toBeLessThan(40);
  await page.locator('.toc-viewport').evaluate(el => { el.scrollTop += 450; });
  await expect(page.getByRole('button', { name: '第1210节 第1210章 远行', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '定位当前阅读节', exact: true }).click(); await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload(); await expect(page.locator('.reading-article h1')).toHaveText('第1200章 远行');
  await expect.poll(() => page.locator('.reading-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
  expect(await chapterCount(page)).toBe(0);
});
test('existing private links use the online source without downloading legacy whole-book files', async ({ page }) => {
  const book = fixture(4); const requests = await attach(page, book);
  await page.goto(`./#private/${book.id}/${book.secret}`);
  await expect(page.locator('.reading-article h1')).toHaveText('第1章 远行');
  expect(requests).toHaveLength(1); expect(requests[0].range).toBeTruthy(); expect(await chapterCount(page)).toBe(0);
});
test('saved private library discovers new books on refresh and respects deleted books', async ({ page }) => {
  const first = fixture(4); const second = fixture(5); second.descriptor.title = '新增远行';
  await attach(page, first); await attach(page, second);
  await page.goto(first.link); await expect(page.locator('.cover-button')).toHaveCount(1);
  await writeFile(`dist/stream/${first.libraryId}.jdi`, first.reCatalog([first.descriptor, second.descriptor]));
  await page.reload(); await expect(page.locator('.cover-button')).toHaveCount(2); expect(await chapterCount(page)).toBe(0);
  await page.getByRole('button', { name: '在线远行的详情', exact: true }).click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '删除这本书', exact: true }).click();
  await expect(page.locator('.cover-button')).toHaveCount(1); await page.reload();
  await expect(page.getByRole('button', { name: '阅读 新增远行', exact: true })).toBeVisible(); await expect(page.locator('.cover-button')).toHaveCount(1);
});
test('explicit offline download survives offline reload and release keeps bookmarks and reading position', async ({ page, context }) => {
  const book = fixture(8); const requests = await attach(page, book); await page.goto(book.link);
  await page.getByRole('button', { name: '阅读 在线远行', exact: true }).click(); await expect(page.locator('.reading-article h1')).toHaveText('第1章 远行');
  await page.locator('.reading-scroll').evaluate(el => { el.scrollTop = 1300; }); await page.waitForTimeout(850);
  await page.getByRole('button', { name: '添加书签', exact: true }).click();
  await page.getByRole('button', { name: '书架', exact: true }).click(); await page.getByRole('button', { name: '在线远行的详情', exact: true }).click();
  await page.getByRole('button', { name: '下载整本离线', exact: true }).click(); await expect(page.getByRole('button', { name: '已下载整本', exact: true })).toBeVisible();
  expect(requests.filter(r => !r.range)).toHaveLength(1); expect(await chapterCount(page)).toBe(8);
  await page.getByRole('button', { name: '关闭', exact: true }).click(); await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller); await context.setOffline(true); await page.reload();
  await page.getByRole('button', { name: '阅读 在线远行', exact: true }).click(); await expect(page.locator('.reading-article h1')).toHaveText('第1章 远行');
  await expect.poll(() => page.locator('.reading-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
  await page.getByRole('button', { name: '书架', exact: true }).click(); await page.getByRole('button', { name: '在线远行的详情', exact: true }).click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '移除离线正文', exact: true }).click();
  await expect(page.getByRole('button', { name: '下载整本离线', exact: true })).toBeVisible(); expect(await chapterCount(page)).toBe(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click(); await page.getByRole('button', { name: '我的书签', exact: true }).click(); await expect(page.locator('.bookmark-card')).toHaveCount(1);
  await page.getByRole('button', { name: /^我的书架/ }).click(); await page.getByRole('button', { name: '阅读 在线远行', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('尚未离线保存'); await context.setOffline(false); await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true); await page.getByRole('button', { name: '重试加载', exact: true }).click();
  await expect(page.locator('.reading-article h1')).toHaveText('第1章 远行', { timeout: 45000 }); await expect.poll(() => page.locator('.reading-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
});
