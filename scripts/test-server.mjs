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
    res.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(4173, '127.0.0.1', () => console.log('Static deployment test: http://127.0.0.1:4173/jingdu/'));
