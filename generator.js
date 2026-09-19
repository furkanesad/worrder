// Otomatik Cümle Oluşturucu - tamamen offline, kural/şablon tabanlı Japonca
// cümle üreteci. Harici bir servise veya yapay zekaya ihtiyaç duymaz:
// JLPT seviyelerine göre gruplanmış kelime bankaları + standart Japonca
// çekim kurallarını (godan/ichidan/suru/kuru, i-sıfat/na-sıfat) birleştirip
// gramer kalıplarına yerleştirir. Okunuş (furigana) ve gramer kontrolü için
// app.js'teki kuromoji tabanlı altyapı (jaAnalyze, runGrammarCheck) aynen
// kullanılır — burada tekrar edilmez.

const GEN_LEVEL_ORDER = ['N5', 'N4', 'N3'];

const GEN_LENGTH_ORDER = ['short', 'medium', 'long'];

// Sabit zamirler: cümlenin öznesi olarak kullanılır (kelime bankasındaki
// isimleri özne yapmak anlamsız/garip cümlelere yol açabiliyor, örn.
// "okul öğrencidir" gibi — bu yüzden özne havuzu ayrı tutuluyor).
const GEN_PRONOUNS = ['私', 'あなた', '彼', '彼女', '私たち'];

// ---------- Kelime bankası (JLPT seviyesine göre) ----------
// Her fiil/sıfat girdisi çekim türünü taşır (type), böylece gerçek
// çekim kurallarıyla doğru biçimde çekimlenebilir:
//   fiil: 'ichidan' | 'godan' | 'suru' | 'kuru' | 'aru' | 'iku'
//   i-sıfat: 'reg' | 'ii'
const GEN_VOCAB = {
  N5: {
    noun: ['学生', '先生', '学校', '家', '本', '水', '魚', '友達', '電車', '公園', '猫', '犬']
      .map((jp) => ({ kind: 'noun', jp })),
    verb: [
      { kind: 'verb', type: 'ichidan', jp: '食べる', tr: true },
      { kind: 'verb', type: 'godan', jp: '飲む', tr: true },
      { kind: 'verb', type: 'ichidan', jp: '見る', tr: true },
      { kind: 'verb', type: 'iku', jp: '行く' },
      { kind: 'verb', type: 'kuru', jp: '来る' },
      { kind: 'verb', type: 'suru', jp: 'する', tr: true },
      { kind: 'verb', type: 'godan', jp: '買う', tr: true },
      { kind: 'verb', type: 'godan', jp: '読む', tr: true },
      { kind: 'verb', type: 'godan', jp: '書く', tr: true },
      { kind: 'verb', type: 'aru', jp: 'ある' },
    ],
    iadj: ['高い', '安い', '大きい', '小さい', '新しい', '古い', 'かわいい']
      .map((jp) => ({ kind: 'iadj', type: 'reg', jp })),
    naadj: ['元気', '静か', '好き', '上手']
      .map((jp) => ({ kind: 'naadj', jp })),
    time: ['今日', '明日', '毎日', '今'],
  },
  N4: {
    noun: ['会社', '仕事', '病院', '駅', '図書館', '天気', '約束', '予定', '問題', '経験']
      .map((jp) => ({ kind: 'noun', jp })),
    verb: [
      { kind: 'verb', type: 'godan', jp: '働く' },
      { kind: 'verb', type: 'godan', jp: '始まる' },
      { kind: 'verb', type: 'godan', jp: '終わる' },
      { kind: 'verb', type: 'ichidan', jp: '続ける', tr: true },
      { kind: 'verb', type: 'ichidan', jp: '決める', tr: true },
      { kind: 'verb', type: 'ichidan', jp: '感じる', tr: true },
      { kind: 'verb', type: 'godan', jp: '頑張る' },
      { kind: 'verb', type: 'godan', jp: '知る', tr: true },
    ],
    iadj: ['難しい', '忙しい', '楽しい', '危ない', '恥ずかしい']
      .map((jp) => ({ kind: 'iadj', type: 'reg', jp })),
    naadj: ['大切', '便利', '親切', '残念']
      .map((jp) => ({ kind: 'naadj', jp })),
    time: ['来週', '先週', '来月'],
  },
  N3: {
    noun: ['環境', '社会', '政治', '経済', '文化', '習慣', '関係', '責任']
      .map((jp) => ({ kind: 'noun', jp })),
    verb: [
      { kind: 'verb', type: 'ichidan', jp: '増える' },
      { kind: 'verb', type: 'godan', jp: '減る' },
      { kind: 'verb', type: 'godan', jp: '変わる' },
      { kind: 'verb', type: 'ichidan', jp: '支える', tr: true },
      { kind: 'verb', type: 'godan', jp: '争う', tr: true },
      { kind: 'verb', type: 'godan', jp: '悩む' },
    ],
    iadj: ['厳しい', '激しい', '珍しい', '恐ろしい']
      .map((jp) => ({ kind: 'iadj', type: 'reg', jp })),
    naadj: ['複雑', '重要', '積極的', '消極的']
      .map((jp) => ({ kind: 'naadj', jp })),
    time: ['以前', '将来'],
  },
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

// ---------- Gramer şablonları ----------
// Her (gramer seviyesi × uzunluk) hücresi için bir kalıp. Çeşitlilik kelime
// seçiminden gelir; daha fazla kalıp eklemek için buraya yeni fonksiyonlar
// eklemek yeterli.
function genBuildTemplates(pools) {
  return {
    N5: {
      short: () => `${genPick(pools.subject)}は${genPick(pools.noun).jp}です。`,
      medium: () => `${genPick(pools.time)}、${genPick(pools.subject)}は${genPick(pools.noun).jp}を${genConjugateVerb(genPick(pools.verbObj), 'masu')}。`,
      long: () => {
        const subject = genPick(pools.subject);
        const v1 = genConjugateVerb(genPick(pools.verbObj), 'te');
        const v2 = genConjugateVerb(genPick(pools.verbObj), 'masu');
        return `${subject}は${genPick(pools.noun).jp}を${v1}、${genPick(pools.noun).jp}を${v2}。`;
      },
    },
    N4: {
      short: () => `${genPick(pools.subject)}は${genPick(pools.noun).jp}を${genConjugateVerb(genPick(pools.verbObj), 'te')}もいいです。`,
      medium: () => `${genPick(pools.noun).jp}が${genPlainPredicateNa(genPick(pools.adj))}ので、${genPick(pools.subject)}は${genConjugateVerb(genPick(pools.verb), 'masu')}。`,
      long: () => {
        const time = genPick(pools.time);
        const v1 = genConjugateVerb(genPick(pools.verbObj), 'ta');
        const v2 = genConjugateVerb(genPick(pools.verbObj), 'ta');
        return `${time}は${genPick(pools.noun).jp}を${v1}り、${genPick(pools.noun).jp}を${v2}りします。`;
      },
    },
    N3: {
      short: () => `${genPick(pools.time)}、${genPick(pools.noun).jp}は${genConjugateVerb(genPick(pools.verb), 'plain')}かもしれません。`,
      medium: () => `${genPick(pools.noun).jp}が${genConjugateVerb(genPick(pools.verb), 'ba')}、${genPick(pools.noun).jp}は${genPlainPredicateDa(genPick(pools.adj))}と思います。`,
      long: () => `${genPick(pools.subject)}は${genConjugateVerb(genPick(pools.verb), 'ta')}ことがあります。`,
    },
  };
}

// ---------- Kullanıcının kendi kelime defterinden derleme ----------
// app.js'teki kuromoji tabanlı jaAnalyze() fonksiyonunu kullanır (aynı
// sayfada global olarak tanımlı). Sözlük motoru henüz hazır değilse veya
// bir kelime güvenle sınıflandırılamıyorsa o kelime sessizce atlanır.
function genCollectOwnWords(ownWords) {
  const result = { noun: [], verb: [], iadj: [], naadj: [] };
  if (typeof jaAnalyze !== 'function' || !ownWords) return result;

  ownWords.forEach((w) => {
    const tokens = jaAnalyze(w.text);
    if (!tokens || tokens.length === 0) return;

    const verbTok = tokens.find((t) => t.pos === '動詞');
    if (verbTok) {
      const ct = verbTok.conjugated_type || '';
      // Kuromoji fiilin geçişli/geçişsiz olduğunu ayırt etmiyor; kullanıcının
      // kendi kelimeleri çoğunlukla nesne alan fiiller olacağından (行く/来る/
      // ある gibi birkaç yaygın istisna dışında) varsayılan olarak geçişli
      // kabul ediyoruz — kesin olmayan ama makul bir yaklaşıklık.
      if (verbTok.base === '来る') result.verb.push({ kind: 'verb', type: 'kuru', jp: '来る' });
      else if (verbTok.base === '行く') result.verb.push({ kind: 'verb', type: 'iku', jp: '行く' });
      else if (verbTok.base === 'ある') result.verb.push({ kind: 'verb', type: 'aru', jp: 'ある' });
      else if (ct.startsWith('サ変') && w.text.endsWith('する')) result.verb.push({ kind: 'verb', type: 'suru', jp: w.text, tr: true });
      else if (ct.startsWith('一段')) result.verb.push({ kind: 'verb', type: 'ichidan', jp: verbTok.base, tr: true });
      else if (ct.startsWith('五段')) result.verb.push({ kind: 'verb', type: 'godan', jp: verbTok.base, tr: true });
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
      result.noun.push({ kind: 'noun', jp: w.text });
    }
  });

  return result;
}

// ---------- Ana giriş noktası ----------
// opts: { grammarLevel: 'N5'|'N4'|'N3', length: 'short'|'medium'|'long',
//         vocabLevel: 'N5'|'N4'|'N3', useOwnWords: boolean, ownWords: [] }
function generateSentence(opts) {
  const levelIdx = GEN_LEVEL_ORDER.indexOf(opts.vocabLevel);
  const pool = { noun: [], verb: [], adj: [], time: [] };

  // Kelime seviyesi kümülatiftir: N3 seçilince N5+N4+N3 kelimeleri de dahil
  // olur (gerçek JLPT hazırlığında da alt seviye kelimeler hâlâ geçerlidir).
  GEN_LEVEL_ORDER.slice(0, levelIdx + 1).forEach((lv) => {
    pool.noun = pool.noun.concat(GEN_VOCAB[lv].noun);
    pool.verb = pool.verb.concat(GEN_VOCAB[lv].verb);
    pool.adj = pool.adj.concat(GEN_VOCAB[lv].iadj, GEN_VOCAB[lv].naadj);
    pool.time = pool.time.concat(GEN_VOCAB[lv].time);
  });

  if (opts.useOwnWords) {
    const own = genCollectOwnWords(opts.ownWords);
    pool.noun = pool.noun.concat(own.noun);
    pool.verb = pool.verb.concat(own.verb);
    pool.adj = pool.adj.concat(own.iadj, own.naadj);
  }

  const verbObj = pool.verb.filter((v) => v.tr);

  if (pool.noun.length < 2 || pool.verb.length < 1 || pool.adj.length < 1 || verbObj.length < 1) {
    return { error: 'Bu ayarlarla yeterli kelime bulunamadı. Kelime seviyesini yükselt ya da "kendi kelimelerim" seçeneğini kapat.' };
  }

  const pools = {
    subject: GEN_PRONOUNS,
    noun: pool.noun,
    verb: pool.verb,
    verbObj,
    adj: pool.adj,
    time: pool.time,
  };

  const templates = genBuildTemplates(pools);
  const text = templates[opts.grammarLevel][opts.length]();
  return { text };
}
