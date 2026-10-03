const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'blogflow.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 60),
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 140),
    slug TEXT NOT NULL UNIQUE,
    excerpt TEXT NOT NULL CHECK(length(excerpt) BETWEEN 10 AND 240),
    content TEXT NOT NULL CHECK(length(content) BETWEEN 20 AND 30000),
    category TEXT NOT NULL DEFAULT 'General' CHECK(length(category) BETWEEN 2 AND 40),
    tags TEXT NOT NULL DEFAULT '',
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts(author_id);
  CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
`);

const sessionStore = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function html(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').filter(Boolean).map(part => {
    const idx = part.indexOf('=');
    const key = idx >= 0 ? part.slice(0, idx).trim() : part.trim();
    const value = idx >= 0 ? part.slice(idx + 1).trim() : '';
    return [key, decodeURIComponent(value)];
  }));
}

function getSession(req) {
  const sid = parseCookies(req).blogflow_session;
  if (!sid) return null;
  const session = sessionStore.get(sid);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessionStore.delete(sid);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { sid, userId: session.userId };
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { error: 'Authentication required.' });
    return null;
  }
  return session;
}

function createSession(res, userId) {
  const sid = crypto.randomBytes(32).toString('hex');
  sessionStore.set(sid, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  res.setHeader('Set-Cookie', `blogflow_session=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`);
}

function clearSession(res, sid) {
  if (sid) sessionStore.delete(sid);
  res.setHeader('Set-Cookie', 'blogflow_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateRegistration(input) {
  const name = String(input.name || '').trim();
  const email = normalizeEmail(input.email);
  const password = String(input.password || '');
  const errors = {};
  if (name.length < 2 || name.length > 60) errors.name = 'Name must be 2–60 characters.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (password.length < 8 || password.length > 72) errors.password = 'Password must be 8–72 characters.';
  return { valid: Object.keys(errors).length === 0, errors, value: { name, email, password } };
}

function validateLogin(input) {
  const email = normalizeEmail(input.email);
  const password = String(input.password || '');
  const errors = {};
  if (!email) errors.email = 'Email is required.';
  if (!password) errors.password = 'Password is required.';
  return { valid: Object.keys(errors).length === 0, errors, value: { email, password } };
}

function validatePost(input) {
  const title = String(input.title || '').trim();
  const excerpt = String(input.excerpt || '').trim();
  const content = String(input.content || '').trim();
  const category = String(input.category || 'General').trim() || 'General';
  const tags = Array.isArray(input.tags)
    ? input.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8)
    : String(input.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 8);
  const errors = {};
  if (title.length < 3 || title.length > 140) errors.title = 'Title must be 3–140 characters.';
  if (excerpt.length < 10 || excerpt.length > 240) errors.excerpt = 'Excerpt must be 10–240 characters.';
  if (content.length < 20 || content.length > 30000) errors.content = 'Content must be 20–30,000 characters.';
  if (category.length < 2 || category.length > 40) errors.category = 'Category must be 2–40 characters.';
  if (tags.some(t => t.length > 24)) errors.tags = 'Each tag must be 24 characters or fewer.';
  return { valid: Object.keys(errors).length === 0, errors, value: { title, excerpt, content, category, tags } };
}

function slugify(title) {
  const base = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 90) || 'post';
  let slug = base;
  let n = 2;
  while (db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function getUserById(id) {
  return db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(id);
}

function postRow(row) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content: row.content,
    category: row.category,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    author: { id: row.author_id, name: row.author_name },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function queryPosts({ q = '', category = '', authorId = null } = {}) {
  const conditions = [];
  const params = [];
  if (q.trim()) {
    conditions.push('(p.title LIKE ? OR p.excerpt LIKE ? OR p.content LIKE ? OR p.tags LIKE ?)');
    const needle = `%${q.trim()}%`;
    params.push(needle, needle, needle, needle);
  }
  if (category.trim()) {
    conditions.push('p.category = ?');
    params.push(category.trim());
  }
  if (authorId !== null) {
    conditions.push('p.author_id = ?');
    params.push(authorId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT p.*, u.name AS author_name
    FROM posts p JOIN users u ON u.id = p.author_id
    ${where}
    ORDER BY datetime(p.created_at) DESC
  `).all(...params);
  return rows.map(postRow);
}

function seed() {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (existing > 0) return;

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('demo@12345', salt, 64).toString('hex');
  const userResult = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run('Demo Author', 'demo@blogflow.local', `${salt}:${hash}`);
  const authorId = Number(userResult.lastInsertRowid);
  const posts = [
    {
      title: 'Designing Better Digital Habits',
      excerpt: 'A practical framework for turning scattered ideas into simple, repeatable workflows that actually stick.',
      content: 'Good systems reduce friction. Start with one place to capture ideas, one clear next action, and a short daily review.\n\nThe goal is not to fill every minute. It is to make progress visible and make the next step obvious.\n\nSmall improvements compound when the interface, workflow, and habits all support each other.',
      category: 'Productivity',
      tags: 'habits,workflow,design'
    },
    {
      title: 'What Makes a Great Blog Experience?',
      excerpt: 'Readable typography, clear navigation, thoughtful spacing, and a fast path from discovery to content.',
      content: 'A strong reading experience starts before the first paragraph. Visitors should immediately understand where they are, what the site offers, and how to explore more.\n\nFrom there, typography and spacing should make long-form content comfortable on both desktop and mobile.',
      category: 'Design',
      tags: 'ui,ux,typography'
    }
  ];
  const insert = db.prepare('INSERT INTO posts (title, slug, excerpt, content, category, tags, author_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const post of posts) insert.run(post.title, slugify(post.title), post.excerpt, post.content, post.category, post.tags, authorId);
}
seed();

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  if (pathname === '/api/health' && method === 'GET') return json(res, 200, { ok: true, service: 'BlogFlow API' });

  if (pathname === '/api/auth/me' && method === 'GET') {
    const session = getSession(req);
    if (!session) return json(res, 200, { authenticated: false, user: null });
    return json(res, 200, { authenticated: true, user: publicUser(getUserById(session.userId)) });
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    try {
      const body = await readBody(req);
      const checked = validateRegistration(body);
      if (!checked.valid) return json(res, 422, { error: 'Please fix the highlighted fields.', fields: checked.errors });
      const { name, email, password } = checked.value;
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) return json(res, 409, { error: 'An account with that email already exists.' });
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, salt, 64).toString('hex');
      const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, `${salt}:${hash}`);
      createSession(res, Number(result.lastInsertRowid));
      return json(res, 201, { user: publicUser(getUserById(Number(result.lastInsertRowid))) });
    } catch (error) {
      return json(res, 400, { error: error.message || 'Unable to register.' });
    }
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    try {
      const body = await readBody(req);
      const checked = validateLogin(body);
      if (!checked.valid) return json(res, 422, { error: 'Please enter your email and password.', fields: checked.errors });
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(checked.value.email);
      if (!user) return json(res, 401, { error: 'Invalid email or password.' });
      const [salt, storedHex] = user.password_hash.split(':');
      const derived = crypto.scryptSync(checked.value.password, salt, 64);
      const stored = Buffer.from(storedHex, 'hex');
      if (stored.length !== derived.length || !crypto.timingSafeEqual(stored, derived)) return json(res, 401, { error: 'Invalid email or password.' });
      createSession(res, user.id);
      return json(res, 200, { user: publicUser(user) });
    } catch (error) {
      return json(res, 400, { error: error.message || 'Unable to sign in.' });
    }
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const session = getSession(req);
    clearSession(res, session?.sid);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/categories' && method === 'GET') {
    const categories = db.prepare('SELECT category, COUNT(*) AS count FROM posts GROUP BY category ORDER BY category').all();
    return json(res, 200, { categories });
  }

  if (pathname === '/api/posts' && method === 'GET') {
    const posts = queryPosts({ q: url.searchParams.get('q') || '', category: url.searchParams.get('category') || '' });
    return json(res, 200, { posts });
  }

  if (pathname === '/api/posts' && method === 'POST') {
    const session = requireAuth(req, res);
    if (!session) return;
    try {
      const checked = validatePost(await readBody(req));
      if (!checked.valid) return json(res, 422, { error: 'Please fix the highlighted fields.', fields: checked.errors });
      const v = checked.value;
      const slug = slugify(v.title);
      const now = new Date().toISOString();
      const result = db.prepare('INSERT INTO posts (title, slug, excerpt, content, category, tags, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(v.title, slug, v.excerpt, v.content, v.category, v.tags.join(','), session.userId, now, now);
      const row = db.prepare('SELECT p.*, u.name AS author_name FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?').get(result.lastInsertRowid);
      return json(res, 201, { post: postRow(row) });
    } catch (error) {
      return json(res, 400, { error: error.message || 'Unable to create the post.' });
    }
  }

  const postMatch = pathname.match(/^\/api\/posts\/(\d+)$/);
  if (postMatch) {
    const id = Number(postMatch[1]);
    const row = db.prepare('SELECT p.*, u.name AS author_name FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?').get(id);
    if (!row) return json(res, 404, { error: 'Post not found.' });

    if (method === 'GET') return json(res, 200, { post: postRow(row) });

    const session = requireAuth(req, res);
    if (!session) return;
    if (row.author_id !== session.userId) return json(res, 403, { error: 'You can only manage your own posts.' });

    if (method === 'PUT') {
      try {
        const checked = validatePost(await readBody(req));
        if (!checked.valid) return json(res, 422, { error: 'Please fix the highlighted fields.', fields: checked.errors });
        const v = checked.value;
        let slug = row.slug;
        if (v.title !== row.title) {
          const base = v.title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 90) || 'post';
          slug = base;
          let n = 2;
          while (db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').get(slug, id)) slug = `${base}-${n++}`;
        }
        const now = new Date().toISOString();
        db.prepare('UPDATE posts SET title = ?, slug = ?, excerpt = ?, content = ?, category = ?, tags = ?, updated_at = ? WHERE id = ?').run(v.title, slug, v.excerpt, v.content, v.category, v.tags.join(','), now, id);
        const updated = db.prepare('SELECT p.*, u.name AS author_name FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?').get(id);
        return json(res, 200, { post: postRow(updated) });
      } catch (error) {
        return json(res, 400, { error: error.message || 'Unable to update the post.' });
      }
    }

    if (method === 'DELETE') {
      db.prepare('DELETE FROM posts WHERE id = ?').run(id);
      return json(res, 200, { ok: true });
    }
  }

  // Serve the SPA.
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Forbidden.' });
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  return html(res, 404, '<!doctype html><html><body><h1>404</h1><p>Page not found.</p></body></html>');
}

const server = http.createServer((req, res) => {
  router(req, res).catch(error => {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: 'Internal server error.' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`BlogFlow running at http://${HOST}:${PORT}`);
  console.log('Demo account: demo@blogflow.local / demo@12345');
});

process.on('SIGINT', () => { db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });
