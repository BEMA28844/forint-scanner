/* Ungarisch → Deutsch für Kassenbons: offline Wörterbuch, OCR-Varianten, Wortstämme.
   Was fehlt, kann die App optional online nachschlagen. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ForintHuDe = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fold(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/ß/g, 'ss').replace(/[^a-z0-9%]+/g, ' ').trim();
  }

  // [ungarisch, deutsch] – Mehrwort-Begriffe zuerst beim Nachschlagen
  const RAW = [
    ['ásványvíz szénsavas', 'Mineralwasser mit Kohlensäure'], ['asvanyviz szensavas', 'Mineralwasser mit Kohlensäure'],
    ['ásványvíz mentes', 'Mineralwasser still'], ['szénsavmentes', 'ohne Kohlensäure'], ['szénsavas', 'mit Kohlensäure'],
    ['teljes kiőrlésű', 'Vollkorn'], ['fehér kenyér', 'Weißbrot'], ['barna kenyér', 'Schwarzbrot'], ['rozsos kenyér', 'Roggenbrot'],
    ['zsírszegény tej', 'fettarme Milch'], ['zsírszegény', 'fettarm'], ['félzsíros', 'halbfett'], ['teljes tej', 'Vollmilch'],
    ['csirke mell filé', 'Hähnchenbrustfilet'], ['csirke mell', 'Hähnchenbrust'], ['csirke comb', 'Hähnchenschenkel'],
    ['csirke szárny', 'Hähnchenflügel'], ['csirke máj', 'Hähnchenleber'], ['sertés karaj', 'Schweinekotelett'],
    ['sertés tarja', 'Schweinenacken'], ['sertés oldalas', 'Schweinerippchen'], ['sertés comb', 'Schweineschinken'],
    ['marha darált', 'Rinderhack'], ['sertés darált', 'Schweinehack'], ['darált hús', 'Hackfleisch'],
    ['túró rudi', 'Túró Rudi'], ['pöttyös', 'Pöttyös'], ['trappista sajt', 'Trappistenkäse'],
    ['füstölt sajt', 'Räucherkäse'], ['ömlesztett sajt', 'Schmelzkäse'], ['fejes saláta', 'Kopfsalat'],
    ['jégsaláta', 'Eisbergsalat'], ['sárgarépa', 'Karotte'], ['vöröshagyma', 'Zwiebel'], ['lilahagyma', 'rote Zwiebel'],
    ['újburgonya', 'Frühkartoffel'], ['fokhagyma', 'Knoblauch'], ['zöldpaprika', 'grüner Paprika'],
    ['tv paprika', 'Paprika'], ['kaliforniai paprika', 'Paprika'], ['cseresznye', 'Kirsche'],
    ['őszibarack', 'Pfirsich'], ['sárgadinnye', 'Honigmelone'], ['görögdinnye', 'Wassermelone'],
    ['narancslé', 'Orangensaft'], ['almalé', 'Apfelsaft'], ['üdítőital', 'Erfrischungsgetränk'],
    ['ivóvíz', 'Trinkwasser'], ['ásványvíz', 'Mineralwasser'], ['szódavíz', 'Sodawasser'],
    ['bankkártya', 'Karte'], ['készpénz', 'Bar'], ['visszajáró', 'Rückgeld'], ['fizetendő', 'zu zahlen'],
    ['részösszeg', 'Zwischensumme'], ['összesen', 'Summe'], ['kedvezmény', 'Rabatt'], ['betétdíj', 'Pfand'],
    ['kerekítés', 'Rundung'], ['áfa', 'MwSt'], ['szatyor', 'Tüte'], ['nejlonzacskó', 'Plastiktüte'],
    ['wc papír', 'Toilettenpapier'], ['toalettpapír', 'Toilettenpapier'], ['papírzsebkendő', 'Taschentuch'],
    ['mosogatószer', 'Spülmittel'], ['mosószer', 'Waschmittel'], ['öblítő', 'Weichspüler'],
    ['fogkrém', 'Zahnpasta'], ['sampon', 'Shampoo'], ['szappan', 'Seife'], ['tusfürdő', 'Duschgel'],
    ['tejföl', 'saure Sahne'], ['tejszín', 'Sahne'], ['habtejszín', 'Schlagsahne'], ['tejpor', 'Milchpulver'],
    ['joghurt', 'Joghurt'], ['kefir', 'Kefir'], ['vajkrém', 'Buttercreme'], ['margarin', 'Margarine'],
    ['kenyér fehér', 'Weißbrot'], ['kenyér barna', 'Schwarzbrot'],
    ['kenyér', 'Brot'], ['zsemle', 'Brötchen'], ['kifli', 'Hörnchen'], ['bagett', 'Baguette'],
    ['pogácsa', 'Pogatschen'], ['kalács', 'Hefezopf'], ['rétes', 'Strudel'], ['péksütemény', 'Gebäck'],
    ['toast kenyér', 'Toastbrot'], ['toast', 'Toast'],
    ['tej', 'Milch'], ['vaj', 'Butter'], ['sajt', 'Käse'], ['túró', 'Quark'], ['tojás', 'Ei'],
    ['gomolya', 'Gomolya'], ['mozzarella', 'Mozzarella'], ['parmezán', 'Parmesan'], ['cheddar', 'Cheddar'],
    ['sertés', 'Schwein'], ['csirke', 'Hähnchen'], ['marha', 'Rind'], ['pulyka', 'Pute'], ['kacsa', 'Ente'],
    ['sonka', 'Schinken'], ['szalámi', 'Salami'], ['kolbász', 'Wurst'], ['virsli', 'Würstchen'],
    ['bacon', 'Speck'], ['szalonna', 'Speck'], ['máj', 'Leber'], ['májkrém', 'Lebercreme'],
    ['comb', 'Keule'], ['mell', 'Brust'], ['szárny', 'Flügel'], ['darált', 'Hackfleisch'],
    ['karaj', 'Kotelett'], ['tarja', 'Nacken'], ['oldalas', 'Rippchen'], ['fasírt', 'Frikadelle'],
    ['párizsi', 'Pariser'], ['felvágott', 'Aufschnitt'], ['gépsonka', 'Formschinken'], ['tarja szelet', 'Nackenscheibe'],
    ['alma', 'Apfel'], ['banán', 'Banane'], ['paradicsom', 'Tomate'], ['uborka', 'Gurke'], ['paprika', 'Paprika'],
    ['burgonya', 'Kartoffel'], ['krumpli', 'Kartoffel'], ['hagyma', 'Zwiebel'], ['káposzta', 'Kohl'],
    ['saláta', 'Salat'], ['citrom', 'Zitrone'], ['narancs', 'Orange'], ['szőlő', 'Traube'],
    ['eper', 'Erdbeere'], ['barack', 'Pfirsich'], ['meggy', 'Sauerkirsche'], ['körte', 'Birne'],
    ['dinnye', 'Melone'], ['cukkini', 'Zucchini'], ['gomba', 'Pilz'], ['petrezselyem', 'Petersilie'],
    ['zeller', 'Sellerie'], ['retek', 'Rettich'], ['cékla', 'Rote Bete'], ['spenót', 'Spinat'],
    ['brokkoli', 'Brokkoli'], ['karfiol', 'Blumenkohl'], ['padlizsán', 'Aubergine'], ['tök', 'Kürbis'],
    ['málna', 'Himbeere'], ['áfonya', 'Heidelbeere'], ['szilva', 'Pflaume'], ['kiwi', 'Kiwi'], ['ananász', 'Ananas'],
    ['sör', 'Bier'], ['bor', 'Wein'], ['pezsgő', 'Sekt'], ['kávé', 'Kaffee'], ['tea', 'Tee'],
    ['szörp', 'Sirup'], ['kóla', 'Cola'], ['cola', 'Cola'], ['üdítő', 'Limonade'], ['szóda', 'Soda'],
    ['víz', 'Wasser'], ['menta', 'Minze'], ['cukor', 'Zucker'], ['liszt', 'Mehl'], ['rizs', 'Reis'],
    ['olaj', 'Öl'], ['napraforgóolaj', 'Sonnenblumenöl'], ['olívaolaj', 'Olivenöl'], ['ecet', 'Essig'],
    ['só', 'Salz'], ['bors', 'Pfeffer'], ['tészta', 'Nudeln'], ['konzerv', 'Konserve'],
    ['lekvár', 'Marmelade'], ['méz', 'Honig'], ['müzli', 'Müsli'], ['zabpehely', 'Haferflocken'],
    ['ketchup', 'Ketchup'], ['mustár', 'Senf'], ['majonéz', 'Mayonnaise'], ['ételízesítő', 'Speisewürze'],
    ['leves', 'Suppe'], ['leveskocka', 'Brühewürfel'], ['fűszer', 'Gewürz'], ['paprikakrém', 'Paprikacreme'],
    ['csemege', 'delikat'], ['csípős', 'scharf'], ['édes', 'süß'], ['sós', 'salzig'],
    ['zsíros', 'fett'], ['sovány', 'mager'],
    ['friss', 'frisch'], ['fagyasztott', 'tiefgekühlt'], ['bio', 'Bio'], ['magyar', 'ungarisch'],
    ['szeletelt', 'aufgeschnitten'], ['csomagolt', 'verpackt'], ['füstölt', 'geräuchert'], ['főtt', 'gekocht'],
    ['pácolt', 'mariniert'], ['natúr', 'natur'], ['light', 'light'], ['ízesített', 'aromatisiert'],
    ['fehér', 'weiß'], ['barna', 'braun'], ['rozzsal', 'mit Roggen'], ['teljes', 'voll'],
    ['görög', 'griechisch'], ['natúr joghurt', 'Naturjoghurt'], ['gyümölcsjoghurt', 'Fruchtjoghurt'],
    ['kakaó', 'Kakao'], ['csokoládé', 'Schokolade'], ['csoki', 'Schokolade'], ['keksz', 'Keks'],
    ['ostya', 'Waffel'], ['nápolyi', 'Waffel'], ['cukorka', 'Bonbon'], ['rágó', 'Kaugummi'],
    ['chips', 'Chips'], ['ropogós', 'Knabbergebäck'], ['pattogatott', 'Popcorn'], ['mogyoró', 'Haselnuss'],
    ['dió', 'Walnuss'], ['mandula', 'Mandel'], ['napraforgómag', 'Sonnenblumenkerne'],
    ['uborkasaláta', 'Gurkensalat'], ['káposztasaláta', 'Krautsalat'], ['savanyúság', 'Essiggurke'],
    ['kovászos uborka', 'Salzgurke'], ['csemegeuborka', 'Gewürzgurke'],
    ['hal', 'Fisch'], ['tonhal', 'Thunfisch'], ['lazac', 'Lachs'], ['hekk', 'Seehecht'],
    ['ponty', 'Karpfen'], ['pisztráng', 'Forelle'],
    ['szósz', 'Soße'], ['mártás', 'Soße'], ['dresszing', 'Dressing'],
    ['pelenka', 'Windel'], ['betét', 'Einlage'], ['tampon', 'Tampon'],
    ['szalvéta', 'Serviette'], ['alufólia', 'Alufolie'], ['folpack', 'Frischhaltefolie'],
    ['mosogatószivacs', 'Spülschwamm'], ['szivacs', 'Schwamm'], ['tisztítószer', 'Reiniger'],
    ['öblítő', 'Weichspüler'], ['folttisztító', 'Fleckenentferner'],
    ['gyümölcs', 'Obst'], ['zöldség', 'Gemüse'], ['hús', 'Fleisch'], ['pékáru', 'Backware'],
    ['felár', 'Aufpreis'], ['akció', 'Aktion'], ['leárazás', 'Reduzierung'], ['engedmény', 'Rabatt'],
    ['utalvány', 'Gutschein'], ['visszaváltás', 'Pfandrückgabe'], ['göngyöleg', 'Leergut'],
    ['nyugta', 'Beleg'], ['pénztár', 'Kasse'], ['köszönjük', 'Danke'], ['viszontlátásra', 'Auf Wiedersehen'],
    ['db', 'Stk'], ['dkg', 'dag'], ['kg', 'kg'], ['csomag', 'Packung'], ['doboz', 'Schachtel'],
    ['üveg', 'Flasche'], ['tasak', 'Beutel'], ['pohár', 'Becher'], ['flakon', 'Flasche'],
    ['szelet', 'Scheibe'], ['karika', 'Ring'], ['cső', 'Stange'], ['szál', 'Stange'],
    ['1l', '1 l'], ['0,5l', '0,5 l'], ['1,5l', '1,5 l'], ['2l', '2 l'],
  ];

  const DICT = new Map();
  RAW.forEach(([hu, de]) => { const k = fold(hu); if (k && !DICT.has(k)) DICT.set(k, de); });
  const PHRASES = [...DICT.keys()].filter(k => k.includes(' ')).sort((a, b) => b.length - a.length);
  const WORDS = [...DICT.keys()].filter(k => !k.includes(' ') && k.length >= 3).sort((a, b) => b.length - a.length);

  const HEADER_KEYS = ['osszesen', 'fizetendo', 'keszpenz', 'bankkartya', 'kartya', 'visszajaro', 'afa', 'kedvezmeny', 'betetdij', 'engedmeny', 'kerekites', 'reszosszeg', 'gongyoleg', 'visszavaltas'];

  function dist(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 9;
    const m = [];
    for (let i = 0; i <= a.length; i++) {
      m[i] = [i];
      for (let j = 1; j <= b.length; j++) {
        if (!i) { m[i][j] = j; continue; }
        m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return m[a.length][b.length];
  }

  function lookupWord(token) {
    if (DICT.has(token)) return DICT.get(token);
    if (token.length < 4) return null;
    let best = null, bestD = 2;
    for (let i = 0; i < WORDS.length; i++) {
      const w = WORDS[i];
      if (token.startsWith(w) && token.length - w.length <= 3 && w.length >= 4) return DICT.get(w);
      if (w.startsWith(token) && w.length - token.length <= 1 && token.length >= 5) return DICT.get(w);
      if (Math.abs(w.length - token.length) > 1 || token.length < 5) continue;
      const d = dist(token, w);
      if (d < bestD) { bestD = d; best = DICT.get(w); if (d === 0) break; }
    }
    return best;
  }

  function isKeep(tok) {
    return /^[\d]+(?:[,.]\d+)?%?$/.test(tok) || /^\d+(?:[,.]\d+)?(?:l|ml|cl|g|kg|dkg|db|mg)$/.test(tok);
  }

  function translateLine(line) {
    const original = String(line || '').replace(/\s+/g, ' ').trim();
    if (!original) return { de: '', hu: '', offline: true, complete: true, unknown: [] };
    const tokens = original.split(/\s+/);
    const norms = tokens.map(t => fold(t));
    const out = [];
    const unknown = [];
    let i = 0, known = 0, words = 0;
    while (i < tokens.length) {
      if (isKeep(norms[i]) || /^[\d.,/%+-]+$/.test(tokens[i])) { out.push(tokens[i].replace(/L$/i, 'l')); i++; continue; }
      let hit = null, take = 1;
      const max = Math.min(4, tokens.length - i);
      for (let n = max; n >= 1; n--) {
        const phrase = norms.slice(i, i + n).join(' ');
        if (n > 1 && DICT.has(phrase)) { hit = DICT.get(phrase); take = n; break; }
        if (n === 1) { hit = lookupWord(phrase); take = 1; }
      }
      words++;
      if (hit) { known++; out.push(hit); }
      else { unknown.push(tokens[i]); out.push(tokens[i]); }
      i += take;
    }
    const de = out.join(' ').replace(/\s+/g, ' ').trim();
    return { de, hu: original, offline: true, complete: words === 0 || known === words, unknown, coverage: words ? known / words : 1 };
  }

  function headerLabels(text) {
    const n = fold(text);
    const found = [];
    HEADER_KEYS.forEach(k => { if (n.includes(k) && DICT.has(k)) found.push(DICT.get(k)); });
    return [...new Set(found)];
  }

  return { fold, translateLine, headerLabels, dictionarySize: DICT.size };
});
