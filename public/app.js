const $ = (id) => document.getElementById(id);
let registerMode = false;
let toastTimer;

function say(text, isError) {
  const m = $('msg');
  m.textContent = text || '';
  m.className = isError ? 'error' : 'ok';
  clearTimeout(toastTimer);
  if (text) toastTimer = setTimeout(() => { m.textContent = ''; }, 4500);
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
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
const fmtDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const ICONS = { pdf: '📕', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', txt: '📝', zip: '🗜️', docx: '📘' };
const iconFor = (name) => ICONS[name.split('.').pop().toLowerCase()] || '📄';

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
  $('bar-fill').className = pct >= 90 ? 'full' : '';
  $('quota-text').textContent = `${fmtSize(me.used_bytes)} of ${fmtSize(me.quota_bytes)} used`;
  const files = await api('GET', '/api/files');
  const links = files.flatMap((f) => f.links);
  $('st-files').textContent = files.length;
  $('st-links').textContent = links.filter((l) => l.status === 'active').length;
  $('st-dl').textContent = links.reduce((n, l) => n + l.download_count, 0);
  renderFiles(files);
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
  if (!files.length) box.append(el('div', 'Nothing here yet. Drop your first file above 👆', 'card empty'));
  for (const f of files) {
    const card = el('div', undefined, 'card');
    const head = el('div', undefined, 'file-head');
    const info = el('div');
    info.append(el('strong', f.name), el('div', `${fmtSize(f.size)} · uploaded ${fmtDate(f.created_at + 'Z')}`, 'hint'));
    head.append(el('div', iconFor(f.name), 'ico'), info);
    card.append(head);

    const row = el('div', undefined, 'row');
    const sel = el('select');
    for (const [label, secs] of [['Expires in 1 hour', 3600], ['Expires in 1 day', 86400], ['Expires in 7 days', 604800]]) {
      const o = el('option', label); o.value = secs; sel.append(o);
    }
    sel.value = 86400;
    const mk = el('button', '🔗 Create share link');
    const link = el('div', undefined, 'newlink');
    mk.onclick = async () => {
      try {
        const r = await api('POST', `/api/files/${f.id}/links`, { expires_in: Number(sel.value) });
        const url = r.url.startsWith('http') ? r.url : location.origin + r.url;
        link.replaceChildren(el('span', 'Copy this now, it is shown only once: '), el('code', url));
        const copy = el('button', 'Copy', 'ghost');
        copy.onclick = () => navigator.clipboard.writeText(url).then(() => say('Link copied'));
        link.append(' ', copy);
        say('Share link created');
        refreshKeepingLinks(link, f.id);
      } catch (e) { say(e.message === 'Not implemented yet' ? 'Share links are not ready on the server yet' : e.message, true); }
    };
    const del = el('button', 'Delete', 'danger');
    del.onclick = async () => {
      if (!confirm(`Delete "${f.name}" and all its links?`)) return;
      try { await api('DELETE', `/api/files/${f.id}`); say('File deleted'); refresh(); } catch (e) { say(e.message, true); }
    };
    row.append(sel, mk, del);
    card.append(row, link);
    card.dataset.fileId = f.id;

    if (f.links.length) {
      const list = el('div', undefined, 'links');
      for (const l of f.links) {
        const r = el('div', undefined, 'lk');
        r.append(
          el('span', '#' + l.id, 'hint'),
          el('span', l.status, 'badge st-' + l.status),
          el('span', (l.status === 'active' ? 'expires ' : 'expired ') + fmtDate(l.expires_at), 'hint'),
          el('span', `⬇ ${l.download_count}`)
        );
        const slot = el('span');
        if (l.status === 'active') {
          const rv = el('button', 'Revoke', 'ghost');
          rv.onclick = async () => {
            try { await api('POST', `/api/links/${l.id}/revoke`); say('Link revoked'); refresh(); } catch (e) { say(e.message, true); }
          };
          slot.append(rv);
        }
        r.append(slot);
        list.append(r);
      }
      card.append(list);
    }
    box.append(card);
  }
}

async function refresh() {
  try { await showDash(); } catch (e) { /* 401 already switched to login */ }
}

// re-render the list but keep the just-created link visible on its card
async function refreshKeepingLinks(linkNode, fileId) {
  const saved = linkNode.cloneNode(true);
  await refresh();
  const card = document.querySelector(`[data-file-id="${fileId}"] .newlink`);
  if (card) {
    card.replaceChildren(...saved.childNodes);
    const url = card.querySelector('code').textContent;
    card.querySelector('button').onclick = () => navigator.clipboard.writeText(url).then(() => say('Link copied'));
  }
}

$('toggle').onclick = (e) => {
  e.preventDefault();
  registerMode = !registerMode;
  $('auth-title').textContent = registerMode ? 'Create account' : 'Log in';
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

/* ---------- upload ---------- */
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['pdf', 'png', 'jpg', 'jpeg', 'txt', 'zip', 'docx'];

function setPicked(file) {
  $('picked').textContent = file ? `${iconFor(file.name)} ${file.name} (${fmtSize(file.size)})` : '';
  $('upload-btn').hidden = !file;
}

const zone = $('dropzone');
zone.onclick = () => $('file').click();
zone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } };
$('file').onchange = () => setPicked($('file').files[0]);
zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('over'); };
zone.ondragleave = () => zone.classList.remove('over');
zone.ondrop = (e) => {
  e.preventDefault();
  zone.classList.remove('over');
  if (e.dataTransfer.files.length) { $('file').files = e.dataTransfer.files; setPicked($('file').files[0]); }
};

// XHR instead of fetch because fetch can't report upload progress
function uploadWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) onProgress(ev.loaded / ev.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      if (xhr.status === 401) showAuth();
      reject(new Error(data.error || 'Upload failed (' + xhr.status + ')'));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(fd);
  });
}

$('upload-form').onsubmit = async (e) => {
  e.preventDefault();
  const file = $('file').files[0];
  if (!file) return;
  // quick checks for a fast error; the server enforces the same rules again
  const ext = file.name.split('.').pop().toLowerCase();
  if (!ALLOWED.includes(ext)) return say('File type not allowed. Allowed: ' + ALLOWED.join(', '), true);
  if (file.size > MAX_BYTES) return say('File too large (max 10 MB)', true);
  if (file.size === 0) return say('That file is empty', true);

  const btn = $('upload-btn');
  const prog = $('upload-progress');
  btn.disabled = true;
  prog.hidden = false;
  prog.value = 0;
  try {
    say('Uploading...');
    await uploadWithProgress(file, (f) => { prog.value = f; });
    say('Uploaded ' + file.name);
    $('file').value = '';
    setPicked(null);
    refresh();
  } catch (err) { say(err.message, true); }
  finally { btn.disabled = false; prog.hidden = true; }
};

refresh().then(() => { if ($('dash').hidden) showAuth(); });
