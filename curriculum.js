// Müfredat sekmesi: curriculum-data.js içindeki gramer / kanji / kelime listelerini
// seviyeye ve aramaya göre gösterir. Salt okunur; kelime defteri verisine yazmaz.
(() => {
  const state = { kind: 'grammar', level: 'all', q: '' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LIMIT = 300;

  function rows() {
    const q = state.q.trim().toLowerCase();
    const okLvl = (l) => state.level === 'all' || l === state.level;
    const match = (arr) => !q || arr.some((x) => String(x).toLowerCase().includes(q));
    if (state.kind === 'grammar') {
      return CURR_GRAMMAR.filter((g) => okLvl(g[2]) && match([g[0], g[1], g[3]]))
        .map((g) => ({ main: g[0], sub: g[1], tag: `${g[2]} · ${g[3]}` }));
    }
    if (state.kind === 'kanji') {
      return CURR_KANJI.filter((k) => okLvl(k[1]) && match(k))
        .map((k) => ({ main: k[0], sub: `${k[4]} — ${k[2]} / ${k[3]}`, extra: k[5], tag: k[1] }));
    }
    return CURR_VOCAB.filter((v) => okLvl(v[3]) && match([v[0], v[1], v[2]]))
      .map((v) => ({ main: v[0] + (v[1] ? `（${v[1]}）` : ''), sub: v[2], tag: `${v[3]} · ${v[4]}` }));
  }

  function render() {
    const list = rows();
    document.getElementById('curr-summary').textContent =
      `${list.length} kayıt` + (list.length > LIMIT ? ` (ilk ${LIMIT} gösteriliyor, aramayı daralt)` : '');
    document.getElementById('curr-list').innerHTML = list.slice(0, LIMIT).map((r) =>
      `<li class="item"><div class="item-title">${esc(r.main)} <span class="chip-tag">${esc(r.tag)}</span></div>` +
      `<div class="item-sub">${esc(r.sub)}${r.extra ? `<br>${esc(r.extra)}` : ''}</div></li>`).join('');
  }

  function bindGroup(id, key, attr) {
    const box = document.getElementById(id);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state[key] = b.dataset[attr];
      box.querySelectorAll('button').forEach((x) => x.classList.toggle('selected', x === b));
      render();
    });
  }

  bindGroup('curr-kind', 'kind', 'kind');
  bindGroup('curr-level', 'level', 'level');
  document.getElementById('curr-search').addEventListener('input', (e) => { state.q = e.target.value; render(); });
  document.querySelector('[data-tab="curriculum"]').addEventListener('click', render);

  // Korece seçiliyken sekme gizlenir (veri yalnızca Japonca).
  function syncLang() {
    const ja = (document.querySelector('.lang-btn.active') || {}).dataset?.lang !== 'ko';
    document.querySelector('[data-tab="curriculum"]').hidden = !ja;
  }
  document.querySelectorAll('.lang-btn').forEach((b) => b.addEventListener('click', () => setTimeout(syncLang, 0)));
  syncLang();
})();
