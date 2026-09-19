// Yedek dosyası (JSON) indirme/yükleme ve iki veri kümesini kayıpsız birleştirme.
// Sunucu/hesap yok: her şey tarayıcıda olur, dosyayı sen taşırsın.
//
// Birleştirme "üç yönlü" tasarlandı (son ortak kopya + yerel + gelen): iki
// tarafta yapılan farklı değişiklikler kaybolmaz, silmeler doğru yayılır,
// aynı kelime/cümle iki tarafta ayrı eklendiyse tekleştirilir. Yedek yüklerken
// ortak kopya olmadığı için sonuç "birleşim"dir — yani mevcut veri silinmez.

const SYNC_LANGS = ['ja', 'ko'];
// Önceki (kaldırılan) GitHub senkronizasyonundan kalmış olabilecek kayıtlar.
const LEGACY_SYNC_KEYS = ['kd_sync_cfg', 'kd_sync_base'];

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
  return { words: after.words - before.words, sentences: after.sentences - before.sentences };
}

// ---------- Arayüz ----------

function syncSetStatus(message, isError) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', !!isError);
}

function setupBackupUi() {
  // Kaldırılan GitHub yönteminden kalmış bir token varsa cihazda bırakma.
  LEGACY_SYNC_KEYS.forEach((k) => localStorage.removeItem(k));

  if (!document.getElementById('sync-panel')) return;

  document.getElementById('backup-export-btn').addEventListener('click', () => {
    syncExportBackup();
    syncSetStatus('Yedek dosyası indirildi.');
  });

  document.getElementById('backup-import-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const added = await syncImportBackup(file);
      syncSetStatus(`Yedek yüklendi: ${added.words} yeni kelime, ${added.sentences} yeni cümle eklendi.`);
    } catch (err) {
      syncSetStatus(err instanceof SyncError ? err.message : `Yedek yüklenemedi: ${err.message}`, true);
    }
  });
}
