(() => {
  'use strict';
  // ALLOSERVIX admin console core. No innerHTML anywhere: every dynamic value goes through textContent.
  const App = window.AllosApp = { ctx: { csrf: '', user: null, permissions: [] }, views: [], hooks: {} };
  const $ = App.$ = id => document.getElementById(id);

  App.el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };
  const el = App.el;
  App.can = p => App.ctx.permissions.includes(p);
  App.clear = n => { n.replaceChildren(); return n; };
  App.fmtDate = v => { if (!v) return '—'; const d = new Date(String(v).includes('T') ? v : String(v).replace(' ', 'T') + 'Z'); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('fr-MA', { dateStyle: 'short', timeStyle: 'short' }); };

  // ---- Notifications -----------------------------------------------------------------------
  let toastTimer;
  App.toast = (message, kind = 'ok') => {
    const t = $('toast'); if (!t) return;
    t.textContent = message; t.className = 'toast show ' + kind; t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 8000 : 4000);
  };

  // ---- API with automatic step-up re-authentication ------------------------------------------
  async function rawFetch(path, { method = 'GET', data } = {}) {
    const res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': App.ctx.csrf || '' } : {}) },
      body: data !== undefined ? JSON.stringify(data) : undefined
    });
    let body = {}; try { body = await res.json(); } catch { /* empty */ }
    if (!res.ok) { const e = new Error(body.error || `Erreur HTTP ${res.status}`); e.status = res.status; e.code = body.code; e.body = body; throw e; }
    return body;
  }
  App.api = async (path, opts = {}) => {
    try { return await rawFetch(path, opts); } catch (e) {
      if (e.code === 'reauth_required') { await App.reauth(); return rawFetch(path, opts); }
      if (e.status === 401 && App.ctx.user) { App.ctx.user = null; location.reload(); }
      throw e;
    }
  };
  App.reauth = () => new Promise((resolve, reject) => {
    const dlg = $('reauth'), form = $('reauth-form'), msg = $('reauth-message');
    msg.textContent = ''; form.reset();
    const done = ok => { dlg.close(); form.removeEventListener('submit', submit); $('reauth-cancel').removeEventListener('click', cancel); ok ? resolve() : reject(Object.assign(new Error('Action annulée'), { cancelled: true })); };
    const cancel = () => done(false);
    const submit = async ev => {
      ev.preventDefault();
      try { await rawFetch('/api/admin/reauth', { method: 'POST', data: Object.fromEntries(new FormData(form).entries()) }); done(true); }
      catch (e) { msg.textContent = e.message; }
    };
    form.addEventListener('submit', submit); $('reauth-cancel').addEventListener('click', cancel);
    dlg.addEventListener('cancel', cancel, { once: true });
    dlg.showModal(); form.elements.password.focus();
  });

  // ---- Small UI builders ----------------------------------------------------------------------
  App.chip = (text, kind = 'neutral') => el('span', 'chip chip-' + kind, text);
  App.kpi = (label, value, sub, kind) => { const a = el('article', 'kpi' + (kind ? ' kpi-' + kind : '')); a.append(el('span', 'kpi-label', label), el('strong', 'kpi-value', value ?? '—')); if (sub) a.append(el('small', 'kpi-sub', sub)); return a; };
  App.card = (title, subtitle, actions) => {
    const c = el('section', 'card'), head = el('div', 'card-head'), t = el('div');
    if (subtitle) t.append(el('small', 'eyebrow', subtitle));
    t.append(el('h2', '', title)); head.append(t);
    if (actions) head.append(actions);
    c.append(head); return c;
  };
  App.rows = (items) => { const w = el('div', 'rows'); for (const [k, v, kind] of items) { const r = el('div', 'row'); r.append(el('span', 'row-k', k)); r.append(v instanceof Node ? v : (kind ? App.chip(v, kind) : el('strong', 'row-v', v))); w.append(r); } return w; };
  App.btn = (text, onClick, cls = '') => { const b = el('button', 'btn ' + cls, text); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };
  App.field = (label, input, hint) => { const l = el('label', 'field'); l.append(el('span', 'field-label', label), input); if (hint) l.append(el('small', 'field-hint', hint)); return l; };
  App.input = (attrs = {}) => { const i = el('input'); for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v); return i; };
  App.select = (options, value) => { const s = el('select'); for (const [v, t] of options) { const o = el('option', '', t); o.value = v; s.append(o); } if (value !== undefined) s.value = value; return s; };
  App.empty = text => el('p', 'empty', text);
  App.table = (cols, rows) => {
    const wrap = el('div', 'table-wrap'), t = el('table'), th = el('thead'), tr = el('tr');
    for (const c of cols) tr.append(el('th', '', c)); th.append(tr); t.append(th);
    const tb = el('tbody');
    for (const r of rows) { const row = el('tr'); for (const cell of r) { const td = el('td'); td.append(cell instanceof Node ? cell : document.createTextNode(String(cell ?? '—'))); row.append(td); } tb.append(row); }
    t.append(tb); wrap.append(t); return wrap;
  };
  App.copy = async (text, label = 'Copié') => { try { await navigator.clipboard.writeText(text); App.toast(label); } catch { App.toast('Copie impossible — sélectionnez le texte manuellement', 'error'); } };
  App.guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { if (!e.cancelled) App.toast(e.message, 'error'); } };

  // ---- Views registry + hash router -----------------------------------------------------------
  // view: { id, label, icon, group, perm|null, render(root), external?:url }
  App.register = v => { App.views.push(v); };
  App.current = null;
  App.navigate = async id => {
    const v = App.views.find(x => x.id === id && (!x.perm || App.can(x.perm)));
    if (!v || v.external) return;
    App.current = id;
    document.querySelectorAll('#nav [data-view]').forEach(b => { const on = b.dataset.view === id; b.classList.toggle('active', on); b.toggleAttribute('aria-current', on); });
    $('view-title').textContent = v.label; document.title = v.label + ' | ALLOSERVIX Control';
    const root = App.clear($('view')); root.className = 'view view-' + id;
    document.body.classList.remove('nav-open');
    try { await v.render(root); } catch (e) { root.append(el('p', 'error-box', 'Chargement impossible : ' + e.message)); }
    if (location.hash.slice(1) !== id && !location.hash.startsWith('#invite=')) history.replaceState(null, '', '#' + id);
  };
  App.buildNav = () => {
    const nav = App.clear($('nav'));
    const groups = [['Pilotage', 'pilotage'], ['Contenu & intelligence', 'content'], ['Opérations', 'ops'], ['Gouvernance', 'gov']];
    for (const [label, key] of groups) {
      const items = App.views.filter(v => v.group === key && (!v.perm || App.can(v.perm)));
      if (!items.length) continue;
      nav.append(el('p', 'nav-group', label));
      for (const v of items) {
        const n = v.external ? el('a', 'nav-item') : el('button', 'nav-item'); n.dataset.view = v.id;
        if (v.external) { n.href = v.external; } else { n.type = 'button'; n.addEventListener('click', () => App.navigate(v.id)); }
        n.append(el('span', 'nav-icon', v.icon || '•'), el('span', 'nav-label', v.label));
        nav.append(n);
      }
    }
  };
})();
