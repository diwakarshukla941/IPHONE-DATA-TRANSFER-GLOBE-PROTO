const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT || 4173);
const sessions = new Map();
const TTL_MS = 2 * 60 * 1000;

function makeId() {
  return randomBytes(5).toString('hex').toUpperCase();
}

function prune() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(id);
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}

function publicSession(session) {
  return {
    id: session.id,
    paired: session.paired,
    expiresAt: session.expiresAt,
    messages: session.messages.slice(-20)
  };
}

const server = http.createServer(async (req, res) => {
  prune();
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const id = makeId();
      const session = { id, paired: false, expiresAt: Date.now() + TTL_MS, messages: [] };
      sessions.set(id, session);
      return json(res, 201, publicSession(session));
    }

    const match = url.pathname.match(/^\/api\/sessions\/([A-F0-9]{10})(\/join|\/messages)?$/);
    if (match) {
      const [, id, action] = match;
      const session = sessions.get(id);
      if (!session) return json(res, 404, { error: 'This pairing code has expired or does not exist.' });
      if (req.method === 'GET' && !action) return json(res, 200, publicSession(session));
      if (req.method === 'POST' && action === '/join') {
        session.paired = true;
        return json(res, 200, publicSession(session));
      }
      if (req.method === 'POST' && action === '/messages') {
        const input = await body(req);
        const text = String(input.text || '').trim().slice(0, 280);
        const from = input.from === 'owner' ? 'owner' : 'guest';
        if (!text) return json(res, 400, { error: 'A message is required.' });
        if (!session.paired) return json(res, 409, { error: 'Pair the devices first.' });
        session.messages.push({ id: randomBytes(4).toString('hex'), from, text, at: Date.now() });
        return json(res, 201, publicSession(session));
      }
    }

    if (req.method === 'GET') {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const safe = path.normalize(file).replace(/^([.][.][\\/])+/, '');
      const filePath = path.join(__dirname, 'public', safe);
      const data = await readFile(filePath);
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };
      res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
      return res.end(data);
    }
    json(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    json(res, error instanceof SyntaxError ? 400 : 500, { error: error.message || 'Unexpected error.' });
  }
});

server.listen(PORT, () => console.log(`Pulse Pair running at http://localhost:${PORT}`));
