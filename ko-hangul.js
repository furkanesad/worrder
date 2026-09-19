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
