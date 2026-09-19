// Hangıl (한글) ayrıştırma/birleştirme yardımcıları + Korece çekim motoru.
// Kuromoji'nin Japonca için yaptığının aynısını (gerçek dilbilgisi
// kurallarıyla çekim) Korece için burada elle kuruyoruz — hazır, tarayıcıda
// çalışan bir Korece morfolojik analizör bulunmadığından bu motor kuralları
// doğrudan Hangıl'ın ses birimi (jamo) yapısını çözerek uyguluyor.
//
// Bir Hangıl hecesi = 초성(başlangıç ünsüzü) + 중성(ünlü) + 종성(bitiş
// ünsüzü, opsiyonel) — Unicode'da tek bir kod noktası olarak şu formülle
// kodlanır: code = 0xAC00 + (cho*21 + jung)*28 + jong.

const HANGUL_BASE = 0xAC00;
const HANGUL_LAST = 0xD7A3;

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

function hangulDecompose(char) {
  const code = char.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  const offset = code - HANGUL_BASE;
  const jongIdx = offset % 28;
  const jungIdx = ((offset - jongIdx) / 28) % 21;
  const choIdx = (((offset - jongIdx) / 28) - jungIdx) / 21;
  return { cho: CHO[choIdx], jung: JUNG[jungIdx], jong: JONG[jongIdx] };
}

function hangulCompose(cho, jung, jong) {
  const choIdx = CHO.indexOf(cho);
  const jungIdx = JUNG.indexOf(jung);
  const jongIdx = JONG.indexOf(jong || '');
  if (choIdx < 0 || jungIdx < 0 || jongIdx < 0) return null;
  return String.fromCharCode(HANGUL_BASE + (choIdx * 21 + jungIdx) * 28 + jongIdx);
}

function hasBatchim(char) {
  const d = hangulDecompose(char);
  return !!d && d.jong !== '';
}

// ---------- 조사 (parçacık) seçimi: son harfin ünsüzle bitip bitmediğine göre ----------

function josaEunNeun(word) { return hasBatchim(word[word.length - 1]) ? '은' : '는'; }
function josaIGa(word) { return hasBatchim(word[word.length - 1]) ? '이' : '가'; }
function josaEulReul(word) { return hasBatchim(word[word.length - 1]) ? '을' : '를'; }
function josaIeyoYeyo(word) { return hasBatchim(word[word.length - 1]) ? '이에요' : '예요'; }

// ---------- Çekim motoru ----------
// entry: { jp: '다'ile biten sözlük hali, kind: 'verb'|'iadj', cls: çekim sınıfı }
//   cls: 'reg' (düzenli) | 'harda' (하다) | 'irr-b' (ㅂ düzensiz) |
//        'irr-d' (ㄷ düzensiz) | 'irr-s' (ㅅ düzensiz) | 'irr-r' (르 düzensiz) |
//        'irr-eu' (으 düşmesi, örn. 예쁘다->예뻐요) | 'irr-l' (ㄹ tabanı, 살다 gibi)

// 아/어체 (해요체'nin -요 eklenmemiş hali) — hem "-아/어요" (ifade), hem
// "-아/어서" (sebep), hem "-아/어도 되다" (izin) bu tabana ekleniyor.
function koStemAeo(entry) {
  const dict = entry.jp;
  const stem = dict.slice(0, -1); // "다"yı at

  if (entry.cls === 'harda') {
    // 하다 -> 해 (공부하다 -> 공부해)
    return stem.slice(0, -1) + '해';
  }

  const lastChar = stem[stem.length - 1];
  const d = hangulDecompose(lastChar);

  if (entry.cls === 'irr-r') {
    // 르 düzens이: 모르다->몰라(요), 부르다->불러(요), 다르다->달라(요).
    // "르" atılır, ondan ÖNCEKİ hecenin ünlü uyumuna göre ㄹ o heceye
    // 받침 olarak eklenir ve 라/러 eklenir (모+르 -> 몰 + 라).
    const before = stem.slice(0, -1); // '르'den önceki kısım, örn. '모'
    const beforeLast = before[before.length - 1];
    const beforeD = hangulDecompose(beforeLast);
    const useA = (beforeD.jung === 'ㅏ' || beforeD.jung === 'ㅗ');
    const withL = hangulCompose(beforeD.cho, beforeD.jung, 'ㄹ');
    return before.slice(0, -1) + withL + (useA ? '라' : '러');
  }

  if (d.jong !== '') {
    // Son hece ünsüzle bitiyor (받침 var) — düzensizler hariç doğrudan 아/어 eklenir.
    const useA = (d.jung === 'ㅏ' || d.jung === 'ㅗ');
    if (entry.cls === 'irr-b') {
      // ㅂ düzensiz: 덥다->더워, 어렵다->어려워 (돕다/곱다 istisnası "와" alır, kelime bankasında yok)
      const noBatchim = hangulCompose(d.cho, d.jung, '');
      return stem.slice(0, -1) + noBatchim + '워';
    }
    if (entry.cls === 'irr-d') {
      // ㄷ düzensiz: 듣다->들어 (ㄷ -> ㄹ)
      const withL = hangulCompose(d.cho, d.jung, 'ㄹ');
      return stem.slice(0, -1) + withL + (useA ? '아' : '어');
    }
    if (entry.cls === 'irr-s') {
      // ㅅ düzensiz: 낫다->나아 (ㅅ düşer)
      const noBatchim = hangulCompose(d.cho, d.jung, '');
      return stem.slice(0, -1) + noBatchim + (useA ? '아' : '어');
    }
    return stem + (useA ? '아' : '어');
  }

  // Son hece ünlüyle bitiyor (받침 yok) — ünlü daralması/kaynaşması.
  if (entry.cls === 'irr-eu') {
    // 으 düşmesi: 예쁘다->예뻐, 아프다->아파, 크다->커, 쓰다->써
    const before = stem.slice(0, -1);
    const prevChar = before[before.length - 1];
    const prevJung = prevChar ? hangulDecompose(prevChar).jung : null;
    const useA = prevJung === 'ㅏ' || prevJung === 'ㅗ';
    return before + hangulCompose(d.cho, useA ? 'ㅏ' : 'ㅓ', '');
  }

  switch (d.jung) {
    case 'ㅏ': // 가다 -> 가 (아+아->아, 표기상 변화 없음)
    case 'ㅓ': // 서다 -> 서
    case 'ㅐ': // 보내다 -> 보내
    case 'ㅔ': // 세다 -> 세
      return stem;
    case 'ㅗ': // 오다 -> 와, 보다 -> 봐
      return stem.slice(0, -1) + hangulCompose(d.cho, 'ㅘ', '');
    case 'ㅜ': // 배우다 -> 배워
      return stem.slice(0, -1) + hangulCompose(d.cho, 'ㅝ', '');
    case 'ㅣ': // 마시다 -> 마셔, 기다리다 -> 기다려
      return stem.slice(0, -1) + hangulCompose(d.cho, 'ㅕ', '');
    default:
      return stem + '어';
  }
}

// form: 'plain' | 'polite' (-아/어요) | 'reason' (-아/어서) | 'permission' (-아/어도 돼요)
function koConjugate(entry, form) {
  if (form === 'plain') return entry.jp;
  const aeo = koStemAeo(entry);
  if (form === 'reason') return aeo + '서';
  if (form === 'permission') return aeo + '도 돼요';
  return aeo + '요'; // polite
}

// -고 (bağlaç, "yapıp/yapıp da") — düzensiz sınıflar da dahil HER ZAMAN
// düzenli: ünsüzle başlayan ekler önünde düzensiz ses değişimi olmaz.
function koConnector(entry) {
  return entry.jp.slice(0, -1) + '고';
}

// -지만 ("ama") — -고 gibi ünsüzle başladığından her zaman düzenli.
function koContrast(entry) {
  return entry.jp.slice(0, -1) + '지만';
}

// -(으)ㄹ 수 있어요 (yapabilme) — 받침'a bakar, düzensiz sınıflardan
// etkilenmez (아/어 değil, ünlü uyumu gerektirmeyen bir ek).
function koCanDo(entry) {
  const stem = entry.jp.slice(0, -1);
  const before = stem.slice(0, -1);
  const last = stem[stem.length - 1];
  const d = hangulDecompose(last);
  if (d.jong === 'ㄹ') return stem + ' 수 있어요'; // 살다 -> 살 수 있어요 (zaten ㄹ ile bitiyor)
  if (d.jong === '') return before + hangulCompose(d.cho, d.jung, 'ㄹ') + ' 수 있어요'; // 가다 -> 갈 수 있어요 (ㄹ, 받침 olarak birleşir)
  return stem + '을 수 있어요'; // 먹다 -> 먹을 수 있어요 ("을" ayrı bir hece, birleştirme gerekmez)
}

// -(으)ㄴ/는 형 (adnominal): fiillerde şimdiki zaman her zaman "-는"
// (ㄹ받침 düşer: 살다->사는); sıfatlarda ve fiil geçmiş deneyiminde
// ("~은 적이 있어요") 받침'a göre ㄴ/은 eklenir (ㅂ/ㄷ/ㅅ düzensizleri de
// aynı kök değişimini burada da yapar).
function koAdnominal(entry, tense) {
  const stem = entry.jp.slice(0, -1);
  const last = stem[stem.length - 1];
  const d = hangulDecompose(last);

  if (tense === 'verb-present') {
    if (d.jong === 'ㄹ') return stem.slice(0, -1) + hangulCompose(d.cho, d.jung, '') + '는';
    return stem + '는';
  }

  // 'adj-present' ya da 'verb-past' (deneyim: 적이 있어요)
  // ㄴ, "받침 yok" durumunda AYRI bir hece değil — önceki hecenin받침ı
  // olarak birleşir (예: 크다 -> 큰, "크"+"ㄴ" değil), bu yüzden compose
  // kullanılıyor. "은" ise kendi başına bir hece olduğundan düz ekleniyor.
  const before = stem.slice(0, -1);
  if (d.jong === '') return before + hangulCompose(d.cho, d.jung, 'ㄴ');
  if (entry.cls === 'irr-b') {
    const noBatchim = hangulCompose(d.cho, d.jung, '');
    return before + noBatchim + '운';
  }
  if (entry.cls === 'irr-d') {
    const withL = hangulCompose(d.cho, d.jung, 'ㄹ');
    return before + withL + '은';
  }
  if (entry.cls === 'irr-s') {
    const noBatchim = hangulCompose(d.cho, d.jung, '');
    return before + noBatchim + '은';
  }
  if (d.jong === 'ㄹ') return before + hangulCompose(d.cho, d.jung, 'ㄴ');
  return stem + '은';
}

// -(으)면 (koşul, "eğer/-ırsa") — 받침 durumuna göre ㄹ/ünlü ile biten
// köklerde sadece "면", ünsüzle bitenlerde "으면"; ㅂ/ㄷ/ㅅ düzensizleri
// burada da aynı kök değişimini yapar (르 düzensizi etkilemez: 모르면 vb.
// düzenlidir, çünkü bu ek ünlü-uyumu tetiklemez).
function koIfConditional(entry) {
  const stem = entry.jp.slice(0, -1);
  const before = stem.slice(0, -1);
  const last = stem[stem.length - 1];
  const d = hangulDecompose(last);

  if (d.jong === '' || d.jong === 'ㄹ') return stem + '면';
  if (entry.cls === 'irr-b') {
    const noBatchim = hangulCompose(d.cho, d.jung, '');
    return before + noBatchim + '우면';
  }
  if (entry.cls === 'irr-d') {
    const withL = hangulCompose(d.cho, d.jung, 'ㄹ');
    return before + withL + '으면';
  }
  if (entry.cls === 'irr-s') {
    const noBatchim = hangulCompose(d.cho, d.jung, '');
    return before + noBatchim + '으면';
  }
  return stem + '으면';
}

// ---------- Latin harflerle yazarken anlık Hangıl'a çevirme (2-beolsik/두벌식) ----------
// WanaKana'nın Japonca için yaptığının Korece karşılığı: standart Korece
// klavye düzeninde her Latin tuşu belirli bir jamo'ya karşılık gelir (bu,
// Kore işletim sistemlerindeki gerçek düzenin aynısıdır). Kullanıcı bu
// düzeni bilmese de "annyeong" gibi yazarsam ne çıkar" sezgisiyle değil,
// gerçek 두벌식 tuş eşlemesiyle çalışır — örn. "r"+"k" = ㄱ+ㅏ = "가".

const KO_CONSONANT_KEYS = {
  q: 'ㅂ', w: 'ㅈ', e: 'ㄷ', r: 'ㄱ', t: 'ㅅ',
  a: 'ㅁ', s: 'ㄴ', d: 'ㅇ', f: 'ㄹ', g: 'ㅎ',
  z: 'ㅋ', x: 'ㅌ', c: 'ㅊ', v: 'ㅍ',
  Q: 'ㅃ', W: 'ㅉ', E: 'ㄸ', R: 'ㄲ', T: 'ㅆ',
};

const KO_VOWEL_KEYS = {
  y: 'ㅛ', u: 'ㅕ', i: 'ㅑ', o: 'ㅐ', p: 'ㅔ',
  h: 'ㅗ', j: 'ㅓ', k: 'ㅏ', l: 'ㅣ',
  b: 'ㅠ', n: 'ㅜ', m: 'ㅡ',
  O: 'ㅒ', P: 'ㅖ',
};

const KO_COMPOUND_JUNG = {
  'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ',
  'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ',
  'ㅡㅣ': 'ㅢ',
};

const KO_COMPOUND_JONG = {
  'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ',
  'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ',
};

// Bileşik bir 종성 bir sonraki hece için 초성'a taşınırken (bir ünlü
// geldiğinde) hangi iki basit ünsüze ayrıldığını verir.
const KO_JONG_SPLIT = {
  'ㄳ': ['ㄱ', 'ㅅ'], 'ㄵ': ['ㄴ', 'ㅈ'], 'ㄶ': ['ㄴ', 'ㅎ'], 'ㄺ': ['ㄹ', 'ㄱ'], 'ㄻ': ['ㄹ', 'ㅁ'],
  'ㄼ': ['ㄹ', 'ㅂ'], 'ㄽ': ['ㄹ', 'ㅅ'], 'ㄾ': ['ㄹ', 'ㅌ'], 'ㄿ': ['ㄹ', 'ㅍ'], 'ㅀ': ['ㄹ', 'ㅎ'], 'ㅄ': ['ㅂ', 'ㅅ'],
};

// 종성 olamayan (sadece 초성 olabilen) ünsüzler: 된소리 ㄸ/ㅃ/ㅉ.
const KO_NO_JONG = new Set(['ㄸ', 'ㅃ', 'ㅉ']);

// Tek bir jamo tuşunu mevcut (cho/jung/jong) durumuna uygular; o adımda
// kesinleşen (commit edilen) metni döndürür (yoksa ''), tanınmayan bir tuşsa
// null döner. Hem toplu dönüştürme (koRomanizeToHangul) hem de canlı yazarken
// çalışan koImeBind aynı bu tek adımı kullanır — mantık tek yerde.
function koAssembleStep(state, ch) {
  const cJamo = KO_CONSONANT_KEYS[ch];
  const vJamo = KO_VOWEL_KEYS[ch];
  let flushed = '';

  function doFlush() {
    if (state.cho && state.jung) flushed += hangulCompose(state.cho, state.jung, state.jong || '');
    else if (state.cho) flushed += state.cho;
    else if (state.jung) flushed += state.jung;
    state.cho = null; state.jung = null; state.jong = null;
  }

  if (cJamo) {
    if (!state.cho && !state.jung) {
      state.cho = cJamo;
    } else if (!state.cho && state.jung) {
      // 초성'sız bekleyen çıplak bir ünlü varken ünsüz gelirse (örn. "와"
      // yazılırken ㅇ tuşu unutulmuşsa: ㅗㅏ sonra ㄱ) — bekleyen ünlü
      // olduğu gibi yazılır, yeni ünsüz bir sonraki hecenin 초성'ı olur.
      doFlush();
      state.cho = cJamo;
    } else if (state.cho && !state.jung) {
      doFlush();
      state.cho = cJamo;
    } else if (!state.jong) {
      if (KO_NO_JONG.has(cJamo)) { doFlush(); state.cho = cJamo; }
      else state.jong = cJamo;
    } else {
      const compound = KO_COMPOUND_JONG[state.jong + cJamo];
      if (compound) state.jong = compound;
      else { doFlush(); state.cho = cJamo; }
    }
  } else if (vJamo) {
    // ÖNEMLİ: 2-beolsik'te "sessiz" başlangıç ㅇ'nın kendi tuşu vardır (d)
    // ve OTOMATİK eklenmez — gerçek klavyede de böyledir. Bu yüzden 초성
    // olmadan da bir ünlü bekletilebilir (örn. "ㅗ" sonra "ㅏ" gelirse
    // birleşip "ㅘ" olabilir).
    if (!state.jung) {
      state.jung = vJamo;
    } else if (state.jung && !state.jong) {
      const compound = KO_COMPOUND_JUNG[state.jung + vJamo];
      if (compound) state.jung = compound;
      else { doFlush(); state.jung = vJamo; }
    } else {
      // cho+jung+jong'un hepsi dolu: 종성 bir sonraki heceye 초성 olarak taşınır.
      let carriedCho;
      if (KO_JONG_SPLIT[state.jong]) {
        const [keep, carry] = KO_JONG_SPLIT[state.jong];
        state.jong = keep;
        carriedCho = carry;
      } else {
        carriedCho = state.jong;
        state.jong = null;
      }
      doFlush();
      state.cho = carriedCho;
      state.jung = vJamo;
    }
  } else {
    return null; // jamo tuşu değil (rakam, noktalama, boşluk...)
  }
  return flushed;
}

function koRenderPending(state) {
  if (state.cho && state.jung) return hangulCompose(state.cho, state.jung, state.jong || '');
  if (state.cho) return state.cho;
  if (state.jung) return state.jung;
  return '';
}

// Latin harflerden oluşan bir diziyi (örn. "rkskek") toplu olarak Hangıl'a
// çevirir (test/araç amaçlı — asıl canlı yazma deneyimi koImeBind'dadır).
function koRomanizeToHangul(latin) {
  const state = { cho: null, jung: null, jong: null };
  let result = '';
  for (const ch of latin) {
    const flushed = koAssembleStep(state, ch);
    if (flushed === null) {
      result += koRenderPending(state);
      state.cho = null; state.jung = null; state.jong = null;
      result += ch;
    } else {
      result += flushed;
    }
  }
  result += koRenderPending(state);
  return result;
}

// input/textarea'ya bağlanır: her tuşa basışta (keydown) o tuşu anında
// Hangıl'a çevirir — bekleyen (henüz kesinleşmemiş) hece durumu elemana özel
// olarak saklanır, böylece "g" sonra "k" gibi ayrı tuş vuruşları doğru
// şekilde birleşip tek bir heceye ("가") dönüşür. Jamo olmayan tuşlar
// (boşluk, noktalama, ok tuşları...) bekleyen heceyi kesinleştirip normal
// şekilde işlenmeye bırakılır. Backspace, yarım kalan heceyi tek seferde siler.
const KO_IME_HANDLERS = new WeakMap();

function koImeBind(el) {
  if (!el || KO_IME_HANDLERS.has(el)) return;
  const state = { cho: null, jung: null, jong: null };
  let pendingLen = 0;

  function resetState() {
    state.cho = null; state.jung = null; state.jong = null;
    pendingLen = 0;
  }

  const handler = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) { resetState(); return; }

    if (e.key === 'Backspace' && pendingLen > 0) {
      e.preventDefault();
      const pos = el.selectionStart;
      const newValue = el.value.slice(0, pos - pendingLen) + el.value.slice(pos);
      el.value = newValue;
      el.setSelectionRange(pos - pendingLen, pos - pendingLen);
      resetState();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (e.key.length !== 1 || (!KO_CONSONANT_KEYS[e.key] && !KO_VOWEL_KEYS[e.key])) {
      resetState();
      return; // Enter/Tab/ok tuşları, boşluk, noktalama, rakam vb. — normal davranışa bırak
    }

    e.preventDefault();
    const pos = el.selectionStart;
    const before = el.value.slice(0, pos - pendingLen);
    const after = el.value.slice(pos);
    const flushed = koAssembleStep(state, e.key);
    const pending = koRenderPending(state);
    const newValue = before + flushed + pending + after;
    el.value = newValue;
    pendingLen = pending.length;
    const newPos = before.length + flushed.length + pending.length;
    el.setSelectionRange(newPos, newPos);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  KO_IME_HANDLERS.set(el, handler);
  el.addEventListener('keydown', handler);
}

function koImeUnbind(el) {
  const handler = el && KO_IME_HANDLERS.get(el);
  if (!handler) return;
  el.removeEventListener('keydown', handler);
  KO_IME_HANDLERS.delete(el);
}
