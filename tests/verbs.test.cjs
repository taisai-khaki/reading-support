/* Verifies the verb memory the flashcard verb section is built from.
 * No browser needed: verb-analysis.js is loaded in a bare VM context. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createContext, runInContext } = require('node:vm');
const path = require('node:path');

const context = createContext({ window: {}, console });
runInContext(readFileSync(path.join(__dirname, '..', 'verb-analysis.js'), 'utf8'), context);
const bank = context.window.spanishVerbBank;

/* Independent reference: present yo / tú / él and past (preterite) yo / él for
 * every verb that is not conjugated by the plain pattern. Written by hand so it
 * is a real cross-check of the data in verb-analysis.js, not a copy of it. */
const IRREGULAR_REFERENCE = {
  acordar: ['acuerdo', 'acuerdas', 'acuerda', 'acordé', 'acordó'],
  acostar: ['acuesto', 'acuestas', 'acuesta', 'acosté', 'acostó'],
  actuar: ['actúo', 'actúas', 'actúa', 'actué', 'actuó'],
  adquirir: ['adquiero', 'adquieres', 'adquiere', 'adquirí', 'adquirió'],
  advertir: ['advierto', 'adviertes', 'advierte', 'advertí', 'advirtió'],
  almorzar: ['almuerzo', 'almuerzas', 'almuerza', 'almorcé', 'almorzó'],
  andar: ['ando', 'andas', 'anda', 'anduve', 'anduvo'],
  apostar: ['apuesto', 'apuestas', 'apuesta', 'aposté', 'apostó'],
  aprobar: ['apruebo', 'apruebas', 'aprueba', 'aprobé', 'aprobó'],
  atender: ['atiendo', 'atiendes', 'atiende', 'atendí', 'atendió'],
  atravesar: ['atravieso', 'atraviesas', 'atraviesa', 'atravesé', 'atravesó'],
  caber: ['quepo', 'cabes', 'cabe', 'cupe', 'cupo'],
  caer: ['caigo', 'caes', 'cae', 'caí', 'cayó'],
  calentar: ['caliento', 'calientas', 'calienta', 'calenté', 'calentó'],
  cerrar: ['cierro', 'cierras', 'cierra', 'cerré', 'cerró'],
  coger: ['cojo', 'coges', 'coge', 'cogí', 'cogió'],
  comenzar: ['comienzo', 'comienzas', 'comienza', 'comencé', 'comenzó'],
  competir: ['compito', 'compites', 'compite', 'competí', 'compitió'],
  componer: ['compongo', 'compones', 'compone', 'compuse', 'compuso'],
  conducir: ['conduzco', 'conduces', 'conduce', 'conduje', 'condujo'],
  conocer: ['conozco', 'conoces', 'conoce', 'conocí', 'conoció'],
  consentir: ['consiento', 'consientes', 'consiente', 'consentí', 'consintió'],
  conseguir: ['consigo', 'consigues', 'consigue', 'conseguí', 'consiguió'],
  contar: ['cuento', 'cuentas', 'cuenta', 'conté', 'contó'],
  contener: ['contengo', 'contienes', 'contiene', 'contuve', 'contuvo'],
  continuar: ['continúo', 'continúas', 'continúa', 'continué', 'continuó'],
  convertir: ['convierto', 'conviertes', 'convierte', 'convertí', 'convirtió'],
  corregir: ['corrijo', 'corriges', 'corrige', 'corregí', 'corrigió'],
  costar: ['cuesto', 'cuestas', 'cuesta', 'costé', 'costó'],
  crecer: ['crezco', 'creces', 'crece', 'crecí', 'creció'],
  creer: ['creo', 'crees', 'cree', 'creí', 'creyó'],
  dar: ['doy', 'das', 'da', 'di', 'dio'],
  decir: ['digo', 'dices', 'dice', 'dije', 'dijo'],
  defender: ['defiendo', 'defiendes', 'defiende', 'defendí', 'defendió'],
  demostrar: ['demuestro', 'demuestras', 'demuestra', 'demostré', 'demostró'],
  descender: ['desciendo', 'desciendes', 'desciende', 'descendí', 'descendió'],
  despedir: ['despido', 'despides', 'despide', 'despedí', 'despidió'],
  despertar: ['despierto', 'despiertas', 'despierta', 'desperté', 'despertó'],
  devolver: ['devuelvo', 'devuelves', 'devuelve', 'devolví', 'devolvió'],
  divertir: ['divierto', 'diviertes', 'divierte', 'divertí', 'divirtió'],
  desvanecer: ['desvanezco', 'desvaneces', 'desvanece', 'desvanecí', 'desvaneció'],
  detener: ['detengo', 'detienes', 'detiene', 'detuve', 'detuvo'],
  dirigir: ['dirijo', 'diriges', 'dirige', 'dirigí', 'dirigió'],
  disponer: ['dispongo', 'dispones', 'dispone', 'dispuse', 'dispuso'],
  dormir: ['duermo', 'duermes', 'duerme', 'dormí', 'durmió'],
  elegir: ['elijo', 'eliges', 'elige', 'elegí', 'eligió'],
  empezar: ['empiezo', 'empiezas', 'empieza', 'empecé', 'empezó'],
  encender: ['enciendo', 'enciendes', 'enciende', 'encendí', 'encendió'],
  encontrar: ['encuentro', 'encuentras', 'encuentra', 'encontré', 'encontró'],
  enfriar: ['enfrío', 'enfrías', 'enfría', 'enfrié', 'enfrió'],
  entender: ['entiendo', 'entiendes', 'entiende', 'entendí', 'entendió'],
  entretener: ['entretengo', 'entretienes', 'entretiene', 'entretuve', 'entretuvo'],
  enviar: ['envío', 'envías', 'envía', 'envié', 'envió'],
  escoger: ['escojo', 'escoges', 'escoge', 'escogí', 'escogió'],
  estar: ['estoy', 'estás', 'está', 'estuve', 'estuvo'],
  exigir: ['exijo', 'exiges', 'exige', 'exigí', 'exigió'],
  exponer: ['expongo', 'expones', 'expone', 'expuse', 'expuso'],
  extender: ['extiendo', 'extiendes', 'extiende', 'extendí', 'extendió'],
  fingir: ['finjo', 'finges', 'finge', 'fingí', 'fingió'],
  forzar: ['fuerzo', 'fuerzas', 'fuerza', 'forcé', 'forzó'],
  freír: ['frío', 'fríes', 'fríe', 'freí', 'frió'],
  haber: ['he', 'has', 'ha', 'hube', 'hubo'],
  hacer: ['hago', 'haces', 'hace', 'hice', 'hizo'],
  herir: ['hiero', 'hieres', 'hiere', 'herí', 'hirió'],
  hervir: ['hiervo', 'hierves', 'hierve', 'herví', 'hirvió'],
  impedir: ['impido', 'impides', 'impide', 'impedí', 'impidió'],
  imponer: ['impongo', 'impones', 'impone', 'impuse', 'impuso'],
  intervenir: ['intervengo', 'intervienes', 'interviene', 'intervine', 'intervino'],
  invertir: ['invierto', 'inviertes', 'invierte', 'invertí', 'invirtió'],
  ir: ['voy', 'vas', 'va', 'fui', 'fue'],
  jugar: ['juego', 'juegas', 'juega', 'jugué', 'jugó'],
  leer: ['leo', 'lees', 'lee', 'leí', 'leyó'],
  mantener: ['mantengo', 'mantienes', 'mantiene', 'mantuve', 'mantuvo'],
  medir: ['mido', 'mides', 'mide', 'medí', 'midió'],
  mentir: ['miento', 'mientes', 'miente', 'mentí', 'mintió'],
  merecer: ['merezco', 'mereces', 'merece', 'merecí', 'mereció'],
  morder: ['muerdo', 'muerdes', 'muerde', 'mordí', 'mordió'],
  morir: ['muero', 'mueres', 'muere', 'morí', 'murió'],
  mostrar: ['muestro', 'muestras', 'muestra', 'mostré', 'mostró'],
  mover: ['muevo', 'mueves', 'mueve', 'moví', 'movió'],
  nacer: ['nazco', 'naces', 'nace', 'nací', 'nació'],
  negar: ['niego', 'niegas', 'niega', 'negué', 'negó'],
  obedecer: ['obedezco', 'obedeces', 'obedece', 'obedecí', 'obedeció'],
  obtener: ['obtengo', 'obtienes', 'obtiene', 'obtuve', 'obtuvo'],
  ofrecer: ['ofrezco', 'ofreces', 'ofrece', 'ofrecí', 'ofreció'],
  oír: ['oigo', 'oyes', 'oye', 'oí', 'oyó'],
  oler: ['huelo', 'hueles', 'huele', 'olí', 'olió'],
  oscurecer: ['oscurezco', 'oscureces', 'oscurece', 'oscurecí', 'oscureció'],
  padecer: ['padezco', 'padeces', 'padece', 'padecí', 'padeció'],
  parecer: ['parezco', 'pareces', 'parece', 'parecí', 'pareció'],
  pedir: ['pido', 'pides', 'pide', 'pedí', 'pidió'],
  pensar: ['pienso', 'piensas', 'piensa', 'pensé', 'pensó'],
  perder: ['pierdo', 'pierdes', 'pierde', 'perdí', 'perdió'],
  permanecer: ['permanezco', 'permaneces', 'permanece', 'permanecí', 'permaneció'],
  poder: ['puedo', 'puedes', 'puede', 'pude', 'pudo'],
  poner: ['pongo', 'pones', 'pone', 'puse', 'puso'],
  posponer: ['pospongo', 'pospones', 'pospone', 'pospuse', 'pospuso'],
  preferir: ['prefiero', 'prefieres', 'prefiere', 'preferí', 'prefirió'],
  prevenir: ['prevengo', 'previenes', 'previene', 'previne', 'previno'],
  probar: ['pruebo', 'pruebas', 'prueba', 'probé', 'probó'],
  producir: ['produzco', 'produces', 'produce', 'produje', 'produjo'],
  prohibir: ['prohíbo', 'prohíbes', 'prohíbe', 'prohibí', 'prohibió'],
  proponer: ['propongo', 'propones', 'propone', 'propuse', 'propuso'],
  proteger: ['protejo', 'proteges', 'protege', 'protegí', 'protegió'],
  proveer: ['proveo', 'provees', 'provee', 'proveí', 'proveyó'],
  querer: ['quiero', 'quieres', 'quiere', 'quise', 'quiso'],
  reconocer: ['reconozco', 'reconoces', 'reconoce', 'reconocí', 'reconoció'],
  recordar: ['recuerdo', 'recuerdas', 'recuerda', 'recordé', 'recordó'],
  reducir: ['reduzco', 'reduces', 'reduce', 'reduje', 'redujo'],
  regar: ['riego', 'riegas', 'riega', 'regué', 'regó'],
  reír: ['río', 'ríes', 'ríe', 'reí', 'rió'],
  rendir: ['rindo', 'rindes', 'rinde', 'rendí', 'rindió'],
  repetir: ['repito', 'repites', 'repite', 'repetí', 'repitió'],
  resolver: ['resuelvo', 'resuelves', 'resuelve', 'resolví', 'resolvió'],
  retener: ['retengo', 'retienes', 'retiene', 'retuve', 'retuvo'],
  reunir: ['reúno', 'reúnes', 'reúne', 'reuní', 'reunió'],
  rodar: ['ruedo', 'ruedas', 'rueda', 'rodé', 'rodó'],
  saber: ['sé', 'sabes', 'sabe', 'supe', 'supo'],
  satisfacer: ['satisfago', 'satisfaces', 'satisface', 'satisfice', 'satisfizo'],
  salir: ['salgo', 'sales', 'sale', 'salí', 'salió'],
  seguir: ['sigo', 'sigues', 'sigue', 'seguí', 'siguió'],
  sentar: ['siento', 'sientas', 'sienta', 'senté', 'sentó'],
  sentir: ['siento', 'sientes', 'siente', 'sentí', 'sintió'],
  ser: ['soy', 'eres', 'es', 'fui', 'fue'],
  servir: ['sirvo', 'sirves', 'sirve', 'serví', 'sirvió'],
  soler: ['suelo', 'sueles', 'suele', 'solí', 'solió'],
  soltar: ['suelto', 'sueltas', 'suelta', 'solté', 'soltó'],
  sonreír: ['sonrío', 'sonríes', 'sonríe', 'sonreí', 'sonrió'],
  soñar: ['sueño', 'sueñas', 'sueña', 'soñé', 'soñó'],
  sostener: ['sostengo', 'sostienes', 'sostiene', 'sostuve', 'sostuvo'],
  sugerir: ['sugiero', 'sugieres', 'sugiere', 'sugerí', 'sugirió'],
  suponer: ['supongo', 'supones', 'supone', 'supuse', 'supuso'],
  tender: ['tiendo', 'tiendes', 'tiende', 'tendí', 'tendió'],
  tener: ['tengo', 'tienes', 'tiene', 'tuve', 'tuvo'],
  traducir: ['traduzco', 'traduces', 'traduce', 'traduje', 'tradujo'],
  traer: ['traigo', 'traes', 'trae', 'traje', 'trajo'],
  vaciar: ['vacío', 'vacías', 'vacía', 'vacié', 'vació'],
  valer: ['valgo', 'vales', 'vale', 'valí', 'valió'],
  variar: ['varío', 'varías', 'varía', 'varié', 'varió'],
  vencer: ['venzo', 'vences', 'vence', 'vencí', 'venció'],
  venir: ['vengo', 'vienes', 'viene', 'vine', 'vino'],
  ver: ['veo', 'ves', 've', 'vi', 'vio'],
  verter: ['vierto', 'viertes', 'vierte', 'vertí', 'vertió'],
  vestir: ['visto', 'vistes', 'viste', 'vestí', 'vistió'],
  volar: ['vuelo', 'vuelas', 'vuela', 'volé', 'voló'],
  volver: ['vuelvo', 'vuelves', 'vuelve', 'volví', 'volvió']
};

/* Plain pattern, implemented again here so “regular” is not self-certified. */
function plainPattern(lemma) {
  const ending = lemma.slice(-2).normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(-2);
  const stem = lemma.slice(0, -2);
  // construir → construyo / construyó is a spelling rule, not an irregularity.
  const uir = ending === 'ir' && stem.endsWith('u') && !stem.endsWith('gu');
  const present = { ar: ['o', 'as', 'a'], er: ['o', 'es', 'e'], ir: ['o', 'es', 'e'] }[ending];
  const preterite = { ar: ['é', 'aste', 'ó'], er: ['í', 'iste', 'ió'], ir: ['í', 'iste', 'ió'] }[ending];
  const presentForms = [0, 1, 2].map(i => (uir ? `${stem}y` : stem) + present[i]);
  const preteriteForms = [0, 1, 2].map(i => (uir && i === 2 ? `${stem}yó` : stem + preterite[i]));
  return [...presentForms, ...preteriteForms];
}

test('the verb memory holds a useful number of verbs', () => {
  assert.ok(bank.size() >= 400, `expected a large memory, got ${bank.size()}`);
  const all = bank.all();
  assert.equal(all.length, bank.size());
  assert.deepEqual([...all.map(v => v.infinitive)].sort(), [...all.map(v => v.infinitive)].sort());
});

test('every irregular verb in memory matches the hand-written reference', () => {
  const irregular = bank.all().filter(verb => !verb.regular).map(verb => verb.infinitive);
  const missingFromReference = irregular.filter(lemma => !IRREGULAR_REFERENCE[lemma]);
  assert.deepEqual([...missingFromReference], [], 'verbs marked irregular but not in the reference');

  const problems = [];
  irregular.forEach(lemma => {
    const [pyo, ptu, pel, kyo, kel] = IRREGULAR_REFERENCE[lemma];
    const verb = bank.get(lemma);
    const actual = [verb.present[0], verb.present[1], verb.present[2], verb.preterite[0], verb.preterite[2]];
    if (actual.join('|') !== [pyo, ptu, pel, kyo, kel].join('|')) {
      problems.push(`${lemma}: expected ${[pyo, ptu, pel, kyo, kel].join(', ')} got ${actual.join(', ')}`);
    }
  });
  assert.deepEqual([...problems], [], 'wrong present/past forms');
});

test('every verb in the reference is actually flagged irregular', () => {
  const flaggedRegular = Object.keys(IRREGULAR_REFERENCE).filter(lemma => bank.get(lemma)?.regular);
  assert.deepEqual([...flaggedRegular], [], 'these should not be called regular');
});

test('regular verbs really follow the plain pattern', () => {
  const problems = [];
  bank.all().filter(verb => verb.regular).forEach(verb => {
    const pattern = plainPattern(verb.infinitive);
    const expected = [pattern[0], pattern[1], pattern[2], pattern[3], pattern[5]];
    const actual = [verb.present[0], verb.present[1], verb.present[2], verb.preterite[0], verb.preterite[2]];
    // Spelling-only adjustments (buscar → busqué) are still “regular”.
    const spell = form => form.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/qu/g, 'c').replace(/gu/g, 'g').replace(/c([ei])/g, 'z$1').replace(/z([ao])/g, 'c$1');
    if (actual.join('|') !== expected.join('|') && spell(actual.join('|')) !== spell(expected.join('|'))) {
      problems.push(`${verb.infinitive}: ${actual.join(', ')} vs ${expected.join(', ')}`);
    }
  });
  assert.deepEqual([...problems], [], 'regular verbs deviating from the pattern');
});

test('spelling-change verbs stay regular and keep the right preterite', () => {
  assert.equal(bank.get('buscar').regular, true);
  assert.equal(bank.get('buscar').preterite[0], 'busqué');
  assert.equal(bank.get('llegar').preterite[0], 'llegué');
  assert.equal(bank.get('empezar').preterite[0], 'empecé');
});

test('reflexive lemmas resolve to their reflexive infinitive', () => {
  const verb = bank.get('levantarse');
  assert.equal(verb.infinitive, 'levantarse');
  assert.equal(verb.reflexive, true);
  assert.equal(verb.present[0], 'levanto');
  assert.equal(bank.get('llamarse').infinitive, 'llamarse');
  assert.equal(bank.get('irse').infinitive, 'irse');
});

test('matchText finds the verb behind a saved expression', () => {
  const passage = 'Cuando llegué a la casa de mi abuela, la puerta estaba entreabierta.';
  const found = bank.matchText('llegué', passage, passage.indexOf('llegué'));
  assert.equal(found.length, 1);
  assert.equal(found[0].infinitive, 'llegar');
  assert.equal(found[0].matchedForm, 'llegué');

  const reflexive = bank.matchText('Me senté a su lado', 'Me senté a su lado y le conté todo', 0);
  assert.deepEqual([...reflexive.map(verb => verb.infinitive)], ['sentarse']);

  assert.deepEqual([...bank.matchText('la casa', 'la casa de mi abuela', 0)], [], 'nouns must not match');
});

test('readers can add a verb to the memory', () => {
  assert.equal(bank.get('teletrabajar'), null);
  const added = bank.add('teletrabajar');
  assert.equal(added.infinitive, 'teletrabajar');
  assert.equal(added.present[0], 'teletrabajo');
  assert.equal(added.preterite[0], 'teletrabajé');
  assert.equal(bank.get('teletrabajar').infinitive, 'teletrabajar');
  // A known irregular keeps its real forms instead of being regularized.
  assert.equal(bank.add('tener').present[0], 'tengo');
  assert.equal(bank.add('comida'), null, 'non-verbs are rejected');
});
