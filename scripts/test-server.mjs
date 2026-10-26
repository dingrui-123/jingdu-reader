// A strict static host mounted under a repository path, like GitHub Pages.
// No SPA fallback: hash routing and relative assets must work without rewrites.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
const root = resolve('dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') { res.writeHead(302, { Location: '/jingdu/' }); res.end(); return; }
  if (!path.startsWith('/jingdu/')) { res.writeHead(404); res.end(); return; }
  let target;
  try { target = resolve(root, decodeURIComponent(path.slice(8)) || 'index.html'); }
  catch { res.writeHead(400); res.end(); return; }
  if (!target.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(target);
    const headers = { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = Number(range[1]); const end = Number(range[2]);
      if (start > end || end >= data.length) { res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }); res.end(); return; }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 }); res.end(data.subarray(start, end + 1));
    } else { res.writeHead(200, { ...headers, 'Content-Length': data.length }); res.end(data); }
  } catch { res.writeHead(404); res.end(); }
}).listen(4173, '127.0.0.1', () => console.log('Static deployment test: http://127.0.0.1:4173/jingdu/'));
