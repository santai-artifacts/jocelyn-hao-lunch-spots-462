import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000');

const dbPath  = process.env.DATABASE_URL || join(__dirname, 'data', 'app.db');
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS spot_status (
    id     INTEGER PRIMARY KEY,
    status TEXT    NOT NULL DEFAULT 'none'
  )
`);

const stmtGetAll = db.prepare('SELECT id, status FROM spot_status');
const stmtUpsert = db.prepare(
  'INSERT INTO spot_status (id, status) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status'
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const VALID = new Set(['none', 'visited', 'want']);

const server = createServer((req, res) => {
  const url      = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  // GET /api/statuses
  if (pathname === '/api/statuses' && req.method === 'GET') {
    const rows = stmtGetAll.all();
    const out  = {};
    for (const r of rows) out[r.id] = r.status;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(out));
  }

  // PATCH /api/statuses/:id
  const m = pathname.match(/^\/api\/statuses\/(\d+)$/);
  if (m && req.method === 'PATCH') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      try {
        const { status } = JSON.parse(body);
        if (!VALID.has(status)) { res.statusCode = 400; return res.end('Invalid status'); }
        stmtUpsert.run(parseInt(m[1]), status);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.statusCode = 400;
        res.end('Bad request');
      }
    });
    return;
  }

  // Static files from public/
  const filePath = pathname === '/' ? '/index.html' : pathname;
  try {
    const full    = join(__dirname, 'public', filePath);
    const content = readFileSync(full);
    res.setHeader('Content-Type', MIME[extname(full)] || 'application/octet-stream');
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on http://0.0.0.0:${PORT}`);
});
