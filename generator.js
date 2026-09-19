// Otomatik Cümle Oluşturucu - tamamen offline, kural/şablon tabanlı Japonca
// cümle üreteci. Harici bir servise veya yapay zekaya ihtiyaç duymaz:
// JLPT seviyelerine göre gruplanmış kelime bankaları (generator-vocab.js —
// elzup/jlpt-word-list'ten tek seferlik içe aktarıldı) + standart Japonca
// çekim kurallarını (godan/ichidan/suru/kuru, i-sıfat/na-sıfat) birleştirip
// gramer kalıplarına yerleştirir. Okunuş (furigana) ve gramer kontrolü için
// app.js'teki kuromoji tabanlı altyapı (jaAnalyze, runGrammarCheck) aynen
// kullanılır — burada tekrar edilmez.
//
// Cümle bağlamı (ör. "犬を書く", "先生を飲む" gibi anlamsız fiil-nesne
// eşleşmeleri) şöyle önleniyor: nesne alan fiiller (GEN_CURATED_VERBS içinde
// objectCats alanı olanlar) sadece o kategoriyle eşleşen isimlerle
// birleştiriliyor (örn. 飲む sadece "drink" kategorisindeki isimleri alır).
// Bu yüzden nesne gerektiren kalıplarda SADECE elle doğrulanmış, kategorisi
// bilinen bu küçük fiil listesi kullanılıyor; internetten içe aktarılan
// büyük fiil listesi (binlerce fiil) sadece nesnesiz kalıplarda kullanılıyor
// çünkü hangi nesneleri alabileceklerini güvenle bilmiyoruz.

const GEN_LEVEL_ORDER = ['N5', 'N4', 'N3'];

const GEN_LENGTH_ORDER = ['short', 'medium', 'long'];

// Sabit zamirler: cümlenin öznesi olarak kullanılır.
const GEN_PRONOUNS = ['私', 'あなた', '彼', '彼女', '私たち'];

const GEN_TIME = {
  N5: ['今日', '明日', '毎日', '今'],
  N4: ['来週', '先週', '来月'],
  N3: ['以前', '将来'],
};

// ---------- Elle doğrulanmış fiil havuzu (nesne kategorileriyle) ----------
// objectCats olan fiiller "を" ile nesne alan kalıplarda kullanılır ve nesne
// SADECE bu kategorilerden seçilir (bkz. generator-vocab.js'teki isim "cat"
// etiketleri: person/animal/food/drink/reading/vehicle/clothing/place/thing).
// objectCats olmayanlar (行く/来る/ある gibi geçişsiz fiiller) sadece
// nesnesiz kalıplarda kullanılır.
const GEN_CURATED_VERBS = {
  N5: [
    { jp: '食べる', type: 'ichidan', objectCats: ['food', 'animal'] },
    { jp: '飲む', type: 'godan', objectCats: ['drink'] },
    { jp: '読む', type: 'godan', objectCats: ['reading'] },
    { jp: '書く', type: 'godan', objectCats: ['reading'] },
    { jp: '見る', type: 'ichidan', objectCats: ['thing', 'place', 'person', 'animal'] },
    { jp: '買う', type: 'godan', objectCats: ['thing', 'food', 'clothing', 'vehicle'] },
    { jp: 'する', type: 'suru', objectCats: ['thing'] },
    { jp: '聞く', type: 'godan', objectCats: ['reading', 'thing'] },
    { jp: '待つ', type: 'godan', objectCats: ['person', 'vehicle'] },
    { jp: '呼ぶ', type: 'godan', objectCats: ['person'] },
    { jp: '切る', type: 'godan', objectCats: ['food'] },
    { jp: '行く', type: 'iku' },
    { jp: '来る', type: 'kuru' },
    { jp: 'ある', type: 'aru' },
  ],
  N4: [
    { jp: '持つ', type: 'godan', objectCats: ['thing', 'reading', 'clothing'] },
    { jp: '使う', type: 'godan', objectCats: ['thing', 'vehicle', 'clothing'] },
    { jp: '作る', type: 'godan', objectCats: ['food', 'thing', 'reading'] },
    { jp: '開ける', type: 'ichidan', objectCats: ['thing'] },
    { jp: '教える', type: 'ichidan', objectCats: ['reading', 'thing'] },
    { jp: '習う', type: 'godan', objectCats: ['reading', 'thing'] },
    { jp: '手伝う', type: 'godan', objectCats: ['person'] },
    { jp: '送る', type: 'godan', objectCats: ['reading', 'person'] },
    { jp: '忘れる', type: 'ichidan', objectCats: ['thing', 'reading'] },
    { jp: '洗う', type: 'godan', objectCats: ['clothing', 'thing'] },
    { jp: '探す', type: 'godan', objectCats: ['person', 'thing', 'animal'] },
    { jp: '働く', type: 'godan' },
    { jp: '始まる', type: 'godan' },
    { jp: '終わる', type: 'godan' },
    { jp: '頑張る', type: 'godan' },
  ],
  N3: [
    { jp: '増える', type: 'ichidan' },
    { jp: '減る', type: 'godan' },
    { jp: '変わる', type: 'godan' },
    { jp: '悩む', type: 'godan' },
  ],
};

// ---------- Çekim motoru ----------
// Godan fiillerde son karaktere göre ünsüz/ünlü değişimi (音便 dahil).
const GEN_GODAN_ROW = {
  'う': { i: 'い', e: 'え', te: 'って', ta: 'った' },
  'く': { i: 'き', e: 'け', te: 'いて', ta: 'いた' },
  'ぐ': { i: 'ぎ', e: 'げ', te: 'いで', ta: 'いだ' },
  'す': { i: 'し', e: 'せ', te: 'して', ta: 'した' },
  'つ': { i: 'ち', e: 'て', te: 'って', ta: 'った' },
  'ぬ': { i: 'に', e: 'ね', te: 'んで', ta: 'んだ' },
  'ぶ': { i: 'び', e: 'べ', te: 'んで', ta: 'んだ' },
  'む': { i: 'み', e: 'め', te: 'んで', ta: 'んだ' },
  'る': { i: 'り', e: 'れ', te: 'って', ta: 'った' },
};

// form: 'plain' (sözlük hali) | 'masu' | 'te' | 'ta' | 'ba'
function genConjugateVerb(entry, form) {
  const jp = entry.jp;
  if (form === 'plain') return jp;

  if (entry.type === 'suru') {
    const stem = jp.slice(0, -2);
    if (form === 'masu') return stem + 'します';
    if (form === 'te') return stem + 'して';
    if (form === 'ta') return stem + 'した';
    if (form === 'ba') return stem + 'すれば';
  }
  if (entry.type === 'kuru') {
    // 来る: kanji「来」bağlama göre こ/き/く/くれ okunur, okurigana ekin
    // geri kalanıdır — stem'e ayrıca bir kana eklenmez ("来きます" yanlış).
    const stem = jp.slice(0, -1);
    if (form === 'masu') return stem + 'ます';
    if (form === 'te') return stem + 'て';
    if (form === 'ta') return stem + 'た';
    if (form === 'ba') return stem + 'れば';
  }
  if (entry.type === 'aru') {
    const stem = jp.slice(0, -1);
    if (form === 'masu') return stem + 'ります';
    if (form === 'te') return stem + 'って';
    if (form === 'ta') return stem + 'った';
    if (form === 'ba') return stem + 'れば';
  }
  if (entry.type === 'ichidan') {
    const stem = jp.slice(0, -1);
    if (form === 'masu') return stem + 'ます';
    if (form === 'te') return stem + 'て';
    if (form === 'ta') return stem + 'た';
    if (form === 'ba') return stem + 'れば';
  }

  // godan / iku (行く: ます・ば ekleri düzenli く-satırı, sadece te/ta düzensiz)
  const last = jp.slice(-1);
  const stem = jp.slice(0, -1);
  const row = GEN_GODAN_ROW[last];
  if (form === 'masu') return stem + row.i + 'ます';
  if (form === 'ba') return stem + row.e + 'ば';
  if (form === 'te') return stem + (entry.type === 'iku' ? 'って' : row.te);
  if (form === 'ta') return stem + (entry.type === 'iku' ? 'った' : row.ta);
  return jp;
}

// i-sıfat/na-sıfat çekimi bağlama göre değişir:
// - "〜と思います" gibi düz-cümle bitişlerinde na-sıfat "だ" alır (静かだ).
// - "〜ので/〜のに" gibi bağlaçlardan önce na-sıfat "な" alır (静かなので),
//   "静かだので" yanlıştır. i-sıfat her iki durumda da sözlük haliyle
//   değişmeden kullanılır (難しいので / 難しいと思います).
function genPlainPredicateDa(entry) {
  if (entry.kind === 'naadj') return entry.jp + 'だ';
  return entry.jp;
}

function genPlainPredicateNa(entry) {
  if (entry.kind === 'naadj') return entry.jp + 'な';
  return entry.jp;
}

function genPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function genHasCat(noun, cats) {
  return noun.cat.some((c) => cats.includes(c));
}

// Bir fiilin objectCats'iyle eşleşen isimlerden rastgele nesne seçer. Hiç
// eşleşme yoksa (çok dar bir kelime seviyesi seçilmiş olabilir) genel isim
// havuzuna düşer — bu durumda anlam garantisi zayıflar ama cümle en azından
// üretilebilir.
function genPickObjectFor(verb, nounPool) {
  const candidates = nounPool.filter((n) => genHasCat(n, verb.objectCats));
  return genPick(candidates.length ? candidates : nounPool);
}

// ---------- Gramer şablonları ----------
// Her (gramer seviyesi × uzunluk) hücresi için bir kalıp. Çeşitlilik kelime
// seçiminden gelir; daha fazla kalıp eklemek için buraya yeni fonksiyonlar
// eklemek yeterli.
function genBuildTemplates(pools) {
  function objVerbPair(form) {
    const verb = genPick(pools.verbObj);
    const obj = genPickObjectFor(verb, pools.noun);
    return { obj: obj.jp, verb: genConjugateVerb(verb, form) };
  }

  return {
    N5: {
      short: () => `${genPick(pools.subject)}は${genPick(pools.personNoun).jp}です。`,
      medium: () => {
        const p = objVerbPair('masu');
        return `${genPick(pools.time)}、${genPick(pools.subject)}は${p.obj}を${p.verb}。`;
      },
      long: () => {
        const subject = genPick(pools.subject);
        const p1 = objVerbPair('te');
        const p2 = objVerbPair('masu');
        return `${subject}は${p1.obj}を${p1.verb}、${p2.obj}を${p2.verb}。`;
      },
    },
    N4: {
      short: () => {
        const p = objVerbPair('te');
        return `${genPick(pools.subject)}は${p.obj}を${p.verb}もいいです。`;
      },
      medium: () => `${genPick(pools.noun).jp}が${genPlainPredicateNa(genPick(pools.adj))}ので、${genPick(pools.subject)}は${genConjugateVerb(genPick(pools.verbAny), 'masu')}。`,
      long: () => {
        const time = genPick(pools.time);
        const p1 = objVerbPair('ta');
        const p2 = objVerbPair('ta');
        return `${time}は${p1.obj}を${p1.verb}り、${p2.obj}を${p2.verb}りします。`;
      },
    },
    N3: {
      short: () => `${genPick(pools.time)}、${genPick(pools.noun).jp}は${genConjugateVerb(genPick(pools.verbAny), 'plain')}かもしれません。`,
      medium: () => `${genPick(pools.noun).jp}が${genConjugateVerb(genPick(pools.verbAny), 'ba')}、${genPick(pools.noun).jp}は${genPlainPredicateDa(genPick(pools.adj))}と思います。`,
      long: () => `${genPick(pools.subject)}は${genConjugateVerb(genPick(pools.verbAny), 'ta')}ことがあります。`,
    },
  };
}

// ---------- Kullanıcının kendi kelime defterinden derleme ----------
// app.js'teki kuromoji tabanlı jaAnalyze() fonksiyonunu kullanır (aynı
// sayfada global olarak tanımlı). Sözlük motoru henüz hazır değilse veya
// bir kelime güvenle sınıflandırılamıyorsa o kelime sessizce atlanır.
//
// Kullanıcının kelimelerinin hangi nesne kategorilerini alabileceğini
// bilmiyoruz (İngilizce anlam etiketi yok), bu yüzden isimlere sadece genel
// "thing" kategorisi veriliyor ve fiiller nesne gerektiren kalıplara asla
// dahil edilmiyor — sadece nesnesiz kalıplarda (verbAny) kullanılıyor. Bu,
// bilinmeyen kelimeler için de yanlış fiil-nesne eşleşmesi riskini ortadan
// kaldırır.
function genCollectOwnWords(ownWords) {
  const result = { noun: [], verb: [], iadj: [], naadj: [] };
  if (typeof jaAnalyze !== 'function' || !ownWords) return result;

  ownWords.forEach((w) => {
    const tokens = jaAnalyze(w.text);
    if (!tokens || tokens.length === 0) return;

    const verbTok = tokens.find((t) => t.pos === '動詞');
    if (verbTok) {
      const ct = verbTok.conjugated_type || '';
      if (verbTok.base === '来る') result.verb.push({ jp: '来る', type: 'kuru' });
      else if (verbTok.base === '行く') result.verb.push({ jp: '行く', type: 'iku' });
      else if (verbTok.base === 'ある') result.verb.push({ jp: 'ある', type: 'aru' });
      else if (ct.startsWith('サ変') && w.text.endsWith('する')) result.verb.push({ jp: w.text, type: 'suru' });
      else if (ct.startsWith('一段')) result.verb.push({ jp: verbTok.base, type: 'ichidan' });
      else if (ct.startsWith('五段')) result.verb.push({ jp: verbTok.base, type: 'godan' });
      return;
    }

    const main = tokens[0];
    if (main.pos === '形容詞') {
      const type = main.conjugated_type === '形容詞・イイ' ? 'ii' : 'reg';
      result.iadj.push({ kind: 'iadj', type, jp: main.base });
      return;
    }
    if (main.pos === '名詞' && main.posDetail === '形容動詞語幹') {
      result.naadj.push({ kind: 'naadj', jp: w.text });
      return;
    }
    if (main.pos === '名詞') {
      result.noun.push({ jp: w.text, cat: ['thing'] });
    }
  });

  return result;
}

// ---------- Ana giriş noktası ----------
// opts: { grammarLevel: 'N5'|'N4'|'N3', length: 'short'|'medium'|'long',
//         vocabLevel: 'N5'|'N4'|'N3', useOwnWords: boolean, ownWords: [] }
function generateSentence(opts) {
  const levelIdx = GEN_LEVEL_ORDER.indexOf(opts.vocabLevel);
  const levels = GEN_LEVEL_ORDER.slice(0, levelIdx + 1);

  const pool = { noun: [], iadj: [], naadj: [], verbCurated: [], verbImported: [], time: [] };

  // Kelime seviyesi kümülatiftir: N3 seçilince N5+N4+N3 kelimeleri de dahil
  // olur (gerçek JLPT hazırlığında da alt seviye kelimeler hâlâ geçerlidir).
  levels.forEach((lv) => {
    pool.noun = pool.noun.concat(GEN_IMPORTED_VOCAB[lv].nouns);
    pool.iadj = pool.iadj.concat(GEN_IMPORTED_VOCAB[lv].iadj.map((a) => ({ kind: 'iadj', jp: a.jp, type: a.type })));
    pool.naadj = pool.naadj.concat(GEN_IMPORTED_VOCAB[lv].naadj.map((a) => ({ kind: 'naadj', jp: a.jp })));
    pool.verbCurated = pool.verbCurated.concat(GEN_CURATED_VERBS[lv]);
    pool.verbImported = pool.verbImported.concat(GEN_IMPORTED_VOCAB[lv].verbs);
    pool.time = pool.time.concat(GEN_TIME[lv]);
  });

  let ownNoun = [];
  let ownVerb = [];
  let ownAdj = [];
  if (opts.useOwnWords) {
    const own = genCollectOwnWords(opts.ownWords);
    ownNoun = own.noun;
    ownVerb = own.verb;
    ownAdj = own.iadj.concat(own.naadj);
  }

  const noun = pool.noun.concat(ownNoun);
  const personNoun = noun.filter((n) => genHasCat(n, ['person']));
  const adj = pool.iadj.concat(pool.naadj, ownAdj);
  const verbObj = pool.verbCurated.filter((v) => v.objectCats && v.objectCats.length);
  const verbAny = pool.verbCurated.concat(pool.verbImported, ownVerb);

  if (noun.length < 2 || adj.length < 1 || verbObj.length < 1 || verbAny.length < 1 || personNoun.length < 1) {
    return { error: 'Bu ayarlarla yeterli kelime bulunamadı. Kelime seviyesini yükselt ya da "kendi kelimelerim" seçeneğini kapat.' };
  }

  const pools = {
    subject: GEN_PRONOUNS,
    noun,
    personNoun,
    adj,
    verbObj,
    verbAny,
    time: pool.time,
  };

  const templates = genBuildTemplates(pools);
  const text = templates[opts.grammarLevel][opts.length]();
  return { text };
}
