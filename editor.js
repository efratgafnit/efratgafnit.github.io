// עורך ויזואלי לאתר. נפתח כשמוסיפים ?edit לכתובת (efratgafnit.github.io/?edit).
// לחיצה על טקסט עורכת אותו, לחיצה על תמונה מחליפה אותה (מוקטנת אוטומטית),
// ופריטים ברשימות אפשר לשכפל, למחוק ולהזיז. "פרסום" שומר ישירות למאגר ב-GitHub
// בעזרת מפתח גישה (Token) שנשמר רק בדפדפן של מי שעורך.
(() => {
  const API = 'https://api.github.com/repos/efratgafnit/efratgafnit.github.io/contents/';
  const TEXT_SEL = 'h1,h2,h3,p,li,summary,dt,dd,cite,.eyebrow,.how b';
  const LIST_SEL = '.cards,.fit,.how,.tests,.faq,.quals,.tags';
  const MAX_IMG_BYTES = 250 * 1024;
  const TOKEN_KEY = 'ed-gh-token';
  const main = document.querySelector('main');
  const pending = new Map(); // image path -> base64, uploaded on publish
  let loadedSha = null, dirty = false, busy = false;

  // ---------- UI ----------
  const style = document.createElement('style');
  style.textContent = `
body.ed-on{padding-top:56px}
body.ed-on header{top:56px}
body.ed-on .wa-float,body.ed-on .a11y-btn,body.ed-on .a11y-panel{display:none}
.ed-bar{position:fixed;top:0;right:0;left:0;height:56px;z-index:1000;background:#1f2a2a;color:#fff;display:flex;align-items:center;gap:8px;padding:0 16px;font-family:Assistant,sans-serif;direction:rtl}
.ed-bar b{white-space:nowrap}
.ed-status{flex:1;font-size:.9rem;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ed-bar button,.ed-bar a,.ed-box button{background:#2a8a8a;color:#fff;border:0;border-radius:999px;padding:8px 16px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;white-space:nowrap}
.ed-bar .ed-ghost,.ed-box .ed-ghost{background:transparent;border:1px solid #7bb;color:inherit}
.ed-bar button:disabled{opacity:.5;cursor:wait}
main [contenteditable]{outline:1px dashed rgba(42,138,138,.5);outline-offset:3px;border-radius:4px;cursor:text}
main [contenteditable]:hover{outline-color:#2a8a8a}
main [contenteditable]:focus{outline:2px solid #2a8a8a;background:rgba(217,238,236,.4)}
.ed-img{cursor:pointer;position:relative;outline:2px dashed #2a8a8a;outline-offset:4px}
.ed-img::after{content:"📷 לחצו להחלפת תמונה";position:absolute;bottom:12px;left:50%;transform:translateX(-50%);background:rgba(31,42,42,.85);color:#fff;padding:4px 12px;border-radius:999px;font-size:.8rem;font-weight:600;white-space:nowrap;pointer-events:none}
.logo-ph.ed-img::after{content:"📷";padding:1px 3px;bottom:-8px;font-size:.65rem}
.ed-item{position:absolute;z-index:999;display:none;gap:2px;background:#1f2a2a;padding:3px;border-radius:10px;direction:rtl;box-shadow:0 4px 14px rgba(0,0,0,.25)}
.ed-item button{background:none;border:0;color:#fff;font:600 .85rem Assistant,sans-serif;padding:4px 8px;cursor:pointer;border-radius:7px}
.ed-item button:hover{background:#2a8a8a}
.ed-modal{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1001;display:grid;place-items:center;padding:16px}
.ed-box{background:#fff;color:#222;border-radius:16px;padding:24px;max-width:460px;width:100%;direction:rtl;font-family:Assistant,sans-serif;line-height:1.6}
.ed-box input{width:100%;margin:12px 0;padding:10px;border:1px solid #bbb;border-radius:10px;font:inherit;direction:ltr}
.ed-box .ed-row{display:flex;gap:8px}
@media(max-width:700px){.ed-bar{gap:5px;padding:0 8px}.ed-bar b,.ed-long{display:none}.ed-bar button,.ed-bar a{padding:7px 10px;font-size:.85rem}}`;
  document.head.append(style);

  const bar = document.createElement('div');
  bar.className = 'ed-bar';
  bar.innerHTML = `<b>✏️ מצב עריכה</b><span class="ed-status" role="status"></span>
    <button data-a="publish">פרסום</button>
    <button data-a="reset" class="ed-ghost">ביטול שינויים</button>
    <button data-a="logout" class="ed-ghost" title="מחיקת מפתח הגישה מהדפדפן הזה">ניתוק</button>
    <a href="${location.pathname}?view" class="ed-ghost">יציאה<span class="ed-long"> ממצב עריכה</span></a>`;
  const statusEl = bar.querySelector('.ed-status');
  const status = t => { statusEl.textContent = t; statusEl.title = t; };
  const publishBtn = bar.querySelector('[data-a=publish]');

  const itemBar = document.createElement('div');
  itemBar.className = 'ed-item';
  itemBar.innerHTML = '<button data-a="up" title="הזזה אחורה">→</button><button data-a="down" title="הזזה קדימה">←</button><button data-a="dup">⧉ שכפול</button><button data-a="del">✕ מחיקה</button>';
  document.body.append(bar, itemBar);
  document.body.classList.add('ed-on');

  // ---------- GitHub ----------
  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
  const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

  async function gh(method, path, body) {
    const headers = { Accept: 'application/vnd.github+json' };
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(API + path + (method === 'GET' ? '?ref=main&t=' + Date.now() : ''),
      { method, headers, cache: 'no-store', body: body && JSON.stringify(body) });
    if (!res.ok) { const e = new Error('GitHub ' + res.status); e.status = res.status; throw e; }
    return res.json();
  }

  const toB64 = str => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const fromB64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

  async function getSource() {
    let file;
    try { file = await gh('GET', 'index.html'); }
    catch (e) { if (e.status !== 401) throw e; setToken(null); file = await gh('GET', 'index.html'); }
    return { sha: file.sha, doc: new DOMParser().parseFromString(fromB64(file.content), 'text/html') };
  }

  function askToken() {
    return new Promise(resolve => {
      const m = document.createElement('div');
      m.className = 'ed-modal';
      m.innerHTML = `<div class="ed-box" role="dialog" aria-label="חיבור ל-GitHub">
        <h3 style="margin:0 0 6px">חיבור ל-GitHub</h3>
        <p style="margin:0">כדי לפרסם צריך להזין פעם אחת מפתח גישה (Token). הוא נשמר רק בדפדפן הזה.</p>
        <input type="password" placeholder="github_pat_..." autocomplete="off" aria-label="מפתח גישה">
        <div class="ed-row"><button data-ok>שמירה ופרסום</button><button data-cancel class="ed-ghost">ביטול</button></div></div>`;
      const input = m.querySelector('input');
      const done = val => { m.remove(); resolve(val); };
      m.querySelector('[data-ok]').onclick = () => { const v = input.value.trim(); if (v) { setToken(v); done(true); } else input.focus(); };
      m.querySelector('[data-cancel]').onclick = () => done(false);
      input.onkeydown = e => { if (e.key === 'Enter') m.querySelector('[data-ok]').click(); if (e.key === 'Escape') done(false); };
      document.body.append(m);
      input.focus();
    });
  }

  // ---------- editing ----------
  const markDirty = () => { dirty = true; };

  function makeEditable(root) {
    const els = [...(root.matches?.(TEXT_SEL) ? [root] : []), ...root.querySelectorAll(TEXT_SEL)];
    els.forEach(el => {
      if (el.closest('form') || el.classList.contains('form-msg')) return;
      if (el.querySelector('a,svg,input,button,img')) return;
      if (el.parentElement.closest('[contenteditable]')) return;
      el.contentEditable = 'true';
      el.spellcheck = true;
    });
  }

  function itemOf(el) {
    const list = el.closest(LIST_SEL);
    if (!list || el === list) return null;
    let it = el;
    while (it.parentElement !== list) it = it.parentElement;
    return it;
  }

  let current = null;
  function showItemBar(it) {
    current = it;
    const r = it.getBoundingClientRect();
    itemBar.style.display = 'flex';
    itemBar.style.top = (r.top + scrollY + 4) + 'px';
    itemBar.style.left = (r.left + scrollX + 4) + 'px';
  }
  main.addEventListener('mouseover', e => { const it = itemOf(e.target); if (it) showItemBar(it); });
  main.addEventListener('focusin', e => { const it = itemOf(e.target); if (it) showItemBar(it); });
  itemBar.addEventListener('mousedown', e => e.preventDefault());
  itemBar.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.a;
    if (!a || !current) return;
    if (a === 'dup') { const c = current.cloneNode(true); current.after(c); showItemBar(c); }
    if (a === 'del') {
      if (current.parentElement.children.length <= 1) return status('אי אפשר למחוק את הפריט האחרון ברשימה');
      if (!confirm('למחוק את הפריט הזה?')) return;
      current.remove(); current = null; itemBar.style.display = 'none';
    }
    if (a === 'up' && current.previousElementSibling) { current.previousElementSibling.before(current); showItemBar(current); }
    if (a === 'down' && current.nextElementSibling) { current.nextElementSibling.after(current); showItemBar(current); }
    markDirty();
  });

  main.addEventListener('input', markDirty);
  main.addEventListener('paste', e => {
    if (!e.target.closest?.('[contenteditable]')) return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  main.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest?.('[contenteditable]')) { e.preventDefault(); document.execCommand('insertLineBreak'); }
  });
  // links and FAQ toggles stay put while editing
  main.addEventListener('click', e => { if (e.target.closest('a,summary')) e.preventDefault(); }, true);

  // ---------- images ----------
  function shrink(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        const ctx = c.getContext('2d');
        if (file.type === 'image/png') {
          ctx.drawImage(img, 0, 0, c.width, c.height);
          const png = c.toDataURL('image/png');
          if (png.length * 0.75 <= MAX_IMG_BYTES) return resolve(png);
        }
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        let q = 0.85, out;
        do { out = c.toDataURL('image/jpeg', q); q -= 0.1; } while (out.length * 0.75 > MAX_IMG_BYTES && q > 0.35);
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(); };
      img.src = url;
    });
  }

  function pickImage(slot) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      status('מכין את התמונה...');
      try {
        const dataUrl = await shrink(file, +slot.dataset.max || 1200);
        const ext = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
        const path = `images/${slot.dataset.img}-${Date.now()}.${ext}`;
        const prev = slot.querySelector('img[data-src]');
        if (prev) pending.delete(prev.dataset.src);
        pending.set(path, dataUrl.split(',')[1]);
        slot.classList.add('has-img');
        slot.removeAttribute('role'); slot.removeAttribute('aria-label');
        const img = new Image();
        img.src = dataUrl; img.dataset.src = path; img.alt = slot.dataset.alt || '';
        slot.replaceChildren(img);
        markDirty();
        status(`התמונה מוכנה (${Math.round(dataUrl.length * 0.75 / 1024)}KB). לחצו "פרסום" כדי לשמור`);
      } catch {
        status('לא הצלחתי לקרוא את הקובץ. נסו תמונה בפורמט JPG או PNG');
      }
    };
    input.click();
  }
  document.addEventListener('click', e => {
    const slot = e.target.closest('[data-img]');
    if (!slot || !slot.classList.contains('ed-img')) return;
    e.preventDefault(); e.stopPropagation();
    pickImage(slot);
  }, true);

  // ---------- save ----------
  function clean(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll('[contenteditable] [style]').forEach(n => n.removeAttribute('style'));
    [c, ...c.querySelectorAll('*')].forEach(n => {
      n.removeAttribute('contenteditable'); n.removeAttribute('spellcheck');
      if (n.classList.contains('ed-img')) { n.classList.remove('ed-img'); if (!n.classList.length) n.removeAttribute('class'); }
    });
    c.querySelectorAll('details').forEach(d => d.removeAttribute('open'));
    c.querySelectorAll('.form-msg').forEach(m => { m.textContent = ''; m.removeAttribute('style'); });
    c.querySelectorAll('button[disabled]').forEach(b => b.removeAttribute('disabled'));
    c.querySelectorAll('img[data-src]').forEach(i => { i.setAttribute('src', i.dataset.src); i.removeAttribute('data-src'); });
    return c;
  }

  async function publish() {
    if (busy) return;
    if (!dirty && !pending.size) return status('אין שינויים לפרסם');
    if (!getToken() && !(await askToken())) return;
    busy = true; publishBtn.disabled = true; status('מפרסם...');
    try {
      const { sha, doc } = await getSource();
      if (loadedSha && sha !== loadedSha &&
          !confirm('מישהו אחר פרסם שינויים מאז שפתחתם את העורך. לפרסם בכל זאת? השינויים שלו יידרסו.')) {
        return status('הפרסום בוטל. רעננו את העמוד כדי לטעון את הגרסה החדשה');
      }
      for (const [path, b64] of pending) {
        status('מעלה תמונה...');
        await gh('PUT', path, { message: 'תמונה חדשה מהעורך', content: b64, branch: 'main' });
        pending.delete(path);
      }
      doc.querySelector('main').innerHTML = clean(main).innerHTML;
      document.querySelectorAll('header [data-img]').forEach(el => {
        const t = doc.querySelector(`header [data-img="${el.dataset.img}"]`);
        if (t) t.outerHTML = clean(el).outerHTML;
      });
      const html = '<!doctype html>\n' + doc.documentElement.outerHTML + '\n';
      const res = await gh('PUT', 'index.html', { message: 'עדכון תוכן מהעורך', content: toB64(html), sha, branch: 'main' });
      loadedSha = res.content.sha;
      dirty = false;
      status('✓ פורסם! האתר יתעדכן תוך כמה דקות');
    } catch (e) {
      if (e.status === 401) { setToken(null); status('מפתח הגישה לא תקין. לחצו שוב על "פרסום" והזינו מפתח חדש'); }
      else if (e.status === 403 || e.status === 404) status('למפתח אין הרשאת כתיבה למאגר. בדקו את הגדרות המפתח');
      else if (e.status === 409 || e.status === 422) status('התנגשות עם שינוי אחר. רעננו את העמוד ונסו שוב');
      else status('הפרסום נכשל. בדקו את החיבור לאינטרנט ונסו שוב');
    } finally {
      busy = false; publishBtn.disabled = false;
    }
  }

  bar.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'publish') publish();
    if (a === 'reset' && confirm('לבטל את כל השינויים שלא פורסמו?')) { dirty = false; pending.clear(); location.reload(); }
    if (a === 'logout') { setToken(null); status('המפתח נמחק מהדפדפן הזה'); }
  });
  addEventListener('beforeunload', e => { if (dirty || pending.size) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- start: edit the latest published version, not a cached copy ----------
  (async () => {
    status('טוען את הגרסה העדכנית...');
    try {
      const { sha, doc } = await getSource();
      loadedSha = sha;
      main.innerHTML = doc.querySelector('main').innerHTML;
      document.querySelectorAll('header [data-img]').forEach(el => {
        const t = doc.querySelector(`header [data-img="${el.dataset.img}"]`);
        if (t) el.replaceWith(document.importNode(t, true));
      });
    } catch {
      status('לא הצלחתי לטעון את הגרסה העדכנית. עורכים את מה שמוצג בעמוד');
    }
    main.querySelectorAll('details').forEach(d => { d.open = true; });
    makeEditable(main);
    document.querySelectorAll('[data-img]').forEach(s => s.classList.add('ed-img'));
    if (!statusEl.textContent.startsWith('לא')) status('לחצו על טקסט כדי לערוך, או על תמונה כדי להחליף');
  })();
})();
