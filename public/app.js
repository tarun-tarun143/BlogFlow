const app = document.getElementById('app');
const authButton = document.getElementById('authButton');
const themeButton = document.getElementById('themeButton');
const toastRegion = document.getElementById('toastRegion');
const year = document.getElementById('year');
year.textContent = new Date().getFullYear();

const state = { user: null, posts: [], categories: [], query: '', category: '' };

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}
function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
function readTime(content) {
  return `${Math.max(1, Math.ceil(content.trim().split(/\s+/).length / 220))} min read`;
}
function avatar(name) { return escapeHTML(String(name || 'A').split(/\s+/).map(x => x[0]).slice(0,2).join('').toUpperCase()); }
function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  toastRegion.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong.');
    error.fields = data.fields || {};
    error.status = response.status;
    throw error;
  }
  return data;
}

async function loadSession() {
  const data = await api('/api/auth/me');
  state.user = data.user;
  authButton.textContent = state.user ? `Hi, ${state.user.name.split(' ')[0]}` : 'Sign in';
}

async function loadCategories() {
  const data = await api('/api/categories');
  state.categories = data.categories;
}

async function loadPosts() {
  const query = new URLSearchParams();
  if (state.query) query.set('q', state.query);
  if (state.category) query.set('category', state.category);
  const data = await api(`/api/posts?${query.toString()}`);
  state.posts = data.posts;
}

function setActiveNav() {
  document.querySelectorAll('[data-nav]').forEach(node => node.classList.remove('active'));
  const hash = location.hash || '#/';
  const key = hash.startsWith('#/new') || hash.startsWith('#/edit') ? 'new' : 'home';
  document.querySelector(`[data-nav="${key}"]`)?.classList.add('active');
}

function renderHome() {
  const total = state.posts.length;
  const categories = new Set(state.posts.map(p => p.category)).size;
  const featured = state.posts[0];
  const score = Math.min(100, 62 + total * 6 + categories * 4);

  app.innerHTML = `
    <section class="hero">
      <article class="hero-card glass-panel">
        <span class="hero-orb" aria-hidden="true"></span>
        <div class="eyebrow">TODAY'S EDITORIAL FLOW</div>
        <h1>Turn ideas into <em>stories.</em></h1>
        <p class="hero-copy">A focused publishing workspace for discovering thoughtful posts, shaping drafts, and keeping every story organized in one place.</p>
        <div class="hero-actions">
          <button id="heroWrite" class="button button-primary" type="button">Write a post</button>
          <a class="button button-glass" href="#/about">How it works</a>
        </div>
      </article>
      <article class="stats-card glass-panel" aria-label="Publishing summary">
        <div>
          <div class="eyebrow">PUBLISHING PULSE</div>
          <div class="score-ring" style="--score:${score}"><span>${score}</span></div>
        </div>
        <div>
          <div class="stat-label">Published stories</div>
          <div class="stat-value">${total}</div>
          <div class="stat-label">Across ${categories} ${categories === 1 ? 'category' : 'categories'}</div>
        </div>
        ${featured ? `<a class="button button-glass" href="#/post/${encodeURIComponent(featured.slug)}">Read the latest →</a>` : ''}
      </article>
    </section>

    <section class="toolbar glass-panel" aria-label="Post filters">
      <div class="search"><label class="sr-only" for="searchInput">Search posts</label><input id="searchInput" type="search" placeholder="Search stories, tags, topics…" value="${escapeHTML(state.query)}"></div>
      <label class="sr-only" for="categorySelect">Filter by category</label>
      <select id="categorySelect" class="select" aria-label="Filter by category">
        <option value="">All categories</option>
        ${state.categories.map(c => `<option value="${escapeHTML(c.category)}" ${state.category === c.category ? 'selected' : ''}>${escapeHTML(c.category)} (${c.count})</option>`).join('')}
      </select>
      ${state.user ? `<a class="button button-primary" href="#/new">+ New post</a>` : `<span class="toolbar-meta">Sign in from the header to write</span>`}
    </section>

    <div class="section-heading">
      <div><h2>Latest stories</h2><p>${total} ${total === 1 ? 'post' : 'posts'} in your view</p></div>
      ${state.query || state.category ? `<button id="clearFilters" class="link-button" type="button">Clear filters</button>` : ''}
    </div>

    ${state.posts.length ? `<section class="post-grid" aria-label="Blog posts">${state.posts.map(postCard).join('')}</section>` : emptyHome()}
  `;

  document.getElementById('heroWrite').onclick = () => state.user ? navigate('#/new') : navigate('#/login');
  document.getElementById('clearFilters')?.addEventListener('click', async () => { state.query=''; state.category=''; await refreshHome(); });
  const searchInput = document.getElementById('searchInput');
  let debounce;
  searchInput.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(async () => { state.query = searchInput.value.trim(); await refreshHome(); }, 240); });
  document.getElementById('categorySelect').addEventListener('change', async e => { state.category=e.target.value; await refreshHome(); });
}

function postCard(post) {
  const tags = post.tags.slice(0,3).map(t => `<span class="tag">#${escapeHTML(t)}</span>`).join('');
  return `<article class="post-card"><div class="post-top"><span class="category">${escapeHTML(post.category)}</span><span class="read-time">${readTime(post.content)}</span></div><h3>${escapeHTML(post.title)}</h3><p>${escapeHTML(post.excerpt)}</p><div class="tags">${tags}</div><div class="card-bottom"><div class="author"><span class="avatar" aria-hidden="true">${avatar(post.author.name)}</span><span>${escapeHTML(post.author.name)} · ${formatDate(post.createdAt)}</span></div><a class="link-button" href="#/post/${encodeURIComponent(post.slug)}">Read →</a></div></article>`;
}
function emptyHome() {
  return `<section class="empty glass-panel"><div class="empty-icon" aria-hidden="true">✦</div><h3>No stories found</h3><p>Try a different search or clear your filters to explore the full collection.</p><div class="empty-actions"><button id="emptyClear" class="button button-glass" type="button">Clear filters</button><a class="button button-primary" href="#/new">Write a post</a></div></section>`;
}

async function refreshHome() {
  await Promise.all([loadPosts(), loadCategories()]);
  renderHome();
  setActiveNav();
  document.getElementById('emptyClear')?.addEventListener('click', () => { state.query=''; state.category=''; refreshHome(); });
}

async function renderPost(slug) {
  const data = await api('/api/posts?');
  const post = data.posts.find(p => p.slug === slug);
  if (!post) return renderNotFound('Post not found');
  const owner = state.user && state.user.id === post.author.id;
  app.innerHTML = `<section class="reader"><article class="reader-card glass-panel"><header class="reader-header"><div class="eyebrow">${escapeHTML(post.category)}</div><h1>${escapeHTML(post.title)}</h1><p class="lede">${escapeHTML(post.excerpt)}</p><div class="reader-meta"><span>By <strong>${escapeHTML(post.author.name)}</strong> · ${formatDate(post.createdAt)}</span><span>${readTime(post.content)}</span></div><div class="tags">${post.tags.map(t => `<span class="tag">#${escapeHTML(t)}</span>`).join('')}</div></header><div class="reader-content">${post.content.split(/\n\s*\n/).map(p => `<p>${escapeHTML(p).replace(/\n/g,'<br>')}</p>`).join('')}</div>${owner ? `<div class="reader-actions"><a class="button button-glass" href="#/edit/${post.id}">Edit post</a><button id="deletePost" class="button button-danger" type="button">Delete post</button></div>` : ''}</article></section>`;
  document.getElementById('deletePost')?.addEventListener('click', async () => {
    if (!confirm('Delete this post permanently?')) return;
    try { await api(`/api/posts/${post.id}`, { method:'DELETE' }); toast('Post deleted.'); navigate('#/'); } catch (error) { toast(error.message); }
  });
}

function renderEditor(editId = null) {
  const editing = Boolean(editId);
  app.innerHTML = `<section class="editor"><article class="editor-card glass-panel"><div class="editor-header"><div><div class="eyebrow">${editing ? 'EDIT STORY' : 'NEW STORY'}</div><h1>${editing ? 'Shape it.' : 'Write something worth reading.'}</h1><p>${editing ? 'Refine your headline, context, and voice.' : 'Draft, organize, and publish from one calm workspace.'}</p></div><a class="button button-glass" href="#/">Cancel</a></div><div id="formNotice" class="notice" role="alert"></div><form id="postForm" novalidate><div class="form-grid"><div class="field full" data-field="title"><label for="title">Title <small>3–140 characters</small></label><input id="title" maxlength="140" required placeholder="A clear, memorable headline"><div class="error-text"></div></div><div class="field full" data-field="excerpt"><label for="excerpt">Excerpt <small>10–240 characters</small></label><textarea id="excerpt" maxlength="240" required rows="3" placeholder="A concise summary readers can scan before opening the story."></textarea><div class="error-text"></div></div><div class="field" data-field="category"><label for="category">Category</label><input id="category" maxlength="40" value="Design" required placeholder="Design"><div class="error-text"></div></div><div class="field" data-field="tags"><label for="tags">Tags <small>comma separated</small></label><input id="tags" maxlength="180" placeholder="ui, typography, workflow"><div class="error-text"></div></div><div class="field full" data-field="content"><label for="content">Story <small>20–30,000 characters</small></label><textarea id="content" maxlength="30000" required placeholder="Write your story here…"></textarea><div class="error-text"></div></div></div><div class="form-actions"><button class="button button-primary" type="submit">${editing ? 'Save changes' : 'Publish story'} →</button></div></form></article></section>`;

  const form = document.getElementById('postForm');
  if (editing) {
    api(`/api/posts/${editId}`).then(({post}) => {
      if (!state.user || state.user.id !== post.author.id) return navigate('#/login');
      document.getElementById('title').value = post.title;
      document.getElementById('excerpt').value = post.excerpt;
      document.getElementById('category').value = post.category;
      document.getElementById('tags').value = post.tags.join(', ');
      document.getElementById('content').value = post.content;
    }).catch(error => { toast(error.message); navigate('#/'); });
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearErrors();
    const payload = {
      title: document.getElementById('title').value,
      excerpt: document.getElementById('excerpt').value,
      category: document.getElementById('category').value,
      tags: document.getElementById('tags').value,
      content: document.getElementById('content').value
    };
    try {
      const data = await api(editing ? `/api/posts/${editId}` : '/api/posts', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      toast(editing ? 'Changes saved.' : 'Story published.');
      navigate(`#/post/${encodeURIComponent(data.post.slug)}`);
    } catch (error) {
      Object.entries(error.fields || {}).forEach(([key, message]) => showFieldError(key, message));
      const notice = document.getElementById('formNotice'); notice.textContent = error.message; notice.classList.add('show');
    }
  });
}
function clearErrors() { document.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid')); document.querySelectorAll('.error-text').forEach(e => e.textContent=''); document.getElementById('formNotice')?.classList.remove('show'); }
function showFieldError(key, message) { const field = document.querySelector(`[data-field="${key}"]`); if (field) { field.classList.add('invalid'); field.querySelector('.error-text').textContent = message; } }

function renderAuth(mode='login') {
  const login = mode === 'login';
  app.innerHTML = `<section class="auth-shell"><article class="auth-card glass-panel"><div class="eyebrow">${login ? 'WELCOME BACK' : 'JOIN BLOGFLOW'}</div><h1>${login ? 'Continue writing.' : 'Create your author space.'}</h1><p>${login ? 'Sign in to manage the stories you own and publish new ones.' : 'Create an account to publish, edit, and manage your own posts.'}</p><div id="formNotice" class="notice" role="alert"></div><form id="authForm" novalidate>${!login ? `<div class="field" data-field="name"><label for="name">Name</label><input id="name" maxlength="60" required placeholder="Your name"><div class="error-text"></div></div>` : ''}<div class="field" data-field="email"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required placeholder="you@example.com"><div class="error-text"></div></div><div class="field" data-field="password"><label for="password">Password</label><input id="password" type="password" autocomplete="${login ? 'current-password':'new-password'}" required placeholder="At least 8 characters"><div class="error-text"></div></div><div class="form-actions"><button class="button button-primary" type="submit">${login ? 'Sign in' : 'Create account'} →</button></div></form><div class="auth-switch">${login ? 'New here?' : 'Already have an account?'} <button id="authSwitch" type="button">${login ? 'Create an account' : 'Sign in'}</button></div></article></section>`;
  document.getElementById('authSwitch').onclick = () => navigate(login ? '#/register' : '#/login');
  document.getElementById('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    document.querySelectorAll('.field.invalid').forEach(f=>f.classList.remove('invalid'));
    const payload = { email: document.getElementById('email').value, password: document.getElementById('password').value };
    if (!login) payload.name = document.getElementById('name').value;
    try {
      const data = await api(`/api/auth/${login ? 'login':'register'}`, { method:'POST', body:JSON.stringify(payload) });
      state.user = data.user; authButton.textContent = `Hi, ${state.user.name.split(' ')[0]}`; toast(login ? 'Welcome back.' : 'Account created.'); navigate('#/');
    } catch (error) {
      Object.entries(error.fields || {}).forEach(([key, message]) => showFieldError(key, message));
      const notice = document.getElementById('formNotice'); notice.textContent=error.message; notice.classList.add('show');
    }
  });
}

function renderNotFound(message) { app.innerHTML = `<section class="empty glass-panel"><div class="empty-icon">?</div><h3>${escapeHTML(message)}</h3><p>The page you requested doesn't exist or has moved.</p><a class="button button-primary" href="#/">Back to Explore</a></section>`; }
function renderAbout() { app.innerHTML = `<section class="reader"><article class="reader-card glass-panel"><div class="eyebrow">ABOUT BLOGFLOW</div><h1>Publish with clarity.</h1><p class="lede">BlogFlow keeps content creation intentionally simple: discover stories, sign in, write, publish, and manage the work you own.</p><div class="reader-content"><p>Public readers can browse and search posts without an account.</p><p>Authorized authors can create, edit, and delete their own stories. The application validates data on both client and server sides, stores content in SQLite, and keeps authentication state in an HTTP-only session cookie.</p></div><div class="reader-actions"><a class="button button-primary" href="#/new">Start writing →</a><a class="button button-glass" href="#/">Explore stories</a></div></article></section>`; }

function navigate(hash) { location.hash = hash; }
async function render() {
  setActiveNav();
  const hash = location.hash || '#/';
  const [route, param] = hash.replace(/^#\//,'').split('/');
  try {
    if (route === '' || route === undefined) return await refreshHome();
    if (route === 'post') return await renderPost(decodeURIComponent(param || ''));
    if (route === 'new') { if (!state.user) return navigate('#/login'); return renderEditor(); }
    if (route === 'edit') { if (!state.user) return navigate('#/login'); return renderEditor(Number(param)); }
    if (route === 'login') return renderAuth('login');
    if (route === 'register') return renderAuth('register');
    if (route === 'about') return renderAbout();
    return renderNotFound('Page not found');
  } catch (error) {
    app.innerHTML = `<section class="empty glass-panel"><div class="empty-icon">!</div><h3>Something went wrong</h3><p>${escapeHTML(error.message)}</p><a class="button button-primary" href="#/">Try again</a></section>`;
  } finally {
    app.focus({ preventScroll:true });
  }
}

authButton.addEventListener('click', async () => {
  if (!state.user) return navigate('#/login');
  await api('/api/auth/logout', { method:'POST' });
  state.user = null;
  authButton.textContent = 'Sign in';
  toast('Signed out.');
  if (location.hash.startsWith('#/new') || location.hash.startsWith('#/edit')) navigate('#/'); else render();
});

themeButton.addEventListener('click', () => {
  document.body.classList.toggle('light');
  localStorage.setItem('blogflow-theme', document.body.classList.contains('light') ? 'light' : 'dark');
});
if (localStorage.getItem('blogflow-theme') === 'light') document.body.classList.add('light');
window.addEventListener('hashchange', render);

(async function boot() {
  try { await loadSession(); await render(); } catch (error) { renderNotFound(error.message); }
})();
