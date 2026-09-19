// Korece Otomatik Cümle Oluşturucu — generator.js'in (Japonca) aynı tasarımı:
// tamamen offline, kural/şablon tabanlı, fiil-nesne anlam uyumu için
// kategorilendirilmiş isim havuzu + elle doğrulanmış fiil/sıfat listesi
// (ko-vocab.js) + Hangıl tabanlı gerçek çekim motoru (ko-hangul.js).

const GEN_KO_LEVEL_ORDER = ['초급', '중급', '고급'];
const GEN_KO_LENGTH_ORDER = ['short', 'medium', 'long'];

const GEN_KO_PRONOUNS = ['저', '그', '그녀', '우리'];

function koPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function koHasCat(noun, cats) {
  return noun.cat.some((c) => cats.includes(c));
}

function koPickObjectFor(verb, nounPool) {
  const candidates = nounPool.filter((n) => koHasCat(n, verb.objectCats));
  return koPick(candidates.length ? candidates : nounPool);
}

function koBuildTemplates(pools) {
  function objVerbPair(form) {
    const verb = koPick(pools.verbObj);
    const obj = koPickObjectFor(verb, pools.noun);
    const suffix = form === 'connector' ? koConnector(verb) : koConjugate(verb, form);
    return { obj: obj.jp, verbForm: suffix };
  }

  return {
    초급: {
      short: () => {
        const subj = koPick(pools.subject);
        const pred = koPick(pools.personNoun);
        return `${subj}${josaEunNeun(subj)} ${pred.jp}${josaIeyoYeyo(pred.jp)}.`;
      },
      medium: () => {
        const subj = koPick(pools.subject);
        const p = objVerbPair('polite');
        return `${koPick(pools.time)}, ${subj}${josaEunNeun(subj)} ${p.obj}${josaEulReul(p.obj)} ${p.verbForm}.`;
      },
      long: () => {
        const subj = koPick(pools.subject);
        const p1 = objVerbPair('connector');
        const p2 = objVerbPair('polite');
        return `${subj}${josaEunNeun(subj)} ${p1.obj}${josaEulReul(p1.obj)} ${p1.verbForm}, ${p2.obj}${josaEulReul(p2.obj)} ${p2.verbForm}.`;
      },
    },
    중급: {
      short: () => {
        const subj = koPick(pools.subject);
        const p = objVerbPair('permission');
        return `${subj}${josaEunNeun(subj)} ${p.obj}${josaEulReul(p.obj)} ${p.verbForm}.`;
      },
      medium: () => {
        const topic = koPick(pools.noun);
        const adj = koPick(pools.adj);
        const subj = koPick(pools.subject);
        return `${topic.jp}${josaIGa(topic.jp)} ${koConjugate(adj, 'reason')}, ${subj}${josaEunNeun(subj)} ${koConjugate(koPick(pools.verbAny), 'polite')}.`;
      },
      long: () => {
        const time = koPick(pools.time);
        const p1 = objVerbPair('connector');
        const p2 = objVerbPair('polite');
        return `${time}${josaEunNeun(time)} ${p1.obj}${josaEulReul(p1.obj)} ${p1.verbForm}, ${p2.obj}${josaEulReul(p2.obj)} ${p2.verbForm}.`;
      },
    },
    고급: {
      short: () => {
        const topic = koPick(pools.noun);
        return `${koPick(pools.time)}, ${topic.jp}${josaEunNeun(topic.jp)} ${koAdnominal(koPick(pools.verbAny), 'verb-present')} 것 같아요.`;
      },
      medium: () => {
        const t1 = koPick(pools.noun);
        const t2 = koPick(pools.noun);
        return `${t1.jp}${josaIGa(t1.jp)} ${koIfConditional(koPick(pools.verbAny))}, ${t2.jp}${josaEunNeun(t2.jp)} ${koAdnominal(koPick(pools.adj), 'adj-present')} 것 같아요.`;
      },
      long: () => {
        const subj = koPick(pools.subject);
        return `${subj}${josaEunNeun(subj)} ${koAdnominal(koPick(pools.verbAny), 'verb-past')} 적이 있어요.`;
      },
    },
  };
}

// ---------- Kullanıcının kendi Korece kelime defterinden derleme ----------
// Kuromoji gibi bir Korece morfolojik analizör yok, bu yüzden çok basit bir
// sezgi kullanılıyor: "다" ile bitiyorsa fiil/sıfat (çekim sınıfı 'reg'
// varsayılır — düzensiz olabilir, bu durumda üretilen form hatalı olabilir,
// bu bilinen bir sınırlama), değilse isim (kategori: 'thing').
function koCollectOwnWords(ownWords) {
  const result = { noun: [], verbOrAdj: [] };
  if (!ownWords) return result;
  ownWords.forEach((w) => {
    const text = (w.text || '').trim();
    if (!text) return;
    if (/다$/.test(text)) {
      result.verbOrAdj.push({ jp: text, cls: 'reg' });
    } else {
      result.noun.push({ jp: text, cat: ['thing'] });
    }
  });
  return result;
}

// opts: { grammarLevel, length, vocabLevel, useOwnWords, ownWords }
function generateKoreanSentence(opts) {
  const levelIdx = GEN_KO_LEVEL_ORDER.indexOf(opts.vocabLevel);
  const levels = GEN_KO_LEVEL_ORDER.slice(0, levelIdx + 1);

  const pool = { noun: [], adj: [], verbCurated: [], time: [] };
  levels.forEach((lv) => {
    pool.noun = pool.noun.concat(GEN_KO_VOCAB[lv].nouns);
    pool.adj = pool.adj.concat(GEN_KO_VOCAB[lv].adj);
    pool.verbCurated = pool.verbCurated.concat(GEN_KO_VOCAB[lv].verbs);
    pool.time = pool.time.concat(GEN_KO_VOCAB[lv].time);
  });

  let ownNoun = [];
  let ownVerbAdj = [];
  if (opts.useOwnWords) {
    const own = koCollectOwnWords(opts.ownWords);
    ownNoun = own.noun;
    ownVerbAdj = own.verbOrAdj;
  }

  const noun = pool.noun.concat(ownNoun);
  const personNoun = noun.filter((n) => koHasCat(n, ['person']));
  const adj = pool.adj;
  const verbObj = pool.verbCurated.filter((v) => v.objectCats && v.objectCats.length);
  const verbAny = pool.verbCurated.concat(ownVerbAdj);

  if (noun.length < 2 || adj.length < 1 || verbObj.length < 1 || verbAny.length < 1 || personNoun.length < 1) {
    return { error: 'Bu ayarlarla yeterli kelime bulunamadı. Kelime seviyesini yükselt ya da "kendi kelimelerim" seçeneğini kapat.' };
  }

  const pools = {
    subject: GEN_KO_PRONOUNS,
    noun,
    personNoun,
    adj,
    verbObj,
    verbAny,
    time: pool.time,
  };

  const templates = koBuildTemplates(pools);
  const text = templates[opts.grammarLevel][opts.length]();
  return { text };
}
