// Kelime Defterim - tamamen tarayıcıda çalışan, localStorage tabanlı Japonca kelime defteri.

// Aktif dil ('ja' = Japonca, 'ko' = Korece). Kelimeler/Cümleler/Cümle Üret/
// İstatistik/Flash Kart sekmeleri aynı arayüzü kullanır, sadece hangi
// verinin (ve hangi dile özgü özelliklerin — furigana, kanji dönüştürme,
// gramer kontrolü sadece Japonca'da var) aktif olduğu buna göre değişir.
let currentLang = 'ja';

let categories = [];
let words = [];
let sentences = [];

// Filtre: seçili kategori id'leri (boşsa "Hepsi" anlamına gelir).
let filterCategoryIds = new Set();
let filterNoCategory = false;

// Filtre: seçili gramer türleri (İsim/Fiil/Sıfat... — boşsa "Hepsi").
let filterTypes = new Set();

// Yeni kelime eklerken seçilen kategoriler.
let newWordCategoryIds = new Set();

// Yeni kelime eklerken elle seçilen tür (null = otomatik algıla).
let newWordType = null;

// Kelime arama kutusundaki metin.
let searchQuery = '';

// Uygulama ilk açıldığında (hiç kategori yoksa) hazır gelen varsayılan
// kategoriler — kelimeleri kolayca gruplayıp filtreleyebilmek için.
const DEFAULT_CATEGORIES = {
  ja: ['Fiiller', 'İsimler', 'Sıfatlar', 'Zarflar', 'Parçacıklar',
    'Zaman', 'Sayılar', 'Aile', 'Yiyecek-İçecek', 'Hayvanlar', 'Renkler', 'JLPT N5'],
  ko: ['Fiiller', 'İsimler', 'Sıfatlar', 'Zarflar', 'Parçacıklar',
    'Zaman', 'Sayılar', 'Aile', 'Yiyecek-İçecek', 'Hayvanlar', 'Renkler', 'TOPIK Temel'],
};

// "categories.length === 0" tek başına güvenilir bir "ilk kullanım" ölçütü
// değil: kullanıcı sonradan bütün kategorilerini silerse tekrar tekrar
// varsayılanlar geri gelirdi. Bu yüzden bir kereliğine çalıştığını ayrıca
// localStorage'da (dile özel) işaretliyoruz.
function ensureDefaultCategories() {
  const seededKey = currentLang === 'ja' ? 'kd_defaults_seeded' : `kd_defaults_seeded_${currentLang}`;
  if (localStorage.getItem(seededKey)) return;
  if (categories.length === 0) {
    (DEFAULT_CATEGORIES[currentLang] || DEFAULT_CATEGORIES.ja).forEach((name) => addCategoryByName(name));
  }
  localStorage.setItem(seededKey, '1');
}

// ---------- Depolama ----------

// Japonca veriler geriye dönük uyumluluk için eksiz (suffix'siz) anahtarlarda
// kalıyor (uygulama uzun süre tek dilliydi); Korece gibi sonradan eklenen
// diller "_<dil>" ekli kendi anahtarlarını kullanıyor.
function storageKeys(lang) {
  if (lang === 'ja') return { categories: 'kd_categories', words: 'kd_words', sentences: 'kd_sentences' };
  return { categories: `kd_categories_${lang}`, words: `kd_words_${lang}`, sentences: `kd_sentences_${lang}` };
}

// Uygulamanın önceki (çift dilli) sürümü Japonca verisini "_ja" ekli
// anahtarlarda tutuyordu. Var olan kelimeler kaybolmasın diye bir
// kereliğine düz anahtarlara taşıyoruz.
function migrateFromLangScopedStorage() {
  const jaKeys = storageKeys('ja');
  const pairs = [
    ['kd_categories_ja', jaKeys.categories],
    ['kd_words_ja', jaKeys.words],
    ['kd_sentences_ja', jaKeys.sentences],
  ];
  pairs.forEach(([oldKey, newKey]) => {
    if (localStorage.getItem(newKey) === null && localStorage.getItem(oldKey) !== null) {
      localStorage.setItem(newKey, localStorage.getItem(oldKey));
    }
  });
}

function loadAll() {
  const keys = storageKeys(currentLang);
  categories = readJSON(keys.categories, []);
  words = readJSON(keys.words, []);
  sentences = readJSON(keys.sentences, []);

  // Eski veri biçimiyle (tek categoryId) uyumluluk: categoryIds dizisine çevir.
  words = words.map((w) => {
    if (Array.isArray(w.categoryIds)) return w;
    return { ...w, categoryIds: w.categoryId ? [w.categoryId] : [] };
  });
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveCategories() {
  localStorage.setItem(storageKeys(currentLang).categories, JSON.stringify(categories));
}

function saveWords() {
  localStorage.setItem(storageKeys(currentLang).words, JSON.stringify(words));
}

function saveSentences() {
  localStorage.setItem(storageKeys(currentLang).sentences, JSON.stringify(sentences));
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalize(text) {
  return (text || '').toLocaleLowerCase('tr-TR').trim();
}

// ---------- Japonca morfolojik analiz (kuromoji.js) ----------
// Japoncada kelimeler boşlukla ayrılmadığı ve fiil/sıfatlar çekimlendiği için
// ("食べる" / "食べました" / "食べています" hepsi aynı kelime) gerçek bir
// sözlük tabanlı morfolojik analizöre (kuromoji, IPADIC sözlüğü) ihtiyaç var.
// Sözlük dosyaları ilk açılışta vendor/dict altından indirilir.

let jaTokenizer = null;
let jaTokenizerLoading = false;
let jaTokenizerCallbacks = [];
const jaAnalysisCache = new Map();

const JA_POS_LABELS = {
  '名詞': 'İsim',
  '動詞': 'Fiil',
  '形容詞': 'Sıfat (i-adj)',
  '形容動詞': 'Sıfat (na-adj)',
  '副詞': 'Zarf',
  '助詞': 'Parçacık (joshi)',
  '助動詞': 'Yardımcı fiil',
  '連体詞': 'Sıfat (bağlantılı)',
  '接続詞': 'Bağlaç',
  '感動詞': 'Ünlem',
  '記号': 'Sembol',
  'フィラー': 'Dolgu',
  'その他': 'Diğer',
};

// Tür filtresi için daha az/daha kaba gruplar (örn. i-adj/na-adj tek "Sıfat").
const JA_TYPE_FILTER_GROUPS = {
  '名詞': 'İsim',
  '動詞': 'Fiil',
  '形容詞': 'Sıfat',
  '形容動詞': 'Sıfat',
  '連体詞': 'Sıfat',
  '副詞': 'Zarf',
  '助詞': 'Parçacık',
  '助動詞': 'Parçacık',
  '接続詞': 'Bağlaç',
  '感動詞': 'Ünlem',
};

const TYPE_FILTER_ORDER = ['İsim', 'Fiil', 'Sıfat', 'Zarf', 'Parçacık', 'Bağlaç', 'Ünlem'];

function setLangStatus(msg) {
  const el = document.getElementById('lang-status');
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

function ensureJaTokenizer(callback) {
  if (jaTokenizer) {
    if (callback) callback(jaTokenizer);
    return;
  }
  if (callback) jaTokenizerCallbacks.push(callback);
  if (jaTokenizerLoading) return;
  if (typeof kuromoji === 'undefined') {
    setLangStatus('Japonca analiz kütüphanesi yüklenemedi.');
    return;
  }

  jaTokenizerLoading = true;
  setLangStatus('Japonca analiz motoru hazırlanıyor (ilk seferde sözlük indiriliyor, ~17MB)...');

  kuromoji.builder({ dicPath: 'vendor/dict/' }).build((err, tokenizer) => {
    jaTokenizerLoading = false;
    if (err) {
      console.error(err);
      setLangStatus('Japonca analiz motoru yüklenemedi: ' + err.message);
      return;
    }
    jaTokenizer = tokenizer;
    setLangStatus('');
    const callbacks = jaTokenizerCallbacks;
    jaTokenizerCallbacks = [];
    callbacks.forEach((cb) => cb(tokenizer));
    refreshCurrentView();
  });
}

function jaAnalyze(text) {
  // Tek nokta koruması: currentLang 'ko' iken kuromoji (Japonca sözlük)
  // yanlışlıkla Korece metne uygulanmasın — bu fonksiyonu kullanan her yer
  // (furigana, arama, tür algılama, örnek cümle eşleştirme...) otomatik
  // olarak korunmuş olur.
  if (currentLang !== 'ja' || !jaTokenizer || !text) return null;
  if (jaAnalysisCache.has(text)) return jaAnalysisCache.get(text);
  const tokens = jaTokenizer.tokenize(text).map((t) => ({
    surface: t.surface_form,
    base: (t.basic_form && t.basic_form !== '*') ? t.basic_form : t.surface_form,
    pos: t.pos,
    posDetail: (t.pos_detail_1 && t.pos_detail_1 !== '*') ? t.pos_detail_1 : null,
    reading: (t.reading && t.reading !== '*') ? t.reading : null,
    conjugated_type: t.conjugated_type || null,
  }));
  jaAnalysisCache.set(text, tokens);
  return tokens;
}

function matchSequenceCount(targetTokens, textTokens) {
  if (targetTokens.length === 0) return 0;
  if (targetTokens.length === 1) {
    const target = targetTokens[0];
    return textTokens.filter((t) => t === target).length;
  }
  let count = 0;
  for (let i = 0; i <= textTokens.length - targetTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < targetTokens.length; j++) {
      if (textTokens[i + j] !== targetTokens[j]) {
        ok = false;
        break;
      }
    }
    if (ok) count++;
  }
  return count;
}

function countWordInText(word, text) {
  if (currentLang === 'ko') {
    // Korece için morfolojik analiz yok; Hangıl zaten fonetik olduğundan
    // basit alt-dize eşleşmesi yeterince iyi bir yaklaşım.
    if (!word) return 0;
    return text.split(word).length - 1;
  }
  const wTokens = jaAnalyze(word);
  const tTokens = jaAnalyze(text);
  if (!wTokens || !tTokens) return 0;
  return matchSequenceCount(wTokens.map((t) => t.base), tTokens.map((t) => t.base));
}

// "勉強する" gibi isim+する fiil kalıplarında baştaki token isim olsa da
// bütün kelime fiil sayılmalı — bu yüzden 動詞 varsa onu tercih ediyoruz.
function jaMainToken(tokens) {
  if (!tokens || tokens.length === 0) return null;
  return tokens.find((t) => t.pos === '動詞') || tokens.find((t) => t.pos !== '記号') || tokens[0];
}

// IPADIC, na-sıfatları (形容動詞: 好き/元気/静か/上手 gibi) sözlük/kök
// formunda "名詞 (isim) + 形容動詞語幹 (na-sıfat kökü)" olarak etiketler —
// üst seviye pos alanı tek başına bakılırsa hepsi yanlışlıkla "İsim" çıkar.
// Bu yüzden asıl dilbilgisel işlevini bu kombinasyona bakarak buluyoruz.
function effectivePos(token) {
  if (token.pos === '名詞' && token.posDetail === '形容動詞語幹') return '形容動詞';
  return token.pos;
}

function jaPosLabel(text) {
  const main = jaMainToken(jaAnalyze(text));
  if (!main) return null;
  const pos = effectivePos(main);
  return JA_POS_LABELS[pos] || pos;
}

// Tür filtresinde kullanılan kaba grup (İsim/Fiil/Sıfat/Zarf/Parçacık/Bağlaç/Ünlem).
function jaTypeGroup(text) {
  const main = jaMainToken(jaAnalyze(text));
  if (!main) return null;
  return JA_TYPE_FILTER_GROUPS[effectivePos(main)] || null;
}

// Korece için kuromoji gibi bir morfolojik analizör yok; basit son-ek
// sezgileriyle kaba bir tahmin yapılıyor (kesin değil — kullanıcı türü
// elle de seçebilir).
function koTypeGroup(text) {
  if (/(다)$/.test(text)) return 'Fiil';
  if (/(에서|에게|께서|이에요|예요|은|는|이|가|을|를|도|만|와|과)$/.test(text)) return 'Parçacık';
  return 'İsim';
}

function autoTypeGroup(text) {
  return currentLang === 'ko' ? koTypeGroup(text) : jaTypeGroup(text);
}

// Bir kelimenin türü: kelime eklenirken elle seçildiyse onu, yoksa
// dile göre otomatik algılanan türü kullanır.
function wordType(w) {
  return w.type || autoTypeGroup(w.text);
}

function jaReadingHiragana(text) {
  const tokens = jaAnalyze(text);
  if (!tokens || tokens.length === 0) return null;
  const rawReading = tokens.map((t) => t.reading || t.surface).join('');
  if (!rawReading) return null;
  const hiragana = (typeof wanakana !== 'undefined') ? wanakana.toHiragana(rawReading) : rawReading;
  return hiragana === text ? null : hiragana;
}

// ---------- Kanji dönüştürme (Google Girdi Araçları) ----------
// kuromoji/wanakana tamamen offline çalışır ama bunlar gerçek bir IME değil:
// yazdığın okunuşu (örn. "watashi") gerçek kanjiye ("私") çevirebilmek için
// güncel, büyük bir IME sözlüğüne ihtiyaç var. Bunu tarayıcıda barındırmak
// yerine Google'ın herkese açık girdi aracı servisine bağlanıyoruz — bu,
// dönüştürmek istediğin metnin internet üzerinden Google'a gönderilmesi
// anlamına gelir (kullanıcı bu tercihi onayladı).

async function fetchKanjiCandidates(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  try {
    const url = `https://www.google.com/inputtools/request?text=${encodeURIComponent(trimmed)}&itc=ja-t-i0-und&num=8&cp=0&cs=1&ie=utf-8&oe=utf-8&app=test`;
    const res = await fetch(url);
    const data = await res.json();
    if (data[0] !== 'SUCCESS' || !data[1] || !data[1][0]) return [];
    return data[1][0][1] || [];
  } catch (e) {
    console.error('Kanji önerisi alınamadı:', e);
    return null;
  }
}

function renderKanjiCandidates(containerId, candidates, inputEl) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (candidates === null) {
    container.hidden = false;
    container.innerHTML = '<span class="empty-text" style="padding:2px 0;">Kanji önerisi alınamadı, internet bağlantısını kontrol et.</span>';
    return;
  }
  if (!candidates.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  candidates.forEach((cand) => {
    const chip = document.createElement('span');
    chip.className = 'chip kanji-candidate';
    chip.textContent = cand;
    chip.addEventListener('click', () => {
      inputEl.value = cand;
      container.hidden = true;
      container.innerHTML = '';
      inputEl.focus();
    });
    container.appendChild(chip);
  });
}

function setupKanjiButton(btnId, inputId, candidatesId) {
  const btn = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const candidates = await fetchKanjiCandidates(input.value);
    btn.disabled = false;
    renderKanjiCandidates(candidatesId, candidates, input);
  });
}

// ---------- Japonca dilbilgisi/üslup kontrolü (textlint + Japonca kural seti) ----------
// kuromoji sadece kelimeleri ayrıştırır (morfoloji), gerçek dilbilgisi/üslup
// hatalarını (ら抜き言葉, çift olumsuzluk, aynı edatın art arda kullanımı,
// zayıf ifadeler vb.) yakalamaz. Bunun için textlint'in Japonca teknik yazım
// kural setini (textlint-rule-preset-ja-technical-writing) tarayıcı için
// paketleyip vendor/ja-grammar-check.js olarak ekledik — tamamen offline
// çalışır, kuromoji'nin zaten indirdiği sözlüğü paylaşır.

async function runGrammarCheck(text) {
  if (typeof window.jaGrammarChecker === 'undefined') {
    return { error: 'Gramer kontrol kütüphanesi yüklenemedi.' };
  }
  try {
    const messages = await window.jaGrammarChecker.checkJapaneseGrammar(text);
    return { messages };
  } catch (e) {
    console.error('Gramer kontrolü başarısız:', e);
    return { error: 'Gramer kontrolü sırasında bir hata oluştu.' };
  }
}

function renderGrammarResult(container, outcome) {
  container.hidden = false;
  container.classList.remove('ok');

  if (outcome.error) {
    container.textContent = outcome.error;
    return;
  }

  if (outcome.messages.length === 0) {
    container.classList.add('ok');
    container.textContent = '✓ Belirgin bir dilbilgisi/üslup sorunu bulunamadı.';
    return;
  }

  const items = outcome.messages
    .map((m) => `<li>${escapeHtml(m.message.split('\n')[0])} <span class="rule-id">(${escapeHtml(m.ruleId)})</span></li>`)
    .join('');
  container.innerHTML = `<div>${outcome.messages.length} olası sorun bulundu:</div><ul>${items}</ul>`;
}

function setupGrammarButton(btnId, inputId, resultId) {
  const btn = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  const result = document.getElementById(resultId);
  btn.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Kontrol ediliyor...';
    const outcome = await runGrammarCheck(text);
    btn.disabled = false;
    btn.textContent = original;
    renderGrammarResult(result, outcome);
  });
}

// ---------- Genel sayım ----------

function countWordInSentences(word) {
  return sentences.reduce((sum, s) => sum + countWordInText(word, s.text), 0);
}

function categoryNames(ids) {
  if (!ids || ids.length === 0) return 'Kategorisiz';
  const names = ids
    .map((id) => categories.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => c.name);
  return names.length ? names.join(', ') : 'Kategorisiz';
}

// Kategoriler + gramer türü bilgisini birleştiren etiket. Tür elle seçildiyse
// onu, yoksa (motor hazırsa) otomatik algılanan türü gösterir. Okunuş artık
// ayrı satırda değil, kelimenin altında furigana olarak gösteriliyor.
function wordSubLabel(w) {
  const catPart = categoryNames(w.categoryIds);

  if (w.type) return `${catPart} · Tür: ${w.type}`;
  if (currentLang === 'ko') {
    const pos = koTypeGroup(w.text);
    return pos ? `${catPart} · Tür: ${pos}` : catPart;
  }
  if (!jaTokenizer) return `${catPart} · Tür: analiz bekleniyor...`;

  const pos = jaPosLabel(w.text);
  return pos ? `${catPart} · Tür: ${pos}` : catPart;
}

// Kanji içeren metni, her kanji bölümünün altında küçük hiragana okunuşuyla
// (furigana) birlikte <ruby> olarak render eder. Kanji olmayan kısımlar
// (zaten hiragana/katakana, noktalama vb.) olduğu gibi bırakılır. Korece
// zaten tamamen fonetik (Hangıl) olduğu için furigana benzeri bir okunuş
// gösterimine ihtiyaç yok — metin olduğu gibi gösterilir.
function displayHtml(text) {
  if (currentLang === 'ko') return escapeHtml(text);
  return furiganaHtml(text);
}

function furiganaHtml(text) {
  const tokens = jaAnalyze(text);
  if (!tokens) return escapeHtml(text);

  return tokens.map((t) => {
    const surface = t.surface;
    const hasKanji = /[一-鿿]/.test(surface);
    if (!hasKanji || !t.reading) return escapeHtml(surface);
    const hira = (typeof wanakana !== 'undefined') ? wanakana.toHiragana(t.reading) : t.reading;
    if (hira === surface) return escapeHtml(surface);
    return `<ruby>${escapeHtml(surface)}<rt>${escapeHtml(hira)}</rt></ruby>`;
  }).join('');
}

// ---------- Sesli okuma (Web Speech API — tamamen çevrimdışı, tarayıcının
// kendi ses motorunu kullanır, internet veya API anahtarı gerekmez) ----------

function speakLangCode() {
  return currentLang === 'ko' ? 'ko-KR' : 'ja-JP';
}

function speak(text, lang) {
  if (!text || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  speechSynthesis.speak(utter);
}

function makeSpeakButton(text, lang) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'speak-btn';
  btn.title = 'Sesli oku';
  btn.textContent = '🔊';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    speak(text, lang);
  });
  return btn;
}

// ---------- Kana IME (WanaKana) ----------
// Sadece Japonca'da anlamlı (romaji yazarken otomatik hiragana/katakana'ya
// çevirir); Korece'de kullanıcı işletim sisteminin kendi Korece klavyesini
// kullanır, bu yüzden dil değişince bind/unbind ediliyor.

const IME_INPUT_IDS = ['word-input', 'sentence-input', 'word-search', 'stats-search', 'flashcard-search'];

function applyImeBinding() {
  if (typeof wanakana === 'undefined') return;
  IME_INPUT_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (currentLang === 'ja') wanakana.bind(el);
    else wanakana.unbind(el);
  });
}

// window.confirm() bazı görüntüleme ortamlarında (gömülü webview vb.)
// sessizce engellenebiliyor — kategori eklemede prompt() ile aynı sorunu
// yaşamıştık. Silme işlemlerinde aynı riski taşımamak için native confirm()
// yerine "tekrar tıkla" onayı kullanıyoruz.
function armDeleteButton(btn, armedText, onConfirm) {
  let armed = false;
  let timer = null;
  const originalText = btn.textContent;
  const originalTitle = btn.title;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!armed) {
      armed = true;
      btn.textContent = armedText;
      btn.title = 'Onaylamak için tekrar tıkla';
      btn.classList.add('confirming');
      timer = setTimeout(() => {
        armed = false;
        btn.textContent = originalText;
        btn.title = originalTitle;
        btn.classList.remove('confirming');
      }, 3000);
      return;
    }
    clearTimeout(timer);
    onConfirm();
  });
}

function refreshCurrentView() {
  renderWordList();
  renderSentenceList();
  renderStats();
  renderFlashcard();
}

// ---------- Sekmeler ----------

function setupTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'stats') renderStats();
      if (btn.dataset.tab === 'flashcards') renderFlashcard();
    });
  });
}

// ---------- Kelimeler sekmesi ----------

function addCategoryByName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const existing = categories.find((c) => normalize(c.name) === normalize(trimmed));
  if (existing) return existing;
  const cat = { id: makeId(), name: trimmed };
  categories.push(cat);
  saveCategories();
  return cat;
}

let newCategoryInputOpen = false;

function renderNewWordTypeChips() {
  const container = document.getElementById('new-word-type-chips');
  container.innerHTML = '';

  const autoChip = document.createElement('span');
  autoChip.className = 'chip' + (newWordType === null ? ' selected' : '');
  autoChip.textContent = 'Otomatik';
  autoChip.addEventListener('click', () => {
    newWordType = null;
    renderNewWordTypeChips();
  });
  container.appendChild(autoChip);

  TYPE_FILTER_ORDER.forEach((type) => {
    const chip = document.createElement('span');
    chip.className = 'chip' + (newWordType === type ? ' selected' : '');
    chip.textContent = type;
    chip.addEventListener('click', () => {
      newWordType = (newWordType === type) ? null : type;
      renderNewWordTypeChips();
    });
    container.appendChild(chip);
  });
}

function renderNewWordChips() {
  const container = document.getElementById('new-word-chips');
  container.innerHTML = '';

  categories.forEach((cat) => {
    const chip = document.createElement('span');
    chip.className = 'chip' + (newWordCategoryIds.has(cat.id) ? ' selected' : '');
    chip.textContent = cat.name;
    chip.addEventListener('click', () => {
      if (newWordCategoryIds.has(cat.id)) {
        newWordCategoryIds.delete(cat.id);
      } else {
        newWordCategoryIds.add(cat.id);
      }
      renderNewWordChips();
    });
    container.appendChild(chip);
  });

  if (newCategoryInputOpen) {
    const wrap = document.createElement('span');
    wrap.className = 'chip chip-input';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'chip-input-field';
    input.placeholder = 'Kategori adı, Enter\'a bas';
    wrap.appendChild(input);
    container.appendChild(wrap);

    let settled = false;
    const commit = () => {
      if (settled) return;
      settled = true;
      const cat = addCategoryByName(input.value);
      newCategoryInputOpen = false;
      if (cat) newWordCategoryIds.add(cat.id);
      renderNewWordChips();
      renderFilterChips();
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      newCategoryInputOpen = false;
      renderNewWordChips();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        cancel();
      }
    });
    input.addEventListener('blur', () => {
      if (input.value.trim()) commit();
      else cancel();
    });

    input.focus();
  } else {
    const addChip = document.createElement('span');
    addChip.className = 'chip chip-add';
    addChip.textContent = '+ Kategori';
    addChip.addEventListener('click', () => {
      newCategoryInputOpen = true;
      renderNewWordChips();
    });
    container.appendChild(addChip);
  }
}

// Kategori filtre chip'leri hem Kelimeler hem İstatistik sekmesinde aynı
// paylaşılan state'i (filterCategoryIds/filterNoCategory) gösterir.
const FILTER_CHIPS_CONTAINER_IDS = ['filter-chips', 'stats-filter-chips', 'flashcard-filter-chips'];
const TYPE_FILTER_CHIPS_CONTAINER_IDS = ['type-filter-chips', 'stats-type-filter-chips', 'flashcard-type-filter-chips'];

function onFilterChanged() {
  renderFilterChips();
  renderWordList();
  renderStats();
  renderFlashcard();
}

function onTypeFilterChanged() {
  renderTypeFilterChips();
  renderWordList();
  renderStats();
  renderFlashcard();
}

function renderFilterChips() {
  FILTER_CHIPS_CONTAINER_IDS.forEach((containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const allChip = document.createElement('span');
    const allSelected = filterCategoryIds.size === 0 && !filterNoCategory;
    allChip.className = 'chip' + (allSelected ? ' selected' : '');
    allChip.textContent = 'Hepsi';
    allChip.addEventListener('click', () => {
      filterCategoryIds.clear();
      filterNoCategory = false;
      onFilterChanged();
    });
    container.appendChild(allChip);

    const noneChip = document.createElement('span');
    noneChip.className = 'chip' + (filterNoCategory ? ' selected' : '');
    noneChip.textContent = 'Kategorisiz';
    noneChip.addEventListener('click', () => {
      filterNoCategory = !filterNoCategory;
      onFilterChanged();
    });
    container.appendChild(noneChip);

    categories.forEach((cat) => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (filterCategoryIds.has(cat.id) ? ' selected' : '');
      chip.textContent = cat.name;
      chip.addEventListener('click', () => {
        if (filterCategoryIds.has(cat.id)) {
          filterCategoryIds.delete(cat.id);
        } else {
          filterCategoryIds.add(cat.id);
        }
        onFilterChanged();
      });

      const del = document.createElement('span');
      del.className = 'del-cat';
      del.textContent = '✕';
      del.title = 'Kategoriyi sil';
      armDeleteButton(del, '✓', () => deleteCategory(cat.id));
      chip.appendChild(del);

      container.appendChild(chip);
    });
  });
}

function deleteCategory(id) {
  const cat = categories.find((c) => c.id === id);
  if (!cat) return;

  categories = categories.filter((c) => c.id !== id);
  saveCategories();

  words = words.map((w) => ({ ...w, categoryIds: (w.categoryIds || []).filter((cid) => cid !== id) }));
  saveWords();

  filterCategoryIds.delete(id);
  newWordCategoryIds.delete(id);

  renderFilterChips();
  renderNewWordChips();
  renderWordList();
  renderStats();
  renderFlashcard();
}

function renderTypeFilterChips() {
  TYPE_FILTER_CHIPS_CONTAINER_IDS.forEach((containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const allChip = document.createElement('span');
    allChip.className = 'chip' + (filterTypes.size === 0 ? ' selected' : '');
    allChip.textContent = 'Hepsi';
    allChip.addEventListener('click', () => {
      filterTypes.clear();
      onTypeFilterChanged();
    });
    container.appendChild(allChip);

    TYPE_FILTER_ORDER.forEach((type) => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (filterTypes.has(type) ? ' selected' : '');
      chip.textContent = type;
      chip.addEventListener('click', () => {
        if (filterTypes.has(type)) {
          filterTypes.delete(type);
        } else {
          filterTypes.add(type);
        }
        onTypeFilterChanged();
      });
      container.appendChild(chip);
    });
  });
}

// Kelime metnini, veya (analiz motoru hazırsa) okunuşunu arama sorgusuyla karşılaştırır.
function wordMatchesSearch(w, query) {
  const q = normalize(query);
  if (!q) return true;
  if (normalize(w.text).includes(q)) return true;

  const tokens = jaAnalyze(w.text);
  if (!tokens) return false;
  const rawReading = tokens.map((t) => t.reading || t.surface).join('');
  const hira = (typeof wanakana !== 'undefined') ? wanakana.toHiragana(rawReading) : rawReading;
  return normalize(hira).includes(q);
}

// Kategori, tür ve arama filtrelerini birlikte uygular — Kelimeler ve
// İstatistik sekmeleri aynı paylaşılan filtre state'ini kullanır.
function getFilteredWords() {
  let filtered = words;

  const hasSpecificFilter = filterCategoryIds.size > 0 || filterNoCategory;
  if (hasSpecificFilter) {
    filtered = filtered.filter((w) => {
      const ids = w.categoryIds || [];
      const matchesNone = filterNoCategory && ids.length === 0;
      const matchesCategory = ids.some((id) => filterCategoryIds.has(id));
      return matchesNone || matchesCategory;
    });
  }

  if (filterTypes.size > 0) {
    filtered = filtered.filter((w) => {
      const t = w.type || (currentLang === 'ko' || jaTokenizer ? autoTypeGroup(w.text) : null);
      return t && filterTypes.has(t);
    });
  }

  if (searchQuery.trim()) {
    filtered = filtered.filter((w) => wordMatchesSearch(w, searchQuery));
  }

  return filtered;
}

function hasActiveWordFilter() {
  return filterCategoryIds.size > 0 || filterNoCategory || filterTypes.size > 0 || !!searchQuery.trim();
}

function renderWordList() {
  const list = document.getElementById('word-list');
  list.innerHTML = '';

  const filtered = getFilteredWords();

  if (filtered.length === 0) {
    list.innerHTML = words.length === 0
      ? '<li class="empty-text" style="border:none;">Henüz kelime eklenmedi.</li>'
      : '<li class="empty-text" style="border:none;">Filtreyle eşleşen kelime yok.</li>';
    return;
  }

  filtered.forEach((w) => {
    const li = document.createElement('li');

    const main = document.createElement('div');
    main.className = 'item-main';
    main.innerHTML = `<div class="item-title">${displayHtml(w.text)}</div>
      <div class="item-sub">${escapeHtml(wordSubLabel(w))}</div>`;

    const btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';

    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = 'Sil';
    armDeleteButton(delBtn, 'Emin misin?', () => {
      words = words.filter((x) => x.id !== w.id);
      saveWords();
      renderWordList();
      renderStats();
      renderFlashcard();
    });

    btnWrap.appendChild(makeSpeakButton(w.text, speakLangCode()));
    btnWrap.appendChild(delBtn);

    li.appendChild(main);
    li.appendChild(btnWrap);
    list.appendChild(li);
  });
}

function setupWordsTab() {
  document.getElementById('word-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('word-input');
    const text = input.value.trim();
    if (!text) return;

    words.push({ id: makeId(), text, categoryIds: [...newWordCategoryIds], type: newWordType });
    saveWords();
    input.value = '';
    newWordCategoryIds.clear();
    newWordType = null;
    renderNewWordChips();
    renderNewWordTypeChips();
    renderWordList();
    renderStats();
    renderFlashcard();
  });

  setupSearchInputs();

  renderNewWordTypeChips();
  renderNewWordChips();
  renderFilterChips();
  renderTypeFilterChips();
  renderWordList();
}

// Kelimeler, İstatistik ve Flash Kart sekmelerindeki arama kutuları aynı
// searchQuery'i paylaşır; birine yazınca diğerleri de senkronize kalır.
const SEARCH_INPUT_IDS = ['word-search', 'stats-search', 'flashcard-search'];

function setupSearchInputs() {
  SEARCH_INPUT_IDS.forEach((inputId) => {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      SEARCH_INPUT_IDS.forEach((otherId) => {
        if (otherId === inputId) return;
        const other = document.getElementById(otherId);
        if (other && other.value !== searchQuery) other.value = searchQuery;
      });
      renderWordList();
      renderStats();
      renderFlashcard();
    });
  });
}

// ---------- Cümleler sekmesi ----------

function renderSentenceList() {
  const list = document.getElementById('sentence-list');
  document.getElementById('sentence-count').textContent = sentences.length;
  list.innerHTML = '';

  if (sentences.length === 0) {
    list.innerHTML = '<li class="empty-text" style="border:none;">Henüz cümle eklenmedi.</li>';
    return;
  }

  sentences.forEach((s) => {
    const li = document.createElement('li');
    li.style.alignItems = 'flex-start';

    const grammarResultId = `sent-grammar-${s.id}`;
    const main = document.createElement('div');
    main.className = 'item-main';
    main.innerHTML = `<div class="item-title">${displayHtml(s.text)}</div>
      <div class="grammar-result" id="${grammarResultId}" hidden></div>`;

    const btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex-shrink:0;';

    const grammarBtn = document.createElement('button');
    grammarBtn.className = 'kanji-btn';
    grammarBtn.style.padding = '4px 8px';
    grammarBtn.style.fontSize = '12px';
    grammarBtn.textContent = 'Gramer';
    grammarBtn.addEventListener('click', async () => {
      const resultEl = document.getElementById(grammarResultId);
      const original = grammarBtn.textContent;
      grammarBtn.disabled = true;
      grammarBtn.textContent = '...';
      const outcome = await runGrammarCheck(s.text);
      grammarBtn.disabled = false;
      grammarBtn.textContent = original;
      if (resultEl) renderGrammarResult(resultEl, outcome);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = 'Sil';
    armDeleteButton(delBtn, 'Emin misin?', () => {
      sentences = sentences.filter((x) => x.id !== s.id);
      saveSentences();
      renderSentenceList();
      renderStats();
      renderFlashcard();
    });

    if (currentLang === 'ja') btnWrap.appendChild(grammarBtn);
    btnWrap.appendChild(makeSpeakButton(s.text, speakLangCode()));
    btnWrap.appendChild(delBtn);

    li.appendChild(main);
    li.appendChild(btnWrap);
    list.appendChild(li);
  });
}

// Hem manuel "Cümleyi Kaydet" formu hem de Cümle Üret sekmesindeki
// "Kütüphaneye Ekle" butonu bu fonksiyonu kullanır.
function addSentenceText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  sentences.push({ id: makeId(), text: trimmed });
  saveSentences();
  renderSentenceList();
  renderStats();
  renderFlashcard();
  return true;
}

function setupSentencesTab() {
  document.getElementById('sentence-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('sentence-input');
    if (addSentenceText(input.value)) input.value = '';
  });

  renderSentenceList();
}

// ---------- Cümle Üret sekmesi ----------
// Üretim mantığının tamamı generator.js'te (tamamen offline, kural/şablon
// tabanlı). Burada sadece seçim arayüzü (chip'ler) ve sonucu Cümleler
// kütüphanesine ekleme akışı var.

// Cümle Üret sekmesi her iki dil için de aynı arayüzü kullanır; hangi
// motorun (Japonca generator.js / Korece ko-generator.js) ve hangi seviye
// setinin aktif olduğu currentLang'e göre belirlenir.
const GEN_LANG_CONFIG = {
  ja: {
    levelOrder: GEN_LEVEL_ORDER,
    levelLabels: { N5: 'N5 (Temel)', N4: 'N4 (Temel-Orta)', N3: 'N3 (Orta)' },
    generate: (opts) => generateSentence(opts),
  },
  ko: {
    levelOrder: GEN_KO_LEVEL_ORDER,
    levelLabels: { 초급: '초급 (Temel)', 중급: '중급 (Orta)', 고급: '고급 (İleri)' },
    generate: (opts) => generateKoreanSentence(opts),
  },
};

const genState = {
  ja: { grammarLevel: 'N5', length: 'short', vocabLevel: 'N5', useOwnWords: false },
  ko: { grammarLevel: '초급', length: 'short', vocabLevel: '초급', useOwnWords: false },
};

const GEN_LENGTH_LABELS = { short: 'Kısa', medium: 'Orta', long: 'Uzun' };

function renderGenChipGroup(containerId, options, labels, current, onSelect) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  options.forEach((key) => {
    const chip = document.createElement('span');
    chip.className = 'chip' + (current === key ? ' selected' : '');
    chip.textContent = labels[key];
    chip.addEventListener('click', () => onSelect(key));
    container.appendChild(chip);
  });
}

function renderGenChips() {
  const cfg = GEN_LANG_CONFIG[currentLang];
  const state = genState[currentLang];

  renderGenChipGroup('gen-grammar-chips', cfg.levelOrder, cfg.levelLabels, state.grammarLevel, (key) => {
    state.grammarLevel = key;
    renderGenChips();
  });
  renderGenChipGroup('gen-length-chips', GEN_LENGTH_ORDER, GEN_LENGTH_LABELS, state.length, (key) => {
    state.length = key;
    renderGenChips();
  });
  renderGenChipGroup('gen-vocab-chips', cfg.levelOrder, cfg.levelLabels, state.vocabLevel, (key) => {
    state.vocabLevel = key;
    renderGenChips();
  });
  const ownToggle = document.getElementById('gen-use-own-words');
  if (ownToggle) ownToggle.checked = state.useOwnWords;

  const resultBox = document.getElementById('gen-result');
  if (resultBox) resultBox.hidden = true;
  const emptyEl = document.getElementById('gen-empty');
  if (emptyEl) emptyEl.textContent = '';
}

function runGenerate() {
  const cfg = GEN_LANG_CONFIG[currentLang];
  const state = genState[currentLang];
  const resultBox = document.getElementById('gen-result');
  const resultText = document.getElementById('gen-result-text');
  const grammarBox = document.getElementById('gen-grammar-result');
  const emptyEl = document.getElementById('gen-empty');

  grammarBox.hidden = true;
  grammarBox.textContent = '';

  const outcome = cfg.generate({
    grammarLevel: state.grammarLevel,
    length: state.length,
    vocabLevel: state.vocabLevel,
    useOwnWords: state.useOwnWords,
    ownWords: words,
  });

  if (outcome.error) {
    resultBox.hidden = true;
    emptyEl.hidden = false;
    emptyEl.textContent = outcome.error;
    return;
  }

  emptyEl.hidden = true;
  resultBox.hidden = false;
  resultBox.dataset.text = outcome.text;
  resultBox.dataset.lang = currentLang;
  resultText.innerHTML = displayHtml(outcome.text);

  if (currentLang === 'ja' && !jaTokenizer) ensureJaTokenizer(() => { resultText.innerHTML = displayHtml(resultBox.dataset.text); });

  if (currentLang === 'ja' && typeof window.jaGrammarChecker !== 'undefined') {
    runGrammarCheck(outcome.text).then((res) => renderGrammarResult(grammarBox, res));
  }
}

function setupGeneratorTab() {
  document.getElementById('gen-use-own-words').addEventListener('change', (e) => {
    genState[currentLang].useOwnWords = e.target.checked;
  });
  document.getElementById('gen-speak-btn').addEventListener('click', () => {
    const resultBox = document.getElementById('gen-result');
    speak(resultBox.dataset.text, resultBox.dataset.lang === 'ko' ? 'ko-KR' : 'ja-JP');
  });
  document.getElementById('gen-generate-btn').addEventListener('click', runGenerate);
  document.getElementById('gen-regenerate-btn').addEventListener('click', runGenerate);
  document.getElementById('gen-add-btn').addEventListener('click', () => {
    const resultBox = document.getElementById('gen-result');
    if (!addSentenceText(resultBox.dataset.text)) return;
    const btn = document.getElementById('gen-add-btn');
    const original = btn.textContent;
    btn.textContent = '✓ Kütüphaneye eklendi';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 1500);
  });

  renderGenChips();
}

// ---------- Flash Kart sekmesi ----------
// Her kelime için otomatik bir flash kart oluşur: ön yüzde sadece kelime
// (okuma/anlamı hatırlamaya çalış), arka yüzde okunuş, tür, kategoriler ve
// Cümleler sekmesinden o kelimenin geçtiği bir örnek cümle gösterilir.

let flashcardCurrentId = null;
let flashcardFlipped = false;

function findExampleSentenceFor(word) {
  return sentences.find((s) => countWordInText(word.text, s.text) > 0) || null;
}

function renderFlashcard() {
  const emptyEl = document.getElementById('flashcard-empty');
  const cardEl = document.getElementById('flashcard-card');
  const counterEl = document.getElementById('flashcard-counter');
  if (!emptyEl || !cardEl || !counterEl) return;

  if (currentLang === 'ja' && !jaTokenizer) {
    ensureJaTokenizer();
    cardEl.hidden = true;
    counterEl.textContent = '';
    emptyEl.hidden = false;
    emptyEl.textContent = 'Japonca analiz motoru hazırlanıyor...';
    return;
  }

  const deck = getFilteredWords();

  if (deck.length === 0) {
    cardEl.hidden = true;
    counterEl.textContent = '';
    emptyEl.hidden = false;
    emptyEl.textContent = words.length === 0
      ? 'Henüz kelime eklenmedi. Önce Kelimeler sekmesinden kelime ekle.'
      : 'Filtreyle eşleşen kelime yok.';
    return;
  }

  // Gösterilen kartın kimliğini korumaya çalış (filtre/veri değişse bile
  // kullanıcı birden farklı bir kelimeye atlamış gibi hissetmesin).
  let idx = deck.findIndex((w) => w.id === flashcardCurrentId);
  if (idx === -1) idx = 0;
  flashcardCurrentId = deck[idx].id;
  const word = deck[idx];

  emptyEl.hidden = true;
  cardEl.hidden = false;
  counterEl.textContent = `${idx + 1} / ${deck.length}`;

  document.getElementById('flashcard-front-word').textContent = word.text;
  document.getElementById('flashcard-speak-btn').onclick = (e) => {
    e.stopPropagation();
    speak(word.text, speakLangCode());
  };

  document.getElementById('flashcard-back-word').innerHTML = displayHtml(word.text);

  const type = wordType(word);
  document.getElementById('flashcard-back-type').textContent = type ? `Tür: ${type}` : '';
  document.getElementById('flashcard-back-cats').textContent = categoryNames(word.categoryIds);

  const example = findExampleSentenceFor(word);
  document.getElementById('flashcard-back-example').innerHTML = example
    ? displayHtml(example.text)
    : '<span class="empty-text" style="padding:0;">Bu kelime için örnek cümle yok. Cümleler sekmesinden ekleyebilirsin.</span>';

  cardEl.classList.toggle('flipped', flashcardFlipped);
}

function flipFlashcard() {
  flashcardFlipped = !flashcardFlipped;
  renderFlashcard();
}

function flashcardNav(delta) {
  const deck = getFilteredWords();
  if (deck.length === 0) return;
  let idx = deck.findIndex((w) => w.id === flashcardCurrentId);
  if (idx === -1) idx = 0;
  idx = (idx + delta + deck.length) % deck.length;
  flashcardCurrentId = deck[idx].id;
  flashcardFlipped = false;
  renderFlashcard();
}

function flashcardRandom() {
  const deck = getFilteredWords();
  if (deck.length === 0) return;
  const idx = Math.floor(Math.random() * deck.length);
  flashcardCurrentId = deck[idx].id;
  flashcardFlipped = false;
  renderFlashcard();
}

function setupFlashcardsTab() {
  document.getElementById('flashcard-card').addEventListener('click', flipFlashcard);
  document.getElementById('flashcard-flip').addEventListener('click', flipFlashcard);
  document.getElementById('flashcard-prev').addEventListener('click', () => flashcardNav(-1));
  document.getElementById('flashcard-next').addEventListener('click', () => flashcardNav(1));
  document.getElementById('flashcard-random').addEventListener('click', flashcardRandom);

  renderFlashcard();
}

// ---------- İstatistik sekmesi ----------

function renderStats() {
  const list = document.getElementById('stats-list');
  const summary = document.getElementById('stats-summary');
  list.innerHTML = '';

  if (currentLang === 'ja' && !jaTokenizer) {
    ensureJaTokenizer();
    summary.textContent = 'Japonca analiz motoru hazırlanıyor...';
    list.innerHTML = '<li class="empty-text" style="border:none;">Lütfen bekleyin, sözlük yükleniyor (ilk seferde biraz sürebilir)...</li>';
    return;
  }

  const filteredWords = getFilteredWords();
  const stats = filteredWords
    .map((w) => ({ ...w, count: countWordInSentences(w.text) }))
    .sort((a, b) => b.count - a.count);

  const total = stats.reduce((sum, s) => sum + s.count, 0);
  const wordCountLabel = hasActiveWordFilter() ? `${stats.length}/${words.length} kelime` : `${words.length} kelime`;
  summary.textContent = `${wordCountLabel} · ${sentences.length} cümle · ${total} toplam geçiş`;

  if (stats.length === 0) {
    list.innerHTML = words.length === 0
      ? '<li class="empty-text" style="border:none;">Henüz kelime veya cümle yok. Önce kelime ve cümle ekleyin.</li>'
      : '<li class="empty-text" style="border:none;">Filtreyle eşleşen kelime yok.</li>';
    return;
  }

  stats.forEach((s) => {
    const li = document.createElement('li');

    const main = document.createElement('div');
    main.className = 'item-main';
    main.innerHTML = `<div class="item-title">${displayHtml(s.text)}</div>
      <div class="item-sub">${escapeHtml(wordSubLabel(s))}</div>`;

    const badge = document.createElement('span');
    badge.className = 'count-badge';
    badge.textContent = s.count;

    li.appendChild(main);
    li.appendChild(badge);
    list.appendChild(li);
  });
}

// ---------- Örnek veri ----------

const SEED_CATEGORY_ORDER = ['Fiiller', 'İsimler', 'Sıfatlar', 'Aile', 'Hayvanlar', 'Yiyecek-İçecek', 'Sayılar'];

const SEED_WORDS = [
  ['食べる', 'Fiiller'], ['飲む', 'Fiiller'], ['行く', 'Fiiller'], ['来る', 'Fiiller'], ['見る', 'Fiiller'],
  ['聞く', 'Fiiller'], ['話す', 'Fiiller'], ['読む', 'Fiiller'], ['書く', 'Fiiller'], ['買う', 'Fiiller'],
  ['売る', 'Fiiller'], ['作る', 'Fiiller'], ['使う', 'Fiiller'], ['待つ', 'Fiiller'], ['立つ', 'Fiiller'],
  ['座る', 'Fiiller'], ['歩く', 'Fiiller'], ['走る', 'Fiiller'], ['泳ぐ', 'Fiiller'], ['寝る', 'Fiiller'],
  ['起きる', 'Fiiller'], ['働く', 'Fiiller'], ['休む', 'Fiiller'], ['勉強する', 'Fiiller'], ['開ける', 'Fiiller'],

  ['学校', 'İsimler'], ['先生', 'İsimler'], ['学生', 'İsimler'], ['会社', 'İsimler'], ['病院', 'İsimler'],
  ['図書館', 'İsimler'], ['公園', 'İsimler'], ['駅', 'İsimler'], ['電車', 'İsimler'], ['車', 'İsimler'],
  ['家', 'İsimler'], ['部屋', 'İsimler'], ['窓', 'İsimler'], ['机', 'İsimler'], ['椅子', 'İsimler'],
  ['本', 'İsimler'], ['新聞', 'İsimler'], ['手紙', 'İsimler'], ['電話', 'İsimler'], ['時計', 'İsimler'],
  ['花', 'İsimler'], ['木', 'İsimler'], ['山', 'İsimler'], ['川', 'İsimler'], ['海', 'İsimler'],
  ['空', 'İsimler'], ['雨', 'İsimler'], ['天気', 'İsimler'], ['今日', 'İsimler'], ['明日', 'İsimler'],

  ['大きい', 'Sıfatlar'], ['小さい', 'Sıfatlar'], ['新しい', 'Sıfatlar'], ['古い', 'Sıfatlar'], ['高い', 'Sıfatlar'],
  ['安い', 'Sıfatlar'], ['暑い', 'Sıfatlar'], ['寒い', 'Sıfatlar'], ['忙しい', 'Sıfatlar'], ['楽しい', 'Sıfatlar'],
  ['難しい', 'Sıfatlar'], ['好き', 'Sıfatlar'],

  ['家族', 'Aile'], ['父', 'Aile'], ['母', 'Aile'], ['兄', 'Aile'], ['姉', 'Aile'], ['子供', 'Aile'],

  ['犬', 'Hayvanlar'], ['猫', 'Hayvanlar'], ['鳥', 'Hayvanlar'], ['牛', 'Hayvanlar'],

  ['ご飯', 'Yiyecek-İçecek'], ['パン', 'Yiyecek-İçecek'], ['水', 'Yiyecek-İçecek'], ['お茶', 'Yiyecek-İçecek'],
  ['コーヒー', 'Yiyecek-İçecek'], ['肉', 'Yiyecek-İçecek'], ['魚', 'Yiyecek-İçecek'], ['野菜', 'Yiyecek-İçecek'],
  ['果物', 'Yiyecek-İçecek'], ['卵', 'Yiyecek-İçecek'], ['牛乳', 'Yiyecek-İçecek'], ['砂糖', 'Yiyecek-İçecek'],
  ['塩', 'Yiyecek-İçecek'], ['りんご', 'Yiyecek-İçecek'], ['バナナ', 'Yiyecek-İçecek'],

  ['一', 'Sayılar'], ['二', 'Sayılar'], ['三', 'Sayılar'], ['四', 'Sayılar'], ['五', 'Sayılar'],
  ['六', 'Sayılar'], ['七', 'Sayılar'], ['八', 'Sayılar'],
];

const SEED_SENTENCES = [
  '私は毎朝パンを食べます。',
  '兄は会社で働いています。',
  '母はいつも忙しいです。',
  '今日はとても寒いです。',
  '明日、姉と公園へ行きます。',
  '私は毎日、本を読みます。',
  '姉は新しい車を買いました。',
  '猫は魚が好きです。',
  '子供は公園で走っています。',
  '父はコーヒーを飲みます。',
  '学生は図書館で勉強します。',
  '今日の天気はとても暑いです。',
  '犬は公園を歩いています。',
  '先生は教室で話しました。',
  '私たちは駅で電車を待ちました。',
  'りんごとバナナを買いました。',
  '子供は宿題が難しいと言いました。',
  '部屋の窓を開けました。',
  '一週間に三回泳ぎます。',
  '今日は八時に起きて、牛乳を飲みました。',

  // İki örnek paragraf: kelimeler N5 seviyesinde, ama gramer kalıpları
  // N4 seviyesinde (〜なければなりません, 〜たり〜たりする, 〜ば, 〜ので,
  // 〜たことがある, 〜てみたい, 〜かもしれない, olabilirlik/potansiyel form).
  '私は毎朝七時に起きて、顔を洗ってから朝ご飯を食べます。朝ご飯を食べながら、テレビのニュースを見ます。学校へ行く前に、部屋を掃除しなければなりません。学校では友達と話したり、本を読んだりします。日本語は少し難しいですが、毎日勉強すれば上手になると思います。',
  '週末、私は公園へ散歩に行きました。天気が良かったので、写真をたくさん撮りました。公園で猫を見ました。その猫はとてもかわいかったです。私は前に犬を飼ったことがありますが、猫を飼ったことがありません。今度、猫を飼ってみたいと思いますが、部屋がせまいので、大きい犬は飼えないかもしれません。',
];

function loadSeedData() {
  const catIdByName = {};
  SEED_CATEGORY_ORDER.forEach((name) => {
    catIdByName[name] = addCategoryByName(name).id;
  });

  let addedWords = 0;
  SEED_WORDS.forEach(([text, catName]) => {
    if (words.some((w) => w.text === text)) return;
    words.push({ id: makeId(), text, categoryIds: catName ? [catIdByName[catName]] : [] });
    addedWords++;
  });
  saveWords();

  let addedSentences = 0;
  SEED_SENTENCES.forEach((text) => {
    if (sentences.some((s) => s.text === text)) return;
    sentences.push({ id: makeId(), text });
    addedSentences++;
  });
  saveSentences();

  renderNewWordChips();
  renderFilterChips();
  refreshCurrentView();

  const btn = document.getElementById('seed-data-btn');
  const original = btn.textContent;
  btn.textContent = addedWords || addedSentences
    ? `✓ Eklendi: ${addedWords} kelime, ${addedSentences} cümle`
    : 'Zaten yüklü, eklenecek yeni bir şey yok';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 3000);
}

function setupSeedButton() {
  document.getElementById('seed-data-btn').addEventListener('click', loadSeedData);
}

// ---------- Dil değiştirici ----------
// Kelimeler/Cümleler/Cümle Üret/İstatistik/Flash Kart sekmeleri aynı arayüzü
// paylaşır; dil değişince sadece hangi veri setinin (ve hangi dile özgü
// özelliklerin — furigana, kanji dönüştürme, gramer kontrolü, kuromoji arama)
// aktif olduğu değişir. Japonca'ya özgü butonlar/metinler Korece'de gizlenir.

const LANG_UI_TEXT = {
  ja: {
    searchPlaceholder: 'Kanji, kana veya okunuş yaz...',
    wordPlaceholder: 'Yeni kelime',
    sentencePlaceholder: 'Yeni cümle yaz...',
    seedBtn: 'Örnek 100 kelime + 20 cümle + 2 paragraf yükle',
  },
  ko: {
    searchPlaceholder: 'Hangıl yaz...',
    wordPlaceholder: 'Yeni kelime (Hangıl)',
    sentencePlaceholder: 'Yeni cümle yaz...',
    seedBtn: 'Örnek 100 kelime + 20 cümle yükle',
  },
};

function applyLangSpecificUi() {
  const t = LANG_UI_TEXT[currentLang];
  const isJa = currentLang === 'ja';

  ['word-search', 'stats-search', 'flashcard-search'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.placeholder = t.searchPlaceholder;
  });
  const wordInput = document.getElementById('word-input');
  if (wordInput) wordInput.placeholder = t.wordPlaceholder;
  const sentInput = document.getElementById('sentence-input');
  if (sentInput) sentInput.placeholder = t.sentencePlaceholder;
  const seedBtn = document.getElementById('seed-data-btn');
  if (seedBtn) {
    seedBtn.textContent = t.seedBtn;
    // Örnek veri seti şu an sadece Japonca için hazır.
    seedBtn.hidden = !isJa;
  }

  // Japonca'ya özgü: kanji dönüştürme (Google girdi aracı) ve offline gramer
  // kontrolü (ja-grammar-check.js) — Korece için eşdeğerleri yok.
  ['word-kanji-btn', 'sentence-kanji-btn', 'sentence-grammar-btn'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !isJa;
  });

  document.querySelectorAll('.lang-btn').forEach((b) => b.classList.toggle('active', b.dataset.lang === currentLang));

  renderGenChips();
}

function switchLanguage(lang) {
  if (lang === currentLang) return;
  currentLang = lang;

  loadAll();
  ensureDefaultCategories();

  filterCategoryIds = new Set();
  filterNoCategory = false;
  filterTypes = new Set();
  newWordCategoryIds = new Set();
  newWordType = null;
  searchQuery = '';
  ['word-search', 'stats-search', 'flashcard-search'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  flashcardCurrentId = null;
  flashcardFlipped = false;

  applyImeBinding();
  applyLangSpecificUi();
  renderNewWordChips();
  renderNewWordTypeChips();
  renderFilterChips();
  renderTypeFilterChips();
  refreshCurrentView();

  if (lang === 'ja') ensureJaTokenizer();
}

function setupLangSwitch() {
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchLanguage(btn.dataset.lang));
  });
}

// ---------- Yardımcı ----------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Başlat ----------

migrateFromLangScopedStorage();
loadAll();
ensureDefaultCategories();
setupTabs();
setupLangSwitch();
applyImeBinding();
applyLangSpecificUi();
setupWordsTab();
setupSentencesTab();
setupGeneratorTab();
setupFlashcardsTab();
setupKanjiButton('word-kanji-btn', 'word-input', 'word-kanji-candidates');
setupKanjiButton('sentence-kanji-btn', 'sentence-input', 'sentence-kanji-candidates');
setupGrammarButton('sentence-grammar-btn', 'sentence-input', 'sentence-grammar-result');
setupSeedButton();
ensureJaTokenizer();
