const $ = (id) => document.getElementById(id);
let registerMode = false;

function say(text, isError) {
  const m = $('msg');
  m.textContent = text || '';
  m.className = isError ? 'error' : 'ok';
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth')) showAuth();
    throw new Error(data.error || 'Request failed (' + res.status + ')');
  }
  return data;
}

const fmtSize = (b) => (b < 1024 * 1024 ? (b / 1024).toFixed(1) + ' KB' : (b / 1024 / 1024).toFixed(2) + ' MB');
const fmtDate = (iso) => new Date(iso).toLocaleString();

function showAuth() {
  $('auth').hidden = false;
  $('dash').hidden = true;
  $('userbar').hidden = true;
}

async function showDash() {
  const me = await api('GET', '/api/me');
  $('auth').hidden = true;
  $('dash').hidden = false;
  $('userbar').hidden = false;
  $('who').textContent = me.email;
  const pct = Math.min(100, (me.used_bytes / me.quota_bytes) * 100);
  $('bar-fill').style.width = pct + '%';
  $('quota-text').textContent = `${fmtSize(me.used_bytes)} of ${fmtSize(me.quota_bytes)} used`;
  renderFiles(await api('GET', '/api/files'));
}

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function renderFiles(files) {
  const box = $('files');
  box.replaceChildren();
  if (!files.length) box.append(el('p', 'No files yet.', 'hint'));
  for (const f of files) {
    const card = el('div', undefined, 'card');
    card.append(el('strong', f.name), el('span', ` · ${fmtSize(f.size)} · uploaded ${fmtDate(f.created_at + 'Z')}`, 'hint'));

    const row = el('div', undefined, 'row');
    const sel = el('select');
    for (const [label, secs] of [['1 hour', 3600], ['1 day', 86400], ['7 days', 604800]]) {
      const o = el('option', label); o.value = secs; sel.append(o);
    }
    sel.value = 86400;
    const mk = el('button', 'Create share link');
    const link = el('div', undefined, 'newlink');
    mk.onclick = async () => {
      try {
        const r = await api('POST', `/api/files/${f.id}/links`, { expires_in: Number(sel.value) });
        const url = r.url.startsWith('http') ? r.url : location.origin + r.url;
        link.replaceChildren(el('span', 'Link (shown once): '), el('code', url));
        const copy = el('button', 'Copy', 'ghost');
        copy.onclick = () => navigator.clipboard.writeText(url).then(() => say('Link copied'));
        link.append(' ', copy);
        refresh();
      } catch (e) { say(e.message, true); }
    };
    const del = el('button', 'Delete file', 'danger');
    del.onclick = async () => {
      if (!confirm(`Delete "${f.name}" and all its links?`)) return;
      try { await api('DELETE', `/api/files/${f.id}`); say('File deleted'); refresh(); } catch (e) { say(e.message, true); }
    };
    row.append(sel, mk, del);
    card.append(row, link);

    if (f.links.length) {
      const t = el('table');
      const head = el('tr');
      for (const h of ['Link', 'Status', 'Expires', 'Downloads', '']) head.append(el('th', h));
      t.append(head);
      for (const l of f.links) {
        const tr = el('tr');
        tr.append(el('td', '#' + l.id), el('td', l.status, 'st-' + l.status), el('td', fmtDate(l.expires_at)), el('td', String(l.download_count)));
        const td = el('td');
        if (l.status === 'active') {
          const rv = el('button', 'Revoke', 'ghost');
          rv.onclick = async () => {
            try { await api('POST', `/api/links/${l.id}/revoke`); say('Link revoked'); refresh(); } catch (e) { say(e.message, true); }
          };
          td.append(rv);
        }
        tr.append(td);
        t.append(tr);
      }
      card.append(t);
    }
    box.append(card);
  }
}

async function refresh() {
  try { await showDash(); } catch (e) { /* 401 already switched to login */ }
}

$('toggle').onclick = (e) => {
  e.preventDefault();
  registerMode = !registerMode;
  $('auth-title').textContent = registerMode ? 'Register' : 'Log in';
  $('auth-submit').textContent = registerMode ? 'Register' : 'Log in';
  $('toggle').textContent = registerMode ? 'Have an account? Log in' : 'Need an account? Register';
  $('password').autocomplete = registerMode ? 'new-password' : 'current-password';
  say('');
};

$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('POST', registerMode ? '/api/auth/register' : '/api/auth/login', { email: $('email').value, password: $('password').value });
    $('password').value = '';
    say('');
    await refresh();
  } catch (err) { say(err.message, true); }
};

$('logout').onclick = async () => { await api('POST', '/api/auth/logout'); say(''); showAuth(); };

$('upload-form').onsubmit = async (e) => {
  e.preventDefault();
  const file = $('file').files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    say('Uploading...');
    await api('POST', '/api/files', fd);
    say('Uploaded ' + file.name);
    $('file').value = '';
    refresh();
  } catch (err) { say(err.message, true); }
};

refresh().then(() => { if ($('dash').hidden) showAuth(); });
