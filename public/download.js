const box = document.getElementById('box');
const token = location.pathname.split('/')[2] || '';

const MESSAGES = {
  expired: ['!', 'This link has expired', 'Ask the sender to share the file again.'],
  revoked: ['×', 'This link was revoked', 'The sender has turned this link off.'],
  not_found: ['?', 'Link not found', 'Check that you copied the whole link.'],
};

function show(mark, title, text, node) {
  box.replaceChildren();
  const i = document.createElement('div'); i.className = 'big'; i.textContent = mark; i.setAttribute('aria-hidden', 'true');
  const h = document.createElement('h2'); h.textContent = title;
  const p = document.createElement('p'); p.className = 'hint'; p.textContent = text;
  box.append(i, h, p);
  if (node) box.append(node);
}

(async () => {
  try {
    const res = await fetch('/api/s/' + encodeURIComponent(token));
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.status === 'ok') {
      const a = document.createElement('a');
      a.href = '/s/' + encodeURIComponent(token) + '/download';
      a.className = 'btn';
      a.textContent = 'Download';
      const size = data.size < 1024 * 1024 ? (data.size / 1024).toFixed(1) + ' KB' : (data.size / 1024 / 1024).toFixed(2) + ' MB';
      const ext = (data.name.split('.').pop() || 'file').slice(0, 3).toUpperCase();
      show(ext, data.name, size + ' · shared with you', a);
    } else {
      const m = MESSAGES[data.status] || MESSAGES.not_found;
      show(m[0], m[1], m[2]);
    }
  } catch {
    show('!', 'Something went wrong', 'Please try again in a moment.');
  }
})();
