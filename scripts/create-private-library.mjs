// Keep the resulting private link local. It contains the keys for all selected books.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
const names = process.argv.slice(2).map(name => basename(name));
if (!names.length || names.length > 20 || new Set(names).size !== names.length) throw new Error('Usage: node scripts/create-private-library.mjs <book.txt> [book2.txt ...], up to 20 unique books');
const metadata = [];
for (const file of await readdir('.tools/private-books')) {
  if (file.endsWith('.json')) metadata.push(JSON.parse(await readFile(`.tools/private-books/${file}`, 'utf8')));
}
const selected = names.map(name => {
  const matches = metadata.filter(book => book.name === name);
  if (matches.length !== 1) throw new Error(`Expected one encrypted package for ${name}; found ${matches.length}`);
  return matches[0];
});
const links = selected.map(({ id, secret }) => ({ id, secret }));
const link = `https://dingrui-123.github.io/jingdu-reader/#collection/${Buffer.from(JSON.stringify(links)).toString('base64url')}`;
const output = '.tools/private-library.json';
await writeFile(output, JSON.stringify({ names, link }, null, 2));
console.log(JSON.stringify({ books: names.length, privateLinkSavedTo: resolve(output) }));
