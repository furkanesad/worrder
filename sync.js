// Bulut senkronizasyonu (kullanıcının kendi GitHub hesabındaki gizli bir gist)
// ve JSON yedek indirme/yükleme. Sunucu yok: veri tarayıcı ile GitHub arasında
// doğrudan gider, token sadece bu tarayıcının localStorage'ında durur.
//
// Birleştirme "üç yönlü" yapılır (git gibi): son başarılı senkronizasyonun
// kopyası (base) ile şu anki yerel veri ve buluttaki veri karşılaştırılır.
// Böylece iki cihazda yapılan farklı değişiklikler kaybolmaz ve silmeler
// doğru yayılır — "son yazan kazanır" yöntemi bunu yapamazdı.

const SYNC_FILE = 'kelime-defterim-sync.json';
const SYNC_CFG_KEY = 'kd_sync_cfg';
const SYNC_BASE_KEY = 'kd_sync_base';
const SYNC_LANGS = ['ja', 'ko'];
const SYNC_DEBOUNCE_MS = 2500;

class SyncError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// ---------- Veri şekli ----------

function syncSortKeys(v) {
  if (Array.isArray(v)) return v.map(syncSortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).sort().forEach((k) => { out[k] = syncSortKeys(v[k]); });
    return out;
  }
  return v;
}

function syncStable(v) {
  return JSON.stringify(syncSortKeys(v));
}

// Yeni bir alan eklenirse burada da listelenmeli, yoksa senkronizasyonda düşer.
function syncSanitizeLang(d) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const isStr = (v) => typeof v === 'string';

  const categories = arr(d && d.categories)
    .filter((c) => c && isStr(c.id) && isStr(c.name) && c.name.trim())
    .map((c) => ({ id: c.id, name: c.name }));

  const words = arr(d && d.words)
    .filter((w) => w && isStr(w.id) && isStr(w.text) && w.text.trim())
    .map((w) => {
      const ids = Array.isArray(w.categoryIds) ? w.categoryIds : (w.categoryId ? [w.categoryId] : []);
      const out = { id: w.id, text: w.text, categoryIds: ids.filter(isStr), type: isStr(w.type) ? w.type : null };
      if (isStr(w.meaning) && w.meaning) out.meaning = w.meaning;
      return out;
    });

  const sentences = arr(d && d.sentences)
    .filter((s) => s && isStr(s.id) && isStr(s.text) && s.text.trim())
    .map((s) => {
      const out = { id: s.id, text: s.text };
      if (isStr(s.translation) && s.translation) out.translation = s.translation;
      return out;
    });

  return { categories, words, sentences };
}

function syncSanitize(data) {
  const out = {};
  SYNC_LANGS.forEach((lang) => { out[lang] = syncSanitizeLang(data && data[lang]); });
  return out;
}

function syncCanonItem(kind, item) {
  if (kind === 'words') return { ...item, categoryIds: [...(item.categoryIds || [])].sort() };
  return item;
}

function syncCanonData(data) {
  const out = {};
  SYNC_LANGS.forEach((lang) => {
    const d = (data && data[lang]) || {};
    out[lang] = {
      categories: (d.categories || []).map((x) => syncCanonItem('categories', x)),
      words: (d.words || []).map((x) => syncCanonItem('words', x)),
      sentences: (d.sentences || []).map((x) => syncCanonItem('sentences', x)),
    };
  });
  return out;
}

// ---------- Birleştirme ----------

function syncMergeItem(kind, l, r) {
  const out = { ...r, ...l };
  if (kind === 'words') {
    out.categoryIds = [...new Set([...(l.categoryIds || []), ...(r.categoryIds || [])])];
    const meaning = l.meaning || r.meaning;
    if (meaning) out.meaning = meaning;
    out.type = l.type || r.type || null;
  }
  if (kind === 'sentences') {
    const translation = l.translation || r.translation;
    if (translation) out.translation = translation;
  }
  return out;
}

// base/local/remote: id'li öğe dizileri. Sırayı korur: önce yerel sıra, sonra
// sadece bulutta olanlar.
function syncMergeCollection(kind, base, local, remote) {
  const toMap = (arr) => new Map((arr || []).filter((x) => x && x.id).map((x) => [x.id, x]));
  const b = toMap(base);
  const l = toMap(local);
  const r = toMap(remote);

  const same = (x, y) => {
    if (x === undefined || y === undefined) return x === y;
    return syncStable(syncCanonItem(kind, x)) === syncStable(syncCanonItem(kind, y));
  };

  const ids = new Set([...l.keys(), ...r.keys(), ...b.keys()]);
  const result = new Map();
  const localNew = new Set();
  const remoteNew = new Set();

  ids.forEach((id) => {
    const bi = b.get(id);
    const li = l.get(id);
    const ri = r.get(id);
    if (bi === undefined && li !== undefined && ri === undefined) localNew.add(id);
    if (bi === undefined && ri !== undefined && li === undefined) remoteNew.add(id);

    const lChanged = !same(li, bi);
    const rChanged = !same(ri, bi);
    let out;
    if (!lChanged) out = rChanged ? ri : li;
    else if (!rChanged) out = li;
    else if (li === undefined) out = ri; // yerelde silindi, bulutta düzenlendi: düzenleme kazanır
    else if (ri === undefined) out = li;
    else out = syncMergeItem(kind, li, ri);
    if (out !== undefined) result.set(id, out);
  });

  const items = [];
  const seen = new Set();
  [local, remote].forEach((arr) => {
    (arr || []).forEach((x) => {
      if (x && result.has(x.id) && !seen.has(x.id)) {
        items.push(result.get(x.id));
        seen.add(x.id);
      }
    });
  });

  return { items, localNew, remoteNew };
}

// Kategori adları uygulamada zaten benzersiz (addCategoryByName engelliyor).
// İki cihaz aynı varsayılan kategorileri ayrı kimliklerle oluşturmuş olabilir;
// adı aynı olanları birleştirir, en eski kimliği (küçük olan) tutar.
function syncDedupeCategories(items) {
  const keepByName = new Map();
  const remap = {};
  [...items].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((c) => {
    const key = normalize(c.name);
    const keep = keepByName.get(key);
    if (!keep) keepByName.set(key, c);
    else remap[c.id] = keep.id;
  });
  return { items: items.filter((c) => !remap[c.id]), remap };
}

// İki cihaz aynı kelimeyi/cümleyi (örn. "örnek veri" düğmesi) birbirinden
// habersiz eklemiş olabilir. Sadece "yerelde yeni" ile "bulutta yeni" öğeler
// eşleştirilir; aynı cihazda bilerek eklenmiş kopyalara dokunulmaz.
function syncDedupeNewItems(kind, items, localNew, remoteNew) {
  const keyOf = (it) => (kind === 'words' ? normalize(it.text) : it.text.trim());
  const byKey = new Map();
  items.forEach((it) => {
    if (localNew.has(it.id) && !byKey.has(keyOf(it))) byKey.set(keyOf(it), it);
  });

  const drop = new Set();
  const upgraded = new Map();
  items.forEach((it) => {
    if (!remoteNew.has(it.id)) return;
    const twin = byKey.get(keyOf(it));
    if (!twin) return;
    const [keep, lose] = twin.id < it.id ? [twin, it] : [it, twin];
    upgraded.set(keep.id, syncMergeItem(kind, keep, lose));
    drop.add(lose.id);
    byKey.set(keyOf(it), keep);
  });

  return items.filter((it) => !drop.has(it.id)).map((it) => upgraded.get(it.id) || it);
}

function syncMergeAll(base, local, remote) {
  const out = {};
  SYNC_LANGS.forEach((lang) => {
    const B = (base && base[lang]) || {};
    const L = (local && local[lang]) || {};
    const R = (remote && remote[lang]) || {};

    const cats = syncMergeCollection('categories', B.categories, L.categories, R.categories);
    const wordsM = syncMergeCollection('words', B.words, L.words, R.words);
    const sentsM = syncMergeCollection('sentences', B.sentences, L.sentences, R.sentences);

    const dedupedCats = syncDedupeCategories(cats.items);
    const validCatIds = new Set(dedupedCats.items.map((c) => c.id));

    const words = syncDedupeNewItems('words', wordsM.items, wordsM.localNew, wordsM.remoteNew).map((w) => ({
      ...w,
      categoryIds: [...new Set((w.categoryIds || []).map((id) => dedupedCats.remap[id] || id).filter((id) => validCatIds.has(id)))],
    }));
    const sentences = syncDedupeNewItems('sentences', sentsM.items, sentsM.localNew, sentsM.remoteNew);

    out[lang] = { categories: dedupedCats.items, words, sentences };
  });
  return syncCanonData(out);
}

// ---------- Yerel depo ----------

function syncCollectLocal() {
  const out = {};
  SYNC_LANGS.forEach((lang) => {
    const keys = storageKeys(lang);
    out[lang] = {
      categories: readJSON(keys.categories, []),
      words: readJSON(keys.words, []),
      sentences: readJSON(keys.sentences, []),
    };
  });
  return syncCanonData(syncSanitize(out));
}

function syncApplyLocal(data) {
  SYNC_LANGS.forEach((lang) => {
    const keys = storageKeys(lang);
    localStorage.setItem(keys.categories, JSON.stringify(data[lang].categories));
    localStorage.setItem(keys.words, JSON.stringify(data[lang].words));
    localStorage.setItem(keys.sentences, JSON.stringify(data[lang].sentences));
  });
  loadAll();
  renderNewWordChips();
  renderFilterChips();
  renderTypeFilterChips();
  refreshCurrentView();
}

function syncCount(data) {
  let w = 0;
  let s = 0;
  SYNC_LANGS.forEach((lang) => { w += data[lang].words.length; s += data[lang].sentences.length; });
  return { words: w, sentences: s };
}

// ---------- GitHub Gist ----------

function syncGetCfg() {
  return readJSON(SYNC_CFG_KEY, null);
}

function syncSetCfg(cfg) {
  if (cfg) localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(SYNC_CFG_KEY);
}

async function syncGh(token, path, opts) {
  const o = opts || {};
  const method = o.method || 'GET';
  // GitHub GET yanıtlarını ~60 sn önbelleğe aldırıyor; başka cihazın yazdığı
  // veriyi hemen görmek için URL'yi her seferinde benzersiz yapıyoruz (özel
  // başlıklar CORS ön kontrolünü bozabileceğinden başlık yerine parametre).
  const url = `https://api.github.com${path}${method === 'GET' ? `${path.includes('?') ? '&' : '?'}_=${Date.now()}` : ''}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  if (o.body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, { method, headers, body: o.body ? JSON.stringify(o.body) : undefined });
  } catch (e) {
    throw new SyncError('GitHub\'a ulaşılamadı (internet bağlantını kontrol et).', 0);
  }
  if (res.status === 401) throw new SyncError('Token geçersiz veya süresi dolmuş. Bağlantıyı kesip yeni bir token ile tekrar bağlan.', 401);
  if (res.status === 403) throw new SyncError('GitHub isteği reddetti (token izni eksik ya da istek sınırı doldu). Biraz sonra tekrar dene.', 403);
  if (res.status === 404) throw new SyncError('Gist bulunamadı (silinmiş olabilir). Bağlantıyı kesip yeniden bağlan.', 404);
  if (!res.ok) throw new SyncError(`GitHub hatası (${res.status}).`, res.status);
  return res;
}

async function syncFetchRemote(cfg) {
  const res = await syncGh(cfg.token, `/gists/${cfg.gistId}`);
  const gist = await res.json();
  const file = gist.files && gist.files[SYNC_FILE];
  if (!file) return null;

  let content = file.content;
  if (file.truncated && file.raw_url) {
    const raw = await fetch(`${file.raw_url}${file.raw_url.includes('?') ? '&' : '?'}_=${Date.now()}`);
    content = await raw.text();
  }
  if (!content || !content.trim()) return null;

  let doc;
  try {
    doc = JSON.parse(content);
  } catch (e) {
    throw new SyncError('Buluttaki dosya bozuk görünüyor; üzerine yazmamak için durdum.', 0);
  }
  if (doc.version && doc.version > 1) throw new SyncError('Buluttaki veri daha yeni bir uygulama sürümüne ait; sayfayı yenile.', 0);
  return syncCanonData(syncSanitize(doc.data));
}

async function syncPushRemote(cfg, data) {
  const content = JSON.stringify({ app: 'kelime-defterim', version: 1, savedAt: new Date().toISOString(), data });
  await syncGh(cfg.token, `/gists/${cfg.gistId}`, { method: 'PATCH', body: { files: { [SYNC_FILE]: { content } } } });
}

let syncRunning = false;
let syncQueued = false;
let syncTimer = null;
let syncLastRunAt = 0;

function scheduleSync(delay) {
  if (!syncGetCfg()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay === undefined ? SYNC_DEBOUNCE_MS : delay);
}

async function runSync() {
  const cfg = syncGetCfg();
  if (!cfg) return;
  if (syncRunning) {
    syncQueued = true;
    return;
  }
  syncRunning = true;
  syncSetStatus('busy', 'Senkronize ediliyor...');

  try {
    const remote = await syncFetchRemote(cfg);
    const baseDoc = readJSON(SYNC_BASE_KEY, null);
    const base = baseDoc ? syncCanonData(syncSanitize(baseDoc)) : null;
    const local = syncCollectLocal();
    const merged = syncMergeAll(base, local, remote);

    if (syncStable(merged) !== syncStable(local)) syncApplyLocal(merged);
    if (!remote || syncStable(merged) !== syncStable(remote)) await syncPushRemote(cfg, merged);

    localStorage.setItem(SYNC_BASE_KEY, JSON.stringify(merged));
    syncLastRunAt = Date.now();
    syncSetCfg({ ...cfg, lastSync: syncLastRunAt });
    syncSetStatus('ok');
  } catch (e) {
    syncSetStatus('error', e instanceof SyncError ? e.message : `Senkronizasyon hatası: ${e.message}`);
  } finally {
    syncRunning = false;
    if (syncQueued) {
      syncQueued = false;
      scheduleSync(300);
    }
  }
}

async function syncConnect(rawToken) {
  const token = (rawToken || '').trim();
  if (!token) throw new SyncError('Önce token\'ı yapıştır.', 0);

  let found = null;
  let scopes = null;
  for (let page = 1; page <= 5 && !found; page++) {
    const res = await syncGh(token, `/gists?per_page=100&page=${page}`);
    scopes = res.headers.get('x-oauth-scopes');
    const list = await res.json();
    found = list.find((g) => g.files && g.files[SYNC_FILE]) || null;
    if (list.length < 100) break;
  }
  if (scopes !== null && !/\bgist\b/.test(scopes)) {
    throw new SyncError('Bu token\'da "gist" izni yok. Yukarıdaki bağlantıdan yeni bir token oluştur.', 403);
  }

  let gistId = found && found.id;
  if (!gistId) {
    const res = await syncGh(token, '/gists', {
      method: 'POST',
      body: {
        description: 'Kelime Defterim senkronizasyon verisi (silme)',
        public: false,
        files: { [SYNC_FILE]: { content: JSON.stringify({ app: 'kelime-defterim', version: 1, data: syncSanitize({}) }) } },
      },
    });
    gistId = (await res.json()).id;
  }

  syncSetCfg({ token, gistId, lastSync: null });
  localStorage.removeItem(SYNC_BASE_KEY);
  await runSync();
}

// ---------- Yedek dosyası ----------

function syncExportBackup() {
  const payload = { app: 'kelime-defterim', version: 1, exportedAt: new Date().toISOString(), data: syncCollectLocal() };
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kelime-defterim-yedek-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Yedeği mevcut verilerle birleştirir (üzerine yazmaz), böylece yanlışlıkla
// eski bir yedek yüklense bile sonradan eklenenler kaybolmaz.
async function syncImportBackup(file) {
  const text = await file.text();
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new SyncError('Bu dosya geçerli bir JSON değil.', 0);
  }
  if (!doc || doc.app !== 'kelime-defterim' || !doc.data) throw new SyncError('Bu dosya bir Kelime Defterim yedeği gibi görünmüyor.', 0);

  const imported = syncCanonData(syncSanitize(doc.data));
  const local = syncCollectLocal();
  const before = syncCount(local);
  const merged = syncMergeAll(null, local, imported);
  syncApplyLocal(merged);
  const after = syncCount(merged);
  scheduleSync();
  return { words: after.words - before.words, sentences: after.sentences - before.sentences };
}

// ---------- Arayüz ----------

function syncSetStatus(kind, message) {
  const statusEl = document.getElementById('sync-status');
  const badge = document.getElementById('sync-badge');
  if (!statusEl || !badge) return;

  const cfg = syncGetCfg();
  statusEl.classList.toggle('error', kind === 'error');

  if (kind === 'ok') {
    const t = cfg && cfg.lastSync ? new Date(cfg.lastSync).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
    statusEl.textContent = `Senkronize edildi${t ? ` (${t})` : ''}.`;
    badge.textContent = 'bağlı';
  } else if (kind === 'busy') {
    statusEl.textContent = message;
    badge.textContent = 'senkronize ediliyor';
  } else if (kind === 'error') {
    statusEl.textContent = message;
    badge.textContent = 'hata';
  } else {
    statusEl.textContent = message || '';
    badge.textContent = cfg ? 'bağlı' : 'bağlı değil';
  }
}

function syncRenderUi() {
  const connected = !!syncGetCfg();
  document.getElementById('sync-disconnected').hidden = connected;
  document.getElementById('sync-connected').hidden = !connected;
  if (!connected) syncSetStatus('idle', '');
}

function setupSyncUi() {
  if (!document.getElementById('sync-panel')) return;

  const withButton = async (btn, busyText, fn) => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = busyText;
    try {
      await fn();
    } catch (e) {
      syncSetStatus('error', e instanceof SyncError ? e.message : `Hata: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  };

  document.getElementById('sync-connect-btn').addEventListener('click', () => {
    const input = document.getElementById('sync-token');
    withButton(document.getElementById('sync-connect-btn'), 'Bağlanılıyor...', async () => {
      await syncConnect(input.value);
      if (syncGetCfg()) input.value = '';
      syncRenderUi();
    });
  });

  document.getElementById('sync-now-btn').addEventListener('click', () => {
    withButton(document.getElementById('sync-now-btn'), 'Senkronize ediliyor...', () => runSync());
  });

  document.getElementById('sync-disconnect-btn').addEventListener('click', () => {
    syncSetCfg(null);
    localStorage.removeItem(SYNC_BASE_KEY);
    syncRenderUi();
    syncSetStatus('idle', 'Bağlantı kesildi. Bu cihazdaki veriler olduğu gibi duruyor.');
  });

  document.getElementById('backup-export-btn').addEventListener('click', () => {
    syncExportBackup();
    syncSetStatus('idle', 'Yedek dosyası indirildi.');
  });

  document.getElementById('backup-import-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const added = await syncImportBackup(file);
      syncSetStatus('idle', `Yedek yüklendi: ${added.words} yeni kelime, ${added.sentences} yeni cümle eklendi.`);
    } catch (err) {
      syncSetStatus('error', err instanceof SyncError ? err.message : `Yedek yüklenemedi: ${err.message}`);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && syncGetCfg() && Date.now() - syncLastRunAt > 15000) scheduleSync(300);
  });
  window.addEventListener('online', () => scheduleSync(500));

  syncRenderUi();
  if (syncGetCfg()) scheduleSync(800);
}
