import { test, expect } from '@playwright/test';
import { createCipheriv, randomBytes } from 'node:crypto';

function fixture() {
  const id = randomBytes(18).toString('base64url'); const key = randomBytes(32); const iv = randomBytes(12); const magic = Buffer.from('JDP1');
  const name = Buffer.from('私人测试_佚名.txt'); const length = Buffer.alloc(4); length.writeUInt32BE(name.length);
  const text = Buffer.from(`第一章 山间\n${'山间的故事缓缓展开，把时光留给文字，把目光留给远方。\n'.repeat(90)}`);
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(magic);
  const encrypted = Buffer.concat([magic, iv, cipher.update(Buffer.concat([length, name, text])), cipher.final(), cipher.getAuthTag()]);
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
