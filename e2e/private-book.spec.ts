import { test, expect } from '@playwright/test';
import { createCipheriv, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';

function fixture(title = '私人测试', compressed = false) {
  const id = randomBytes(18).toString('base64url'); const key = randomBytes(32); const iv = randomBytes(12); const magic = Buffer.from(compressed ? 'JDP2' : 'JDP1');
  const name = Buffer.from(`${title}_佚名.txt`); const length = Buffer.alloc(4); length.writeUInt32BE(name.length);
  const text = Buffer.from(`第一章 山间\n${'山间的故事缓缓展开，把时光留给文字，把目光留给远方。\n'.repeat(90)}`);
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(magic);
  const plain = Buffer.concat([length, name, text]);
  const encrypted = Buffer.concat([magic, iv, cipher.update(compressed ? gzipSync(plain) : plain), cipher.final(), cipher.getAuthTag()]);
  return { id, secret: key.toString('base64url'), encrypted };
}
test('private link imports once, opens directly, and restores offline without the ciphertext', async ({ page, context }) => {
  const book = fixture(); let downloads = 0;
  await page.route(`**/shared/${book.id}.jdb`, async route => { downloads++; expect(route.request().url()).not.toContain(book.secret); await route.fulfill({ body: book.encrypted, contentType: 'application/octet-stream' }); });
  const link = `./#private/${book.id}/${book.secret}`;
  await page.goto(link);
  await expect(page.locator('.reading-article h1')).toHaveText('第一章 山间');
  expect(downloads).toBe(1);
  await page.locator('.reading-scroll').evaluate(el => { el.scrollTop = 1400; }); await page.waitForTimeout(850);
  await page.getByRole('button', { name: '书架', exact: true }).click();
  await expect(page.locator('.cover-button')).toHaveCount(1);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.goto(link);
  await expect(page.locator('.reading-article h1')).toHaveText('第一章 山间');
  expect(await page.locator('.reading-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(1100);
  expect(downloads).toBe(1);
  await page.getByRole('button', { name: '书架', exact: true }).click();
  await expect(page.locator('.cover-button')).toHaveCount(1);
});
test('wrong private key fails clearly and leaves the bookshelf untouched', async ({ page }) => {
  const book = fixture();
  await page.route(`**/shared/${book.id}.jdb`, route => route.fulfill({ body: book.encrypted, contentType: 'application/octet-stream' }));
  await page.goto(`./#private/${book.id}/${randomBytes(32).toString('base64url')}`);
  await expect(page.getByRole('alert')).toContainText('无法解密');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('.cover-button')).toHaveCount(0);
});

test('collection resumes after a failed download, preserves existing progress, and reopens offline', async ({ page, context }) => {
  const books = Array.from({ length: 5 }, (_, i) => fixture(`藏书${i + 1}`, i > 0));
  const counts = Array(5).fill(0); let allowSecond = false;
  for (const [i, book] of books.entries()) {
    await page.route(`**/shared/${book.id}.jdb`, async route => {
      counts[i]++; expect(route.request().url()).not.toContain(book.secret);
      if (i === 1 && !allowSecond) { await route.fulfill({ status: 503, body: 'Temporarily unavailable' }); return; }
      await route.fulfill({ body: book.encrypted, contentType: 'application/octet-stream' });
    });
  }
  await page.goto(`./#private/${books[0].id}/${books[0].secret}`);
  await expect(page.locator('.reading-article h1')).toHaveText('第一章 山间');
  await page.locator('.reading-scroll').evaluate(el => { el.scrollTop = 1400; }); await page.waitForTimeout(850);
  await page.getByRole('button', { name: '书架', exact: true }).click();
  const link = './#collection/' + Buffer.from(JSON.stringify(books.map(({ id, secret }) => ({ id, secret })))).toString('base64url');
  await page.goto(link);
  await expect(page.getByRole('alert')).toContainText('无法下载');
  expect(counts).toEqual([1, 1, 0, 0, 0]);
  allowSecond = true; await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.cover-button')).toHaveCount(5, { timeout: 60000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(counts).toEqual([1, 2, 1, 1, 1]);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true); await page.goto(link);
  await expect(page.locator('.cover-button')).toHaveCount(5);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(counts).toEqual([1, 2, 1, 1, 1]);
  await page.getByRole('button', { name: '阅读 藏书1', exact: true }).click();
  await expect(page.locator('.reading-article h1')).toHaveText('第一章 山间');
  await expect.poll(() => page.locator('.reading-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(1100);
});
