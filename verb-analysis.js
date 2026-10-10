/* A small, offline Spanish verb-form helper for the flashcard details. */
(() => {
  const PERSONS = [
    '1st person singular · yo',
    '2nd person singular · tú',
    '3rd person singular · él / ella / usted',
    '1st person plural · nosotros/as',
    '2nd person plural · vosotros/as',
    '3rd person plural · ellos / ellas / ustedes'
  ];
  const formIndex = new Map();
  // Every registered infinitive, keyed by normalized lemma. This is the app's
  // verb memory: the flashcard verb section reads it to build practice cards.
  const verbCatalog = new Map();
  const agreeingIrregularParticiples = new Set(['abierto', 'caído', 'creído', 'cubierto', 'dicho', 'escrito', 'frito', 'hecho', 'muerto', 'oído', 'puesto', 'reído', 'roto', 'satisfecho', 'sonreído', 'traído', 'visto', 'vuelto']);

  const normalize = value => String(value || '').normalize('NFC').toLocaleLowerCase('es');
  const unique = values => [...new Set(values.filter(Boolean))];

  function addForm(form, detail) {
    const key = normalize(form);
    if (!key) return;
    const records = formIndex.get(key) || [];
    if (!records.some(item => item.infinitive === detail.infinitive && item.tense === detail.tense && item.person === detail.person && item.kind === detail.kind)) {
      records.push(detail);
      formIndex.set(key, records);
    }
  }

  function regularForms(lemma, ending) {
    const stem = lemma.slice(0, -2);
    const ar = ending === 'ar';
    const er = ending === 'er';
    const presentEndings = ar ? ['o', 'as', 'a', 'amos', 'áis', 'an']
      : (er ? ['o', 'es', 'e', 'emos', 'éis', 'en'] : ['o', 'es', 'e', 'imos', 'ís', 'en']);
    const preteriteEndings = ar ? ['é', 'aste', 'ó', 'amos', 'asteis', 'aron']
      : ['í', 'iste', 'ió', 'imos', 'isteis', 'ieron'];
    const imperfectEndings = ar ? ['aba', 'abas', 'aba', 'ábamos', 'abais', 'aban']
      : ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'];
    const subjunctiveEndings = ar ? ['e', 'es', 'e', 'emos', 'éis', 'en']
      : ['a', 'as', 'a', 'amos', 'áis', 'an'];
    const futureEndings = ['é', 'ás', 'á', 'emos', 'éis', 'án'];
    const conditionalEndings = ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'];
    const forms = {
      stem,
      present: presentEndings.map(endingText => stem + endingText),
      preterite: preteriteEndings.map(endingText => stem + endingText),
      imperfect: imperfectEndings.map(endingText => stem + endingText),
      presentSubjunctive: subjunctiveEndings.map(endingText => stem + endingText),
      future: futureEndings.map(endingText => lemma + endingText),
      conditional: conditionalEndings.map(endingText => lemma + endingText),
      participle: stem + (ar ? 'ado' : 'ido'),
      gerund: stem + (ar ? 'ando' : 'iendo')
    };

    if (ending === 'ir' && lemma.endsWith('uir') && !lemma.endsWith('guir')) {
      forms.present = [`${stem}yo`, `${stem}yes`, `${stem}ye`, `${stem}imos`, `${stem}ís`, `${stem}yen`];
      forms.preterite[2] = `${stem}yó`;
      forms.preterite[5] = `${stem}yeron`;
      forms.presentSubjunctive = [`${stem}ya`, `${stem}yas`, `${stem}ya`, `${stem}yamos`, `${stem}yáis`, `${stem}yan`];
      forms.gerund = `${stem}yendo`;
    }
    if (ending === 'ar' && lemma.endsWith('car')) {
      const softStem = `${stem.slice(0, -1)}qu`;
      forms.preterite[0] = `${stem.slice(0, -1)}qué`;
      forms.presentSubjunctive = ['e', 'es', 'e', 'emos', 'éis', 'en'].map(suffix => softStem + suffix);
    } else if (ending === 'ar' && lemma.endsWith('gar')) {
      const softStem = `${stem}u`;
      forms.preterite[0] = `${softStem}é`;
      forms.presentSubjunctive = ['e', 'es', 'e', 'emos', 'éis', 'en'].map(suffix => softStem + suffix);
    } else if (ending === 'ar' && lemma.endsWith('zar')) {
      const softStem = `${stem.slice(0, -1)}c`;
      forms.preterite[0] = `${softStem}é`;
      forms.presentSubjunctive = ['e', 'es', 'e', 'emos', 'éis', 'en'].map(suffix => softStem + suffix);
    }
    return forms;
  }

  function sameForms(actual, expected) {
    return Array.isArray(actual) && Array.isArray(expected)
      && actual.length === expected.length
      && actual.every((form, index) => normalize(form) === normalize(expected[index]));
  }

  function registerVerb(lemma, overrides = {}) {
    const ending = normalize(lemma).slice(-2).replace('í', 'i');
    if (!['ar', 'er', 'ir'].includes(ending)) return;
    const regular = regularForms(lemma, ending);
    const stem = regular.stem;
    const forms = { ...regular, ...overrides };
    const presentYo = overrides.presentYo || forms.present[0];
    const metadata = { infinitive: lemma, stem: stem ? `${stem}-` : 'irregular', presentYo };

    // “Regular” means the present and the past (preterite) follow the pattern.
    // Spelling-only changes (buscar → busqué) are applied by regularForms, so
    // those verbs still count as regular. Everything else is flagged.
    const irregularIn = [
      ['Present', forms.present, regular.present],
      ['Past · preterite', forms.preterite, regular.preterite]
    ].filter(([, actual, expected]) => !sameForms(actual, expected)).map(([label]) => label);
    const otherIrregular = [
      ['Imperfect', forms.imperfect, regular.imperfect],
      ['Present subjunctive', forms.presentSubjunctive, regular.presentSubjunctive],
      ['Future', forms.future, regular.future],
      ['Conditional', forms.conditional, regular.conditional]
    ].filter(([, actual, expected]) => !sameForms(actual, expected)).map(([label]) => label);
    if (normalize(forms.participle) !== normalize(regular.participle)) otherIrregular.push('Past participle');
    if (normalize(forms.gerund) !== normalize(regular.gerund)) otherIrregular.push('Gerund');

    verbCatalog.set(normalize(lemma), {
      infinitive: lemma,
      ending,
      stem,
      regular: irregularIn.length === 0,
      irregularIn,
      otherIrregular,
      presentYo,
      present: forms.present.slice(),
      preterite: forms.preterite.slice(),
      imperfect: forms.imperfect.slice(),
      presentSubjunctive: forms.presentSubjunctive.slice(),
      future: forms.future.slice(),
      conditional: forms.conditional.slice(),
      participle: forms.participle,
      gerund: forms.gerund,
      reflexive: false
    });

    const finiteTenses = [
      ['Present indicative', forms.present],
      ['Preterite', forms.preterite],
      ['Imperfect', forms.imperfect],
      ['Present subjunctive', forms.presentSubjunctive],
      ['Future', forms.future],
      ['Conditional', forms.conditional]
    ];
    finiteTenses.forEach(([tense, conjugations]) => {
      conjugations.forEach((form, index) => addForm(form, {
        ...metadata,
        form,
        tense,
        person: PERSONS[index],
        kind: 'finite'
      }));
    });

    addForm(lemma, {
      ...metadata,
      form: lemma,
      tense: 'Infinitive',
      person: 'Non-finite · no person',
      kind: 'infinitive'
    });

    const participle = forms.participle;
    const allowsAgreement = participle === regular.participle || agreeingIrregularParticiples.has(participle);
    const participleForms = allowsAgreement
      ? [participle, participle.replace(/o$/i, 'a'), participle.replace(/o$/i, 'os'), participle.replace(/o$/i, 'as')]
      : [participle];
    participleForms.forEach((form, index) => addForm(form, {
      ...metadata,
      form,
      tense: index === 0 ? 'Past participle' : 'Past participle · agrees in gender/number',
      person: 'Non-finite · no person',
      kind: 'participle'
    }));
    addForm(forms.gerund, {
      ...metadata,
      form: forms.gerund,
      tense: 'Gerund',
      person: 'Non-finite · no person',
      kind: 'gerund'
    });
  }

  const commonVerbs = `
    abandonar abrir aburrir aceptar acompañar acostar acostarse actuar admirar ayudar bailar bajar bañarse beber buscar
    caber caer caminar cambiar cantar cocinar comenzar comprar comprender conducir conocer conseguir construir contar correr
    cortar creer cuidar cumplir dar deber decir dejar descansar desear despertar despertarse devolver dibujar dirigir disfrutar
    dormir ducharse durar elegir empezar encontrar enseñar entender entrar escribir escuchar esperar estudiar explicar faltar
    ganar gastar gustar hablar hacer hallar imaginar incluir intentar invitar ir jugar lavar lavarse leer levantar levantarse
    limpiar llamar llamarse llegar llevar llorar mantener mandar marcar medir mejorar mirar morir mostrar nacer necesitar notar
    ofrecer oír olvidar ordenar pagar parar parecer parecerse partir pasar pedir pensar perder permitir poder poner practicar
    preferir preguntar quedar quedarse querer recibir recordar regresar repetir resolver responder reunir romper sacar salir seguir
    sentir sentarse ser servir soñar subir tener terminar tocar tomar trabajar traer traducir usar valer venir ver viajar vivir
    volver desayunar aprender aprenderse amar andar aprovechar arreglar atravesar avanzar ayudar calentar cerrar coger compartir
    conservar continuar creer crecer cuidar descubrir divertir dividir entregar enviar faltar firmar formar freír ganar guardar
    huir jugar merecer mover nadar pagar peinarse permanecer probar producir proteger publicar reír reparar saltar salvar
    secar sonreír sorprender suceder sufrir temer tirar vencer vender vestir vestirse visitar volar votar
  `.trim().split(/\s+/);

  const irregular = {
    ser: {
      present: ['soy', 'eres', 'es', 'somos', 'sois', 'son'],
      preterite: ['fui', 'fuiste', 'fue', 'fuimos', 'fuisteis', 'fueron'],
      imperfect: ['era', 'eras', 'era', 'éramos', 'erais', 'eran'],
      presentSubjunctive: ['sea', 'seas', 'sea', 'seamos', 'seáis', 'sean'],
      participle: 'sido', gerund: 'siendo'
    },
    ir: {
      present: ['voy', 'vas', 'va', 'vamos', 'vais', 'van'],
      preterite: ['fui', 'fuiste', 'fue', 'fuimos', 'fuisteis', 'fueron'],
      imperfect: ['iba', 'ibas', 'iba', 'íbamos', 'ibais', 'iban'],
      presentSubjunctive: ['vaya', 'vayas', 'vaya', 'vayamos', 'vayáis', 'vayan'],
      participle: 'ido', gerund: 'yendo'
    },
    estar: {
      present: ['estoy', 'estás', 'está', 'estamos', 'estáis', 'están'],
      preterite: ['estuve', 'estuviste', 'estuvo', 'estuvimos', 'estuvisteis', 'estuvieron'],
      presentSubjunctive: ['esté', 'estés', 'esté', 'estemos', 'estéis', 'estén'],
      participle: 'estado'
    },
    caber: {
      present: ['quepo', 'cabes', 'cabe', 'cabemos', 'cabéis', 'caben'],
      preterite: ['cupe', 'cupiste', 'cupo', 'cupimos', 'cupisteis', 'cupieron'],
      presentSubjunctive: ['quepa', 'quepas', 'quepa', 'quepamos', 'quepáis', 'quepan'],
      future: ['cabré', 'cabrás', 'cabrá', 'cabremos', 'cabréis', 'cabrán'],
      conditional: ['cabría', 'cabrías', 'cabría', 'cabríamos', 'cabríais', 'cabrían'],
      presentYo: 'quepo', gerund: 'cabiendo'
    },
    andar: {
      preterite: ['anduve', 'anduviste', 'anduvo', 'anduvimos', 'anduvisteis', 'anduvieron']
    },
    valer: {
      present: ['valgo', 'vales', 'vale', 'valemos', 'valéis', 'valen'],
      presentSubjunctive: ['valga', 'valgas', 'valga', 'valgamos', 'valgáis', 'valgan'],
      future: ['valdré', 'valdrás', 'valdrá', 'valdremos', 'valdréis', 'valdrán'],
      conditional: ['valdría', 'valdrías', 'valdría', 'valdríamos', 'valdríais', 'valdrían'],
      presentYo: 'valgo', gerund: 'valiendo'
    },
    haber: {
      present: ['he', 'has', 'ha', 'hemos', 'habéis', 'han'],
      preterite: ['hube', 'hubiste', 'hubo', 'hubimos', 'hubisteis', 'hubieron'],
      imperfect: ['había', 'habías', 'había', 'habíamos', 'habíais', 'habían'],
      presentSubjunctive: ['haya', 'hayas', 'haya', 'hayamos', 'hayáis', 'hayan'],
      future: ['habré', 'habrás', 'habrá', 'habremos', 'habréis', 'habrán'],
      conditional: ['habría', 'habrías', 'habría', 'habríamos', 'habríais', 'habrían'],
      presentYo: 'he', participle: 'habido', gerund: 'habiendo'
    },
    hacer: {
      present: ['hago', 'haces', 'hace', 'hacemos', 'hacéis', 'hacen'],
      preterite: ['hice', 'hiciste', 'hizo', 'hicimos', 'hicisteis', 'hicieron'],
      presentSubjunctive: ['haga', 'hagas', 'haga', 'hagamos', 'hagáis', 'hagan'],
      future: ['haré', 'harás', 'hará', 'haremos', 'haréis', 'harán'],
      conditional: ['haría', 'harías', 'haría', 'haríamos', 'haríais', 'harían'],
      presentYo: 'hago', participle: 'hecho', gerund: 'haciendo'
    },
    decir: {
      present: ['digo', 'dices', 'dice', 'decimos', 'decís', 'dicen'],
      preterite: ['dije', 'dijiste', 'dijo', 'dijimos', 'dijisteis', 'dijeron'],
      presentSubjunctive: ['diga', 'digas', 'diga', 'digamos', 'digáis', 'digan'],
      future: ['diré', 'dirás', 'dirá', 'diremos', 'diréis', 'dirán'],
      conditional: ['diría', 'dirías', 'diría', 'diríamos', 'diríais', 'dirían'],
      presentYo: 'digo', participle: 'dicho', gerund: 'diciendo'
    },
    tener: {
      present: ['tengo', 'tienes', 'tiene', 'tenemos', 'tenéis', 'tienen'],
      preterite: ['tuve', 'tuviste', 'tuvo', 'tuvimos', 'tuvisteis', 'tuvieron'],
      presentSubjunctive: ['tenga', 'tengas', 'tenga', 'tengamos', 'tengáis', 'tengan'],
      future: ['tendré', 'tendrás', 'tendrá', 'tendremos', 'tendréis', 'tendrán'],
      conditional: ['tendría', 'tendrías', 'tendría', 'tendríamos', 'tendríais', 'tendrían'],
      presentYo: 'tengo', gerund: 'teniendo'
    },
    venir: {
      present: ['vengo', 'vienes', 'viene', 'venimos', 'venís', 'vienen'],
      preterite: ['vine', 'viniste', 'vino', 'vinimos', 'vinisteis', 'vinieron'],
      presentSubjunctive: ['venga', 'vengas', 'venga', 'vengamos', 'vengáis', 'vengan'],
      future: ['vendré', 'vendrás', 'vendrá', 'vendremos', 'vendréis', 'vendrán'],
      conditional: ['vendría', 'vendrías', 'vendría', 'vendríamos', 'vendríais', 'vendrían'],
      presentYo: 'vengo', gerund: 'viniendo'
    },
    poder: {
      present: ['puedo', 'puedes', 'puede', 'podemos', 'podéis', 'pueden'],
      preterite: ['pude', 'pudiste', 'pudo', 'pudimos', 'pudisteis', 'pudieron'],
      presentSubjunctive: ['pueda', 'puedas', 'pueda', 'podamos', 'podáis', 'puedan'],
      future: ['podré', 'podrás', 'podrá', 'podremos', 'podréis', 'podrán'],
      conditional: ['podría', 'podrías', 'podría', 'podríamos', 'podríais', 'podrían'],
      gerund: 'pudiendo'
    },
    querer: {
      present: ['quiero', 'quieres', 'quiere', 'queremos', 'queréis', 'quieren'],
      preterite: ['quise', 'quisiste', 'quiso', 'quisimos', 'quisisteis', 'quisieron'],
      presentSubjunctive: ['quiera', 'quieras', 'quiera', 'queramos', 'queráis', 'quieran'],
      future: ['querré', 'querrás', 'querrá', 'querremos', 'querréis', 'querrán'],
      conditional: ['querría', 'querrías', 'querría', 'querríamos', 'querríais', 'querrían'],
      gerund: 'queriendo'
    },
    poner: {
      present: ['pongo', 'pones', 'pone', 'ponemos', 'ponéis', 'ponen'],
      preterite: ['puse', 'pusiste', 'puso', 'pusimos', 'pusisteis', 'pusieron'],
      presentSubjunctive: ['ponga', 'pongas', 'ponga', 'pongamos', 'pongáis', 'pongan'],
      future: ['pondré', 'pondrás', 'pondrá', 'pondremos', 'pondréis', 'pondrán'],
      conditional: ['pondría', 'pondrías', 'pondría', 'pondríamos', 'pondríais', 'pondrían'],
      presentYo: 'pongo', participle: 'puesto', gerund: 'poniendo'
    },
    salir: {
      present: ['salgo', 'sales', 'sale', 'salimos', 'salís', 'salen'],
      presentSubjunctive: ['salga', 'salgas', 'salga', 'salgamos', 'salgáis', 'salgan'],
      future: ['saldré', 'saldrás', 'saldrá', 'saldremos', 'saldréis', 'saldrán'],
      conditional: ['saldría', 'saldrías', 'saldría', 'saldríamos', 'saldríais', 'saldrían'],
      presentYo: 'salgo', gerund: 'saliendo'
    },
    saber: {
      present: ['sé', 'sabes', 'sabe', 'sabemos', 'sabéis', 'saben'],
      preterite: ['supe', 'supiste', 'supo', 'supimos', 'supisteis', 'supieron'],
      presentSubjunctive: ['sepa', 'sepas', 'sepa', 'sepamos', 'sepáis', 'sepan'],
      future: ['sabré', 'sabrás', 'sabrá', 'sabremos', 'sabréis', 'sabrán'],
      conditional: ['sabría', 'sabrías', 'sabría', 'sabríamos', 'sabríais', 'sabrían'],
      presentYo: 'sé'
    },
    dar: {
      present: ['doy', 'das', 'da', 'damos', 'dais', 'dan'],
      preterite: ['di', 'diste', 'dio', 'dimos', 'disteis', 'dieron'],
      presentSubjunctive: ['dé', 'des', 'dé', 'demos', 'deis', 'den'],
      presentYo: 'doy'
    },
    ver: {
      present: ['veo', 'ves', 've', 'vemos', 'veis', 'ven'],
      preterite: ['vi', 'viste', 'vio', 'vimos', 'visteis', 'vieron'],
      imperfect: ['veía', 'veías', 'veía', 'veíamos', 'veíais', 'veían'],
      presentSubjunctive: ['vea', 'veas', 'vea', 'veamos', 'veáis', 'vean'],
      presentYo: 'veo', participle: 'visto', gerund: 'viendo'
    },
    contar: {
      present: ['cuento', 'cuentas', 'cuenta', 'contamos', 'contáis', 'cuentan'],
      presentSubjunctive: ['cuente', 'cuentes', 'cuente', 'contemos', 'contéis', 'cuenten'],
      presentYo: 'cuento'
    },
    sentar: {
      present: ['siento', 'sientas', 'sienta', 'sentamos', 'sentáis', 'sientan'],
      presentSubjunctive: ['siente', 'sientes', 'siente', 'sentemos', 'sentéis', 'sienten'],
      presentYo: 'siento'
    },
    pensar: {
      present: ['pienso', 'piensas', 'piensa', 'pensamos', 'pensáis', 'piensan'],
      presentSubjunctive: ['piense', 'pienses', 'piense', 'pensemos', 'penséis', 'piensen'],
      presentYo: 'pienso'
    },
    dormir: {
      present: ['duermo', 'duermes', 'duerme', 'dormimos', 'dormís', 'duermen'],
      preterite: ['dormí', 'dormiste', 'durmió', 'dormimos', 'dormisteis', 'durmieron'],
      presentSubjunctive: ['duerma', 'duermas', 'duerma', 'durmamos', 'durmáis', 'duerman'],
      presentYo: 'duermo', gerund: 'durmiendo'
    },
    pedir: {
      present: ['pido', 'pides', 'pide', 'pedimos', 'pedís', 'piden'],
      preterite: ['pedí', 'pediste', 'pidió', 'pedimos', 'pedisteis', 'pidieron'],
      presentSubjunctive: ['pida', 'pidas', 'pida', 'pidamos', 'pidáis', 'pidan'],
      presentYo: 'pido', gerund: 'pidiendo'
    },
    sentir: {
      present: ['siento', 'sientes', 'siente', 'sentimos', 'sentís', 'sienten'],
      preterite: ['sentí', 'sentiste', 'sintió', 'sentimos', 'sentisteis', 'sintieron'],
      presentSubjunctive: ['sienta', 'sientas', 'sienta', 'sintamos', 'sintáis', 'sientan'],
      presentYo: 'siento', gerund: 'sintiendo'
    },
    preferir: {
      present: ['prefiero', 'prefieres', 'prefiere', 'preferimos', 'preferís', 'prefieren'],
      preterite: ['preferí', 'preferiste', 'prefirió', 'preferimos', 'preferisteis', 'prefirieron'],
      presentSubjunctive: ['prefiera', 'prefieras', 'prefiera', 'prefiramos', 'prefiráis', 'prefieran'],
      presentYo: 'prefiero', gerund: 'prefiriendo'
    },
    volver: {
      present: ['vuelvo', 'vuelves', 'vuelve', 'volvemos', 'volvéis', 'vuelven'],
      presentSubjunctive: ['vuelva', 'vuelvas', 'vuelva', 'volvamos', 'volváis', 'vuelvan'],
      participle: 'vuelto', gerund: 'volviendo'
    },
    empezar: {
      present: ['empiezo', 'empiezas', 'empieza', 'empezamos', 'empezáis', 'empiezan'],
      preterite: ['empecé', 'empezaste', 'empezó', 'empezamos', 'empezasteis', 'empezaron'],
      presentSubjunctive: ['empiece', 'empieces', 'empiece', 'empecemos', 'empecéis', 'empiecen'],
      presentYo: 'empiezo'
    },
    encontrar: {
      present: ['encuentro', 'encuentras', 'encuentra', 'encontramos', 'encontráis', 'encuentran'],
      presentSubjunctive: ['encuentre', 'encuentres', 'encuentre', 'encontremos', 'encontréis', 'encuentren'],
      presentYo: 'encuentro'
    },
    despertar: {
      present: ['despierto', 'despiertas', 'despierta', 'despertamos', 'despertáis', 'despiertan'],
      presentSubjunctive: ['despierte', 'despiertes', 'despierte', 'despertemos', 'despertéis', 'despierten'],
      presentYo: 'despierto'
    },
    jugar: {
      present: ['juego', 'juegas', 'juega', 'jugamos', 'jugáis', 'juegan'],
      presentSubjunctive: ['juegue', 'juegues', 'juegue', 'juguemos', 'juguéis', 'jueguen'],
      presentYo: 'juego'
    },
    detener: {
      present: ['detengo', 'detienes', 'detiene', 'detenemos', 'detenéis', 'detienen'],
      preterite: ['detuve', 'detuviste', 'detuvo', 'detuvimos', 'detuvisteis', 'detuvieron'],
      presentSubjunctive: ['detenga', 'detengas', 'detenga', 'detengamos', 'detengáis', 'detengan'],
      future: ['detendré', 'detendrás', 'detendrá', 'detendremos', 'detendréis', 'detendrán'],
      conditional: ['detendría', 'detendrías', 'detendría', 'detendríamos', 'detendríais', 'detendrían'],
      presentYo: 'detengo', gerund: 'deteniendo'
    },
    conocer: {
      present: ['conozco', 'conoces', 'conoce', 'conocemos', 'conocéis', 'conocen'],
      presentSubjunctive: ['conozca', 'conozcas', 'conozca', 'conozcamos', 'conozcáis', 'conozcan'],
      presentYo: 'conozco'
    },
    parecer: {
      present: ['parezco', 'pareces', 'parece', 'parecemos', 'parecéis', 'parecen'],
      presentSubjunctive: ['parezca', 'parezcas', 'parezca', 'parezcamos', 'parezcáis', 'parezcan'],
      presentYo: 'parezco'
    },
    desvanecer: {
      present: ['desvanezco', 'desvaneces', 'desvanece', 'desvanecemos', 'desvanecéis', 'desvanecen'],
      presentSubjunctive: ['desvanezca', 'desvanezcas', 'desvanezca', 'desvanezcamos', 'desvanezcáis', 'desvanezcan'],
      presentYo: 'desvanezco'
    },
    llegar: {
      preterite: ['llegué', 'llegaste', 'llegó', 'llegamos', 'llegasteis', 'llegaron'],
      presentSubjunctive: ['llegue', 'llegues', 'llegue', 'lleguemos', 'lleguéis', 'lleguen']
    },
    buscar: {
      preterite: ['busqué', 'buscaste', 'buscó', 'buscamos', 'buscasteis', 'buscaron'],
      presentSubjunctive: ['busque', 'busques', 'busque', 'busquemos', 'busquéis', 'busquen']
    },
    pagar: {
      preterite: ['pagué', 'pagaste', 'pagó', 'pagamos', 'pagasteis', 'pagaron'],
      presentSubjunctive: ['pague', 'pagues', 'pague', 'paguemos', 'paguéis', 'paguen']
    },
    leer: {
      preterite: ['leí', 'leíste', 'leyó', 'leímos', 'leísteis', 'leyeron'],
      presentSubjunctive: ['lea', 'leas', 'lea', 'leamos', 'leáis', 'lean'],
      participle: 'leído', gerund: 'leyendo'
    },
    creer: {
      preterite: ['creí', 'creíste', 'creyó', 'creímos', 'creísteis', 'creyeron'],
      participle: 'creído', gerund: 'creyendo'
    },
    caer: {
      present: ['caigo', 'caes', 'cae', 'caemos', 'caéis', 'caen'],
      preterite: ['caí', 'caíste', 'cayó', 'caímos', 'caísteis', 'cayeron'],
      presentSubjunctive: ['caiga', 'caigas', 'caiga', 'caigamos', 'caigáis', 'caigan'],
      presentYo: 'caigo', participle: 'caído', gerund: 'cayendo'
    },
    traer: {
      present: ['traigo', 'traes', 'trae', 'traemos', 'traéis', 'traen'],
      preterite: ['traje', 'trajiste', 'trajo', 'trajimos', 'trajisteis', 'trajeron'],
      presentSubjunctive: ['traiga', 'traigas', 'traiga', 'traigamos', 'traigáis', 'traigan'],
      presentYo: 'traigo', participle: 'traído', gerund: 'trayendo'
    },
    conducir: {
      present: ['conduzco', 'conduces', 'conduce', 'conducimos', 'conducís', 'conducen'],
      preterite: ['conduje', 'condujiste', 'condujo', 'condujimos', 'condujisteis', 'condujeron'],
      presentSubjunctive: ['conduzca', 'conduzcas', 'conduzca', 'conduzcamos', 'conduzcáis', 'conduzcan'],
      presentYo: 'conduzco', gerund: 'conduciendo'
    },
    traducir: {
      present: ['traduzco', 'traduces', 'traduce', 'traducimos', 'traducís', 'traducen'],
      preterite: ['traduje', 'tradujiste', 'tradujo', 'tradujimos', 'tradujisteis', 'tradujeron'],
      presentSubjunctive: ['traduzca', 'traduzcas', 'traduzca', 'traduzcamos', 'traduzcáis', 'traduzcan'],
      presentYo: 'traduzco', gerund: 'traduciendo'
    },
    producir: {
      present: ['produzco', 'produces', 'produce', 'producimos', 'producís', 'producen'],
      preterite: ['produje', 'produjiste', 'produjo', 'produjimos', 'produjisteis', 'produjeron'],
      presentSubjunctive: ['produzca', 'produzcas', 'produzca', 'produzcamos', 'produzcáis', 'produzcan'],
      presentYo: 'produzco', gerund: 'produciendo'
    },
    oír: {
      present: ['oigo', 'oyes', 'oye', 'oímos', 'oís', 'oyen'],
      preterite: ['oí', 'oíste', 'oyó', 'oímos', 'oísteis', 'oyeron'],
      presentSubjunctive: ['oiga', 'oigas', 'oiga', 'oigamos', 'oigáis', 'oigan'],
      future: ['oiré', 'oirás', 'oirá', 'oiremos', 'oiréis', 'oirán'],
      conditional: ['oiría', 'oirías', 'oiría', 'oiríamos', 'oiríais', 'oirían'],
      presentYo: 'oigo', participle: 'oído', gerund: 'oyendo'
    },
    seguir: {
      present: ['sigo', 'sigues', 'sigue', 'seguimos', 'seguís', 'siguen'],
      preterite: ['seguí', 'seguiste', 'siguió', 'seguimos', 'seguisteis', 'siguieron'],
      presentSubjunctive: ['siga', 'sigas', 'siga', 'sigamos', 'sigáis', 'sigan'],
      presentYo: 'sigo', gerund: 'siguiendo'
    },
    repetir: {
      present: ['repito', 'repites', 'repite', 'repetimos', 'repetís', 'repiten'],
      preterite: ['repetí', 'repetiste', 'repitió', 'repetimos', 'repetisteis', 'repitieron'],
      presentSubjunctive: ['repita', 'repitas', 'repita', 'repitamos', 'repitáis', 'repitan'],
      presentYo: 'repito', gerund: 'repitiendo'
    },
    construir: {
      present: ['construyo', 'construyes', 'construye', 'construimos', 'construís', 'construyen'],
      preterite: ['construí', 'construiste', 'construyó', 'construimos', 'construisteis', 'construyeron'],
      presentSubjunctive: ['construya', 'construyas', 'construya', 'construyamos', 'construyáis', 'construyan'],
      gerund: 'construyendo'
    },
    abrir: { participle: 'abierto' },
    cubrir: { participle: 'cubierto' },
    escribir: { participle: 'escrito' },
    morir: {
      present: ['muero', 'mueres', 'muere', 'morimos', 'morís', 'mueren'],
      preterite: ['morí', 'moriste', 'murió', 'morimos', 'moristeis', 'murieron'],
      presentSubjunctive: ['muera', 'mueras', 'muera', 'muramos', 'muráis', 'mueran'],
      participle: 'muerto', gerund: 'muriendo'
    },
    romper: { participle: 'roto' },
    satisfacer: { participle: 'satisfecho' }
  };

  // These forms have a regular paradigm but an irregular participle or spelling.
  const extraOverrides = {
    hablar: {},
    hornear: {},
    lavar: {},
    actuar: {
      present: ['actúo', 'actúas', 'actúa', 'actuamos', 'actuáis', 'actúan'],
      presentSubjunctive: ['actúe', 'actúes', 'actúe', 'actuemos', 'actuéis', 'actúen'],
      presentYo: 'actúo'
    },
    continuar: {
      present: ['continúo', 'continúas', 'continúa', 'continuamos', 'continuáis', 'continúan'],
      presentSubjunctive: ['continúe', 'continúes', 'continúe', 'continuemos', 'continuéis', 'continúen'],
      presentYo: 'continúo'
    },
    reír: {
      present: ['río', 'ríes', 'ríe', 'reímos', 'reís', 'ríen'],
      preterite: ['reí', 'reíste', 'rió', 'reímos', 'reísteis', 'rieron'],
      presentSubjunctive: ['ría', 'rías', 'ría', 'riamos', 'riáis', 'rían'],
      future: ['reiré', 'reirás', 'reirá', 'reiremos', 'reiréis', 'reirán'],
      conditional: ['reiría', 'reirías', 'reiría', 'reiríamos', 'reiríais', 'reirían'],
      presentYo: 'río', participle: 'reído', gerund: 'riendo'
    },
    sonreír: {
      present: ['sonrío', 'sonríes', 'sonríe', 'sonreímos', 'sonreís', 'sonríen'],
      preterite: ['sonreí', 'sonreíste', 'sonrió', 'sonreímos', 'sonreísteis', 'sonrieron'],
      presentSubjunctive: ['sonría', 'sonrías', 'sonría', 'sonriamos', 'sonriáis', 'sonrían'],
      future: ['sonreiré', 'sonreirás', 'sonreirá', 'sonreiremos', 'sonreiréis', 'sonreirán'],
      conditional: ['sonreiría', 'sonreirías', 'sonreiría', 'sonreiríamos', 'sonreiríais', 'sonreirían'],
      presentYo: 'sonrío', participle: 'sonreído', gerund: 'sonriendo'
    },
    freír: {
      present: ['frío', 'fríes', 'fríe', 'freímos', 'freís', 'fríen'],
      preterite: ['freí', 'freíste', 'frió', 'freímos', 'freísteis', 'frieron'],
      presentSubjunctive: ['fría', 'frías', 'fría', 'friamos', 'friáis', 'frían'],
      future: ['freiré', 'freirás', 'freirá', 'freiremos', 'freiréis', 'freirán'],
      conditional: ['freiría', 'freirías', 'freiría', 'freiríamos', 'freiríais', 'freirían'],
      presentYo: 'frío', participle: 'frito', gerund: 'friendo'
    },
    vestir: {
      present: ['visto', 'vistes', 'viste', 'vestimos', 'vestís', 'visten'],
      presentSubjunctive: ['vista', 'vistas', 'vista', 'vistamos', 'vistáis', 'vistan'],
      presentYo: 'visto', participle: 'vestido', gerund: 'vistiendo'
    },
    acostar: {
      present: ['acuesto', 'acuestas', 'acuesta', 'acostamos', 'acostáis', 'acuestan'],
      presentSubjunctive: ['acueste', 'acuestes', 'acueste', 'acostemos', 'acostéis', 'acuesten'],
      presentYo: 'acuesto'
    },
    mostrar: {
      present: ['muestro', 'muestras', 'muestra', 'mostramos', 'mostráis', 'muestran'],
      presentSubjunctive: ['muestre', 'muestres', 'muestre', 'mostremos', 'mostréis', 'muestren'],
      presentYo: 'muestro'
    },
    probar: {
      present: ['pruebo', 'pruebas', 'prueba', 'probamos', 'probáis', 'prueban'],
      presentSubjunctive: ['pruebe', 'pruebes', 'pruebe', 'probemos', 'probéis', 'prueben'],
      presentYo: 'pruebo'
    },
    cerrar: {
      present: ['cierro', 'cierras', 'cierra', 'cerramos', 'cerráis', 'cierran'],
      presentSubjunctive: ['cierre', 'cierres', 'cierre', 'cerremos', 'cerréis', 'cierren'],
      presentYo: 'cierro'
    },
    perder: {
      present: ['pierdo', 'pierdes', 'pierde', 'perdemos', 'perdéis', 'pierden'],
      presentSubjunctive: ['pierda', 'pierdas', 'pierda', 'perdamos', 'perdáis', 'pierdan'],
      presentYo: 'pierdo'
    },
    entender: {
      present: ['entiendo', 'entiendes', 'entiende', 'entendemos', 'entendéis', 'entienden'],
      presentSubjunctive: ['entienda', 'entiendas', 'entienda', 'entendamos', 'entendáis', 'entiendan'],
      presentYo: 'entiendo'
    },
    recordar: {
      present: ['recuerdo', 'recuerdas', 'recuerda', 'recordamos', 'recordáis', 'recuerdan'],
      presentSubjunctive: ['recuerde', 'recuerdes', 'recuerde', 'recordemos', 'recordéis', 'recuerden'],
      presentYo: 'recuerdo'
    },
    mover: {
      present: ['muevo', 'mueves', 'mueve', 'movemos', 'movéis', 'mueven'],
      presentSubjunctive: ['mueva', 'muevas', 'mueva', 'movamos', 'mováis', 'muevan'],
      presentYo: 'muevo'
    },
    servir: {
      present: ['sirvo', 'sirves', 'sirve', 'servimos', 'servís', 'sirven'],
      preterite: ['serví', 'serviste', 'sirvió', 'servimos', 'servisteis', 'sirvieron'],
      presentSubjunctive: ['sirva', 'sirvas', 'sirva', 'sirvamos', 'sirváis', 'sirvan'],
      presentYo: 'sirvo', gerund: 'sirviendo'
    },
    medir: {
      present: ['mido', 'mides', 'mide', 'medimos', 'medís', 'miden'],
      preterite: ['medí', 'mediste', 'midió', 'medimos', 'medisteis', 'midieron'],
      presentSubjunctive: ['mida', 'midas', 'mida', 'midamos', 'midáis', 'midan'],
      presentYo: 'mido'
    },
    elegir: {
      present: ['elijo', 'eliges', 'elige', 'elegimos', 'elegís', 'eligen'],
      preterite: ['elegí', 'elegiste', 'eligió', 'elegimos', 'elegisteis', 'eligieron'],
      presentSubjunctive: ['elija', 'elijas', 'elija', 'elijamos', 'elijáis', 'elijan'],
      presentYo: 'elijo'
    },
    comenzar: {
      present: ['comienzo', 'comienzas', 'comienza', 'comenzamos', 'comenzáis', 'comienzan'],
      preterite: ['comencé', 'comenzaste', 'comenzó', 'comenzamos', 'comenzasteis', 'comenzaron'],
      presentSubjunctive: ['comience', 'comiences', 'comience', 'comencemos', 'comencéis', 'comiencen'],
      presentYo: 'comienzo'
    }
  };

  /* Verbs that were in the memory without their real forms. Each of these was
   * silently conjugated with the regular pattern before, which produced forms
   * that do not exist (manteno, creco, volo, envio…). They are corrected here. */
  const correctedOverrides = {
    atravesar: {
      present: ['atravieso', 'atraviesas', 'atraviesa', 'atravesamos', 'atravesáis', 'atraviesan'],
      presentSubjunctive: ['atraviese', 'atravieses', 'atraviese', 'atravesemos', 'atraveséis', 'atraviesen'],
      presentYo: 'atravieso'
    },
    calentar: {
      present: ['caliento', 'calientas', 'calienta', 'calentamos', 'calentáis', 'calientan'],
      presentSubjunctive: ['caliente', 'calientes', 'caliente', 'calentemos', 'calentéis', 'calienten'],
      presentYo: 'caliento'
    },
    coger: {
      present: ['cojo', 'coges', 'coge', 'cogemos', 'cogéis', 'cogen'],
      presentSubjunctive: ['coja', 'cojas', 'coja', 'cojamos', 'cojáis', 'cojan'],
      presentYo: 'cojo'
    },
    conseguir: {
      present: ['consigo', 'consigues', 'consigue', 'conseguimos', 'conseguís', 'consiguen'],
      preterite: ['conseguí', 'conseguiste', 'consiguió', 'conseguimos', 'conseguisteis', 'consiguieron'],
      presentSubjunctive: ['consiga', 'consigas', 'consiga', 'consigamos', 'consigáis', 'consigan'],
      presentYo: 'consigo'
    },
    descubrir: { participle: 'descubierto' },
    devolver: {
      present: ['devuelvo', 'devuelves', 'devuelve', 'devolvemos', 'devolvéis', 'devuelven'],
      presentSubjunctive: ['devuelva', 'devuelvas', 'devuelva', 'devolvamos', 'devolváis', 'devuelvan'],
      presentYo: 'devuelvo', participle: 'devuelto'
    },
    divertir: {
      present: ['divierto', 'diviertes', 'divierte', 'divertimos', 'divertís', 'divierten'],
      preterite: ['divertí', 'divertiste', 'divirtió', 'divertimos', 'divertisteis', 'divirtieron'],
      presentSubjunctive: ['divierta', 'diviertas', 'divierta', 'divirtamos', 'divirtáis', 'diviertan'],
      presentYo: 'divierto'
    },
    crecer: {
      present: ['crezco', 'creces', 'crece', 'crecemos', 'crecéis', 'crecen'],
      presentSubjunctive: ['crezca', 'crezcas', 'crezca', 'crezcamos', 'crezcáis', 'crezcan'],
      presentYo: 'crezco'
    },
    dirigir: {
      present: ['dirijo', 'diriges', 'dirige', 'dirigimos', 'dirigís', 'dirigen'],
      presentSubjunctive: ['dirija', 'dirijas', 'dirija', 'dirijamos', 'dirijáis', 'dirijan'],
      presentYo: 'dirijo'
    },
    enviar: {
      present: ['envío', 'envías', 'envía', 'enviamos', 'enviáis', 'envían'],
      presentSubjunctive: ['envíe', 'envíes', 'envíe', 'enviemos', 'enviéis', 'envíen'],
      presentYo: 'envío'
    },
    mantener: {
      present: ['mantengo', 'mantienes', 'mantiene', 'mantenemos', 'mantenéis', 'mantienen'],
      preterite: ['mantuve', 'mantuviste', 'mantuvo', 'mantuvimos', 'mantuvisteis', 'mantuvieron'],
      presentSubjunctive: ['mantenga', 'mantengas', 'mantenga', 'mantengamos', 'mantengáis', 'mantengan'],
      future: ['mantendré', 'mantendrás', 'mantendrá', 'mantendremos', 'mantendréis', 'mantendrán'],
      conditional: ['mantendría', 'mantendrías', 'mantendría', 'mantendríamos', 'mantendríais', 'mantendrían'],
      presentYo: 'mantengo', gerund: 'manteniendo'
    },
    merecer: {
      present: ['merezco', 'mereces', 'merece', 'merecemos', 'merecéis', 'merecen'],
      presentSubjunctive: ['merezca', 'merezcas', 'merezca', 'merezcamos', 'merezcáis', 'merezcan'],
      presentYo: 'merezco'
    },
    nacer: {
      present: ['nazco', 'naces', 'nace', 'nacemos', 'nacéis', 'nacen'],
      presentSubjunctive: ['nazca', 'nazcas', 'nazca', 'nazcamos', 'nazcáis', 'nazcan'],
      presentYo: 'nazco'
    },
    ofrecer: {
      present: ['ofrezco', 'ofreces', 'ofrece', 'ofrecemos', 'ofrecéis', 'ofrecen'],
      presentSubjunctive: ['ofrezca', 'ofrezcas', 'ofrezca', 'ofrezcamos', 'ofrezcáis', 'ofrezcan'],
      presentYo: 'ofrezco'
    },
    permanecer: {
      present: ['permanezco', 'permaneces', 'permanece', 'permanecemos', 'permanecéis', 'permanecen'],
      presentSubjunctive: ['permanezca', 'permanezcas', 'permanezca', 'permanezcamos', 'permanezcáis', 'permanezcan'],
      presentYo: 'permanezco'
    },
    proteger: {
      present: ['protejo', 'proteges', 'protege', 'protegemos', 'protegéis', 'protegen'],
      presentSubjunctive: ['proteja', 'protejas', 'proteja', 'protejamos', 'protejáis', 'protejan'],
      presentYo: 'protejo'
    },
    reunir: {
      present: ['reúno', 'reúnes', 'reúne', 'reunimos', 'reunís', 'reúnen'],
      presentSubjunctive: ['reúna', 'reúnas', 'reúna', 'reunamos', 'reunáis', 'reúnan'],
      presentYo: 'reúno'
    },
    resolver: {
      present: ['resuelvo', 'resuelves', 'resuelve', 'resolvemos', 'resolvéis', 'resuelven'],
      presentSubjunctive: ['resuelva', 'resuelvas', 'resuelva', 'resolvamos', 'resolváis', 'resuelvan'],
      presentYo: 'resuelvo', participle: 'resuelto'
    },
    satisfacer: {
      present: ['satisfago', 'satisfaces', 'satisface', 'satisfacemos', 'satisfacéis', 'satisfacen'],
      preterite: ['satisfice', 'satisficiste', 'satisfizo', 'satisficimos', 'satisficisteis', 'satisficieron'],
      presentSubjunctive: ['satisfaga', 'satisfagas', 'satisfaga', 'satisfagamos', 'satisfagáis', 'satisfagan'],
      future: ['satisfaré', 'satisfarás', 'satisfará', 'satisfaremos', 'satisfaréis', 'satisfarán'],
      conditional: ['satisfaría', 'satisfarías', 'satisfaría', 'satisfaríamos', 'satisfaríais', 'satisfarían'],
      presentYo: 'satisfago', participle: 'satisfecho'
    },
    soñar: {
      present: ['sueño', 'sueñas', 'sueña', 'soñamos', 'soñáis', 'sueñan'],
      presentSubjunctive: ['sueñe', 'sueñes', 'sueñe', 'soñemos', 'soñéis', 'sueñen'],
      presentYo: 'sueño'
    },
    vencer: {
      present: ['venzo', 'vences', 'vence', 'vencemos', 'vencéis', 'vencen'],
      presentSubjunctive: ['venza', 'venzas', 'venza', 'venzamos', 'venzáis', 'venzan'],
      presentYo: 'venzo'
    },
    volar: {
      present: ['vuelo', 'vuelas', 'vuela', 'volamos', 'voláis', 'vuelan'],
      presentSubjunctive: ['vuele', 'vueles', 'vuele', 'volemos', 'voléis', 'vuelen'],
      presentYo: 'vuelo'
    },
    vestir: {
      present: ['visto', 'vistes', 'viste', 'vestimos', 'vestís', 'visten'],
      preterite: ['vestí', 'vestiste', 'vistió', 'vestimos', 'vestisteis', 'vistieron'],
      presentSubjunctive: ['vista', 'vistas', 'vista', 'vistamos', 'vistáis', 'vistan'],
      presentYo: 'visto', participle: 'vestido', gerund: 'vistiendo'
    }
  };

  /* Extra verbs added to the memory so more saved expressions match a verb. */
  const moreVerbs = `
    abrazar alcanzar alquilar animar anunciar apagar apoyar arrastrar asustar atacar avisar besar brillar bromear
    cargar cenar charlar chocar citar colocar comentar congelar conversar copiar crear cruzar dañar dedicar decorar
    desarrollar desordenar dudar echar educar empujar encantar enfermar enfriar enojar ensayar entrenar escapar evitar
    examinar extrañar fabricar fallar felicitar funcionar garantizar girar gritar heredar hospedar humillar hundir
    identificar ignorar importar impresionar inscribir insistir inspirar instalar insultar interpretar interrumpir
    investigar juzgar lastimar lanzar latir liberar limitar molestar montar negociar nombrar observar ocupar odiar optar
    organizar pasear pegar peinar pelear percibir pescar picar pintar planear plantar platicar preparar prestar
    pronunciar provocar quemar quejar quitar rascar rayar realizar regalar registrar relajar rellenar remar rentar
    respirar resultar rescatar retirar retratar revisar rezar rodear roncar ruborizar sacudir saludar sanar sangrar
    separar sobrar solicitar soplar soportar subrayar sumar suspirar susurrar tachar tapar tardar telefonear tragar
    traicionar tranquilizar transportar tratar trepar triunfar ubicar untar velar vendar vengar ventilar verificar
    vigilar vomitar zarpar
    barrer coser esconder poseer tejer toser
    admitir confundir contribuir destruir distribuir existir huir imprimir influir omitir perseguir prohibir resistir
    sustituir transmitir unir
    acordar adquirir advertir almorzar apostar aprobar atender componer consentir contener convertir corregir costar
    defender demostrar despedir descender disponer entretener exponer extender fingir forzar hervir impedir
    intervenir invertir mentir morder obedecer oscurecer obtener oler padecer posponer prevenir proponer proveer
    reconocer reducir rendir regar negar reunir rodar soler soltar sugerir sostener suponer tender
    variar vaciar verter
  `.trim().split(/\s+/);

  const moreOverrides = {
    oler: {
      present: ['huelo', 'hueles', 'huele', 'olemos', 'oléis', 'huelen'],
      presentSubjunctive: ['huela', 'huelas', 'huela', 'olamos', 'oláis', 'huelan'],
      presentYo: 'huelo'
    },
    soler: {
      present: ['suelo', 'sueles', 'suele', 'solemos', 'soléis', 'suelen'],
      presentSubjunctive: ['suela', 'suelas', 'suela', 'solamos', 'soláis', 'suelan'],
      presentYo: 'suelo'
    },
    costar: {
      present: ['cuesto', 'cuestas', 'cuesta', 'costamos', 'costáis', 'cuestan'],
      presentSubjunctive: ['cueste', 'cuestes', 'cueste', 'costemos', 'costéis', 'cuesten'],
      presentYo: 'cuesto'
    },
    aprobar: {
      present: ['apruebo', 'apruebas', 'aprueba', 'aprobamos', 'aprobáis', 'aprueban'],
      presentSubjunctive: ['apruebe', 'apruebes', 'apruebe', 'aprobemos', 'aprobéis', 'aprueben'],
      presentYo: 'apruebo'
    },
    demostrar: {
      present: ['demuestro', 'demuestras', 'demuestra', 'demostramos', 'demostráis', 'demuestran'],
      presentSubjunctive: ['demuestre', 'demuestres', 'demuestre', 'demostramos', 'demostréis', 'demuestren'],
      presentYo: 'demuestro'
    },
    acordar: {
      present: ['acuerdo', 'acuerdas', 'acuerda', 'acordamos', 'acordáis', 'acuerdan'],
      presentSubjunctive: ['acuerde', 'acuerdes', 'acuerde', 'acordemos', 'acordéis', 'acuerden'],
      presentYo: 'acuerdo'
    },
    almorzar: {
      present: ['almuerzo', 'almuerzas', 'almuerza', 'almorzamos', 'almorzáis', 'almuerzan'],
      presentSubjunctive: ['almuerce', 'almuerces', 'almuerce', 'almorcemos', 'almorcéis', 'almuercen'],
      presentYo: 'almuerzo'
    },
    apostar: {
      present: ['apuesto', 'apuestas', 'apuesta', 'apostamos', 'apostáis', 'apuestan'],
      presentSubjunctive: ['apueste', 'apuestes', 'apueste', 'apostemos', 'apostéis', 'apuesten'],
      presentYo: 'apuesto'
    },
    forzar: {
      present: ['fuerzo', 'fuerzas', 'fuerza', 'forzamos', 'forzáis', 'fuerzan'],
      presentSubjunctive: ['fuerce', 'fuerces', 'fuerce', 'forcemos', 'forcéis', 'fuerce'],
      presentYo: 'fuerzo'
    },
    rodar: {
      present: ['ruedo', 'ruedas', 'rueda', 'rodamos', 'rodáis', 'ruedan'],
      presentSubjunctive: ['ruede', 'ruedes', 'ruede', 'rodemos', 'rodéis', 'rueden'],
      presentYo: 'ruedo'
    },
    soltar: {
      present: ['suelto', 'sueltas', 'suelta', 'soltamos', 'soltáis', 'sueltan'],
      presentSubjunctive: ['suelte', 'sueltes', 'suelte', 'soltemos', 'soltéis', 'suelten'],
      presentYo: 'suelto'
    },
    morder: {
      present: ['muerdo', 'muerdes', 'muerde', 'mordemos', 'mordéis', 'muerden'],
      presentSubjunctive: ['muerda', 'muerdas', 'muerda', 'mordamos', 'mordáis', 'muerdan'],
      presentYo: 'muerdo'
    },
    atender: {
      present: ['atiendo', 'atiendes', 'atiende', 'atendemos', 'atendéis', 'atienden'],
      presentSubjunctive: ['atienda', 'atiendas', 'atienda', 'atendamos', 'atendáis', 'atiendan'],
      presentYo: 'atiendo'
    },
    defender: {
      present: ['defiendo', 'defiendes', 'defiende', 'defendemos', 'defendéis', 'defienden'],
      presentSubjunctive: ['defienda', 'defiendas', 'defienda', 'defendamos', 'defendáis', 'defiendan'],
      presentYo: 'defiendo'
    },
    encender: {
      present: ['enciendo', 'enciendes', 'enciende', 'encendemos', 'encendéis', 'encienden'],
      presentSubjunctive: ['encienda', 'enciendas', 'encienda', 'encendamos', 'encendáis', 'enciendan'],
      presentYo: 'enciendo'
    },
    descender: {
      present: ['desciendo', 'desciendes', 'desciende', 'descendemos', 'descendéis', 'descienden'],
      presentSubjunctive: ['descienda', 'desciendas', 'descienda', 'descendamos', 'descendáis', 'desciendan'],
      presentYo: 'desciendo'
    },
    extender: {
      present: ['extiendo', 'extiendes', 'extiende', 'extendemos', 'extendéis', 'extienden'],
      presentSubjunctive: ['extienda', 'extiendas', 'extienda', 'extendamos', 'extendáis', 'extiendan'],
      presentYo: 'extiendo'
    },
    tender: {
      present: ['tiendo', 'tiendes', 'tiende', 'tendemos', 'tendéis', 'tienden'],
      presentSubjunctive: ['tienda', 'tiendas', 'tienda', 'tendamos', 'tendáis', 'tiendan'],
      presentYo: 'tiendo'
    },
    verter: {
      present: ['vierto', 'viertes', 'vierte', 'vertemos', 'vertéis', 'vierten'],
      presentSubjunctive: ['vierta', 'viertas', 'vierta', 'vertamos', 'vertáis', 'viertan'],
      presentYo: 'vierto'
    },
    negar: {
      present: ['niego', 'niegas', 'niega', 'negamos', 'negáis', 'niegan'],
      presentSubjunctive: ['niegue', 'niegues', 'niegue', 'neguemos', 'neguéis', 'nieguen'],
      presentYo: 'niego'
    },
    regar: {
      present: ['riego', 'riegas', 'riega', 'regamos', 'regáis', 'riegan'],
      presentSubjunctive: ['riegue', 'riegues', 'riegue', 'reguemos', 'reguéis', 'rieguen'],
      presentYo: 'riego'
    },
    mentir: {
      present: ['miento', 'mientes', 'miente', 'mentimos', 'mentís', 'mienten'],
      preterite: ['mentí', 'mentiste', 'mintió', 'mentimos', 'mentisteis', 'mintieron'],
      presentSubjunctive: ['mienta', 'mientas', 'mienta', 'mintamos', 'mintáis', 'mientan'],
      presentYo: 'miento'
    },
    sugerir: {
      present: ['sugiero', 'sugieres', 'sugiere', 'sugerimos', 'sugerís', 'sugieren'],
      preterite: ['sugerí', 'sugeriste', 'sugirió', 'sugerimos', 'sugeristeis', 'sugirieron'],
      presentSubjunctive: ['sugiera', 'sugieras', 'sugiera', 'sugiramos', 'sugiráis', 'sugieran'],
      presentYo: 'sugiero'
    },
    herir: {
      present: ['hiero', 'hieres', 'hiere', 'herimos', 'herís', 'hieren'],
      preterite: ['herí', 'heriste', 'hirió', 'herimos', 'heristeis', 'hirieron'],
      presentSubjunctive: ['hiera', 'hieras', 'hiera', 'hiramos', 'hiráis', 'hieran'],
      presentYo: 'hiero'
    },
    advertir: {
      present: ['advierto', 'adviertes', 'advierte', 'advertimos', 'advertís', 'advierten'],
      preterite: ['advertí', 'advertiste', 'advirtió', 'advertimos', 'advertisteis', 'advirtieron'],
      presentSubjunctive: ['advierta', 'adviertas', 'advierta', 'advirtamos', 'advirtáis', 'adviertan'],
      presentYo: 'advierto'
    },
    convertir: {
      present: ['convierto', 'conviertes', 'convierte', 'convertimos', 'convertís', 'convierten'],
      preterite: ['convertí', 'convertiste', 'convirtió', 'convertimos', 'convertisteis', 'convirtieron'],
      presentSubjunctive: ['convierta', 'conviertas', 'convierta', 'convirtamos', 'convirtáis', 'conviertan'],
      presentYo: 'convierto'
    },
    invertir: {
      present: ['invierto', 'inviertes', 'invierte', 'invertimos', 'invertís', 'invierten'],
      preterite: ['invertí', 'invertiste', 'invirtió', 'invertimos', 'invertisteis', 'invirtieron'],
      presentSubjunctive: ['invierta', 'inviertas', 'invierta', 'invirtamos', 'invirtáis', 'inviertan'],
      presentYo: 'invierto'
    },
    consentir: {
      present: ['consiento', 'consientes', 'consiente', 'consentimos', 'consentís', 'consienten'],
      preterite: ['consentí', 'consentiste', 'consintió', 'consentimos', 'consentisteis', 'consintieron'],
      presentSubjunctive: ['consienta', 'consientas', 'consienta', 'consintamos', 'consintáis', 'consientan'],
      presentYo: 'consiento'
    },
    rendir: {
      present: ['rindo', 'rindes', 'rinde', 'rendimos', 'rendís', 'rinden'],
      preterite: ['rendí', 'rendiste', 'rindió', 'rendimos', 'rendisteis', 'rindieron'],
      presentSubjunctive: ['rinda', 'rindas', 'rinda', 'rindamos', 'rindáis', 'rindan'],
      presentYo: 'rindo'
    },
    despedir: {
      present: ['despido', 'despides', 'despide', 'despedimos', 'despedís', 'despiden'],
      preterite: ['despedí', 'despediste', 'despidió', 'despedimos', 'despedisteis', 'despidieron'],
      presentSubjunctive: ['despida', 'despidas', 'despida', 'despidamos', 'despidáis', 'despidan'],
      presentYo: 'despido'
    },
    impedir: {
      present: ['impido', 'impides', 'impide', 'impedimos', 'impedís', 'impiden'],
      preterite: ['impedí', 'impediste', 'impidió', 'impedimos', 'impedisteis', 'impidieron'],
      presentSubjunctive: ['impida', 'impidas', 'impida', 'impidamos', 'impidáis', 'impidan'],
      presentYo: 'impido'
    },
    competir: {
      present: ['compito', 'compites', 'compite', 'competimos', 'competís', 'compiten'],
      preterite: ['competí', 'competiste', 'compitió', 'competimos', 'competisteis', 'compitieron'],
      presentSubjunctive: ['compita', 'compitas', 'compita', 'compitamos', 'compitáis', 'compitan'],
      presentYo: 'compito'
    },
    corregir: {
      present: ['corrijo', 'corriges', 'corrige', 'corregimos', 'corregís', 'corrigen'],
      preterite: ['corregí', 'corregiste', 'corrigió', 'corregimos', 'corregisteis', 'corrigieron'],
      presentSubjunctive: ['corrija', 'corrijas', 'corrija', 'corrijamos', 'corrijáis', 'corrijan'],
      presentYo: 'corrijo'
    },
    exigir: {
      present: ['exijo', 'exiges', 'exige', 'exigimos', 'exigís', 'exigen'],
      presentSubjunctive: ['exija', 'exijas', 'exija', 'exijamos', 'exijáis', 'exijan'],
      presentYo: 'exijo'
    },
    fingir: {
      present: ['finjo', 'finges', 'finge', 'fingimos', 'fingís', 'fingen'],
      presentSubjunctive: ['finja', 'finjas', 'finja', 'finjamos', 'finjáis', 'finjan'],
      presentYo: 'finjo'
    },
    escoger: {
      present: ['escojo', 'escoges', 'escoge', 'escogemos', 'escogéis', 'escogen'],
      presentSubjunctive: ['escoja', 'escojas', 'escoja', 'escojamos', 'escojáis', 'escojan'],
      presentYo: 'escojo'
    },
    obedecer: {
      present: ['obedezco', 'obedeces', 'obedece', 'obedecemos', 'obedecéis', 'obedecen'],
      presentSubjunctive: ['obedezca', 'obedezcas', 'obedezca', 'obedezcamos', 'obedezcáis', 'obedezcan'],
      presentYo: 'obedezco'
    },
    oscurecer: {
      present: ['oscurezco', 'oscureces', 'oscurece', 'oscurecemos', 'oscurecéis', 'oscurecen'],
      presentSubjunctive: ['oscurezca', 'oscurezcas', 'oscurezca', 'oscurezcamos', 'oscurezcáis', 'oscurezcan'],
      presentYo: 'oscurezco'
    },
    padecer: {
      present: ['padezco', 'padeces', 'padece', 'padecemos', 'padecéis', 'padecen'],
      presentSubjunctive: ['padezca', 'padezcas', 'padezca', 'padezcamos', 'padezcáis', 'padezcan'],
      presentYo: 'padezco'
    },
    reconocer: {
      present: ['reconozco', 'reconoces', 'reconoce', 'reconocemos', 'reconocéis', 'reconocen'],
      presentSubjunctive: ['reconozca', 'reconozcas', 'reconozca', 'reconozcamos', 'reconozcáis', 'reconozcan'],
      presentYo: 'reconozco'
    },
    hervir: {
      present: ['hiervo', 'hierves', 'hierve', 'hervimos', 'hervís', 'hierven'],
      preterite: ['herví', 'herviste', 'hirvió', 'hervimos', 'hervisteis', 'hirvieron'],
      presentSubjunctive: ['hierva', 'hiervas', 'hierva', 'hirvamos', 'hirváis', 'hiervan'],
      presentYo: 'hiervo'
    },
    adquirir: {
      present: ['adquiero', 'adquieres', 'adquiere', 'adquirimos', 'adquirís', 'adquieren'],
      presentSubjunctive: ['adquiera', 'adquieras', 'adquiera', 'adquiramos', 'adquiráis', 'adquieran'],
      presentYo: 'adquiero'
    },
    proveer: {
      present: ['proveo', 'provees', 'provee', 'proveemos', 'proveéis', 'proveen'],
      preterite: ['proveí', 'proveíste', 'proveyó', 'proveímos', 'proveísteis', 'proveyeron'],
      presentSubjunctive: ['provea', 'proveas', 'provea', 'proveamos', 'proveáis', 'provean'],
      presentYo: 'proveo', participle: 'provisto', gerund: 'proveyendo'
    },
    prohibir: {
      present: ['prohíbo', 'prohíbes', 'prohíbe', 'prohibimos', 'prohibís', 'prohíben'],
      presentSubjunctive: ['prohíba', 'prohíbas', 'prohíba', 'prohibamos', 'prohibáis', 'prohíban'],
      presentYo: 'prohíbo'
    },
    variar: {
      present: ['varío', 'varías', 'varía', 'variamos', 'variáis', 'varían'],
      presentSubjunctive: ['varíe', 'varíes', 'varíe', 'variemos', 'variéis', 'varíen'],
      presentYo: 'varío'
    },
    vaciar: {
      present: ['vacío', 'vacías', 'vacía', 'vaciamos', 'vaciáis', 'vacían'],
      presentSubjunctive: ['vacíe', 'vacíes', 'vacíe', 'vaciemos', 'vaciéis', 'vacíen'],
      presentYo: 'vacío'
    },
    enfriar: {
      present: ['enfrío', 'enfrías', 'enfría', 'enfriamos', 'enfriáis', 'enfrían'],
      presentSubjunctive: ['enfríe', 'enfríes', 'enfríe', 'enfriemos', 'enfriéis', 'enfríen'],
      presentYo: 'enfrío'
    },
    obtener: {
      present: ['obtengo', 'obtienes', 'obtiene', 'obtenemos', 'obtenéis', 'obtienen'],
      preterite: ['obtuve', 'obtuviste', 'obtuvo', 'obtuvimos', 'obtuvisteis', 'obtuvieron'],
      future: ['obtendré', 'obtendrás', 'obtendrá', 'obtendremos', 'obtendréis', 'obtendrán'],
      conditional: ['obtendría', 'obtendrías', 'obtendría', 'obtendríamos', 'obtendríais', 'obtendrían'],
      presentYo: 'obtengo', gerund: 'obteniendo'
    },
    contener: {
      present: ['contengo', 'contienes', 'contiene', 'contenemos', 'contenéis', 'contienen'],
      preterite: ['contuve', 'contuviste', 'contuvo', 'contuvimos', 'contuvisteis', 'contuvieron'],
      future: ['contendré', 'contendrás', 'contendrá', 'contendremos', 'contendréis', 'contendrán'],
      conditional: ['contendría', 'contendrías', 'contendría', 'contendríamos', 'contendríais', 'contendrían'],
      presentYo: 'contengo', gerund: 'conteniendo'
    },
    retener: {
      present: ['retengo', 'retienes', 'retiene', 'retenemos', 'retenéis', 'retienen'],
      preterite: ['retuve', 'retuviste', 'retuvo', 'retuvimos', 'retuvisteis', 'retuvieron'],
      future: ['retendré', 'retendrás', 'retendrá', 'retendremos', 'retendréis', 'retendrán'],
      conditional: ['retendría', 'retendrías', 'retendría', 'retendríamos', 'retendríais', 'retendrían'],
      presentYo: 'retengo', gerund: 'reteniendo'
    },
    sostener: {
      present: ['sostengo', 'sostienes', 'sostiene', 'sostenemos', 'sostenéis', 'sostienen'],
      preterite: ['sostuve', 'sostuviste', 'sostuvo', 'sostuvimos', 'sostuvisteis', 'sostuvieron'],
      future: ['sostendré', 'sostendrás', 'sostendrá', 'sostendremos', 'sostendréis', 'sostendrán'],
      conditional: ['sostendría', 'sostendrías', 'sostendría', 'sostendríamos', 'sostendríais', 'sostendrían'],
      presentYo: 'sostengo', gerund: 'sosteniendo'
    },
    entretener: {
      present: ['entretengo', 'entretienes', 'entretiene', 'entretenemos', 'entretenéis', 'entretienen'],
      preterite: ['entretuve', 'entretuviste', 'entretuvo', 'entretuvimos', 'entretuvisteis', 'entretuvieron'],
      future: ['entretendré', 'entretendrás', 'entretendrá', 'entretendremos', 'entretendréis', 'entretendrán'],
      conditional: ['entretendría', 'entretendrías', 'entretendría', 'entretendríamos', 'entretendríais', 'entretendrían'],
      presentYo: 'entretengo', gerund: 'entreteniendo'
    },
    prevenir: {
      present: ['prevengo', 'previenes', 'previene', 'prevenimos', 'prevenís', 'previenen'],
      preterite: ['previne', 'previniste', 'previno', 'previnimos', 'previnisteis', 'previnieron'],
      future: ['prevendré', 'prevendrás', 'prevendrá', 'prevendremos', 'prevendréis', 'prevendrán'],
      conditional: ['prevendría', 'prevendrías', 'prevendría', 'prevendríamos', 'prevendríais', 'prevendrían'],
      presentYo: 'prevengo', gerund: 'previniendo'
    },
    intervenir: {
      present: ['intervengo', 'intervienes', 'interviene', 'intervenimos', 'intervenís', 'intervienen'],
      preterite: ['intervine', 'interviniste', 'intervino', 'intervinimos', 'intervinisteis', 'intervinieron'],
      future: ['intervendré', 'intervendrás', 'intervendrá', 'intervendremos', 'intervendréis', 'intervendrán'],
      conditional: ['intervendría', 'intervendrías', 'intervendría', 'intervendríamos', 'intervendríais', 'intervendrían'],
      presentYo: 'intervengo', gerund: 'interviniendo'
    },
    componer: {
      present: ['compongo', 'compones', 'compone', 'componemos', 'componéis', 'componen'],
      preterite: ['compuse', 'compusiste', 'compuso', 'compusimos', 'compusisteis', 'compusieron'],
      future: ['compondré', 'compondrás', 'compondrá', 'compondremos', 'compondréis', 'compondrán'],
      conditional: ['compondría', 'compondrías', 'compondría', 'compondríamos', 'compondríais', 'compondrían'],
      presentYo: 'compongo', participle: 'compuesto'
    },
    suponer: {
      present: ['supongo', 'supones', 'supone', 'suponemos', 'suponéis', 'suponen'],
      preterite: ['supuse', 'supusiste', 'supuso', 'supusimos', 'supusisteis', 'supusieron'],
      future: ['supondré', 'supondrás', 'supondrá', 'supondremos', 'supondréis', 'supondrán'],
      conditional: ['supondría', 'supondrías', 'supondría', 'supondríamos', 'supondríais', 'supondrían'],
      presentYo: 'supongo', participle: 'supuesto'
    },
    proponer: {
      present: ['propongo', 'propones', 'propone', 'proponemos', 'proponéis', 'proponen'],
      preterite: ['propuse', 'propusiste', 'propuso', 'propusimos', 'propusisteis', 'propusieron'],
      future: ['propondré', 'propondrás', 'propondrá', 'propondremos', 'propondréis', 'propondrán'],
      conditional: ['propondría', 'propondrías', 'propondría', 'propondríamos', 'propondríais', 'propondrían'],
      presentYo: 'propongo', participle: 'propuesto'
    },
    disponer: {
      present: ['dispongo', 'dispones', 'dispone', 'disponemos', 'disponéis', 'disponen'],
      preterite: ['dispuse', 'dispusiste', 'dispuso', 'dispusimos', 'dispusisteis', 'dispusieron'],
      future: ['dispondré', 'dispondrás', 'dispondrá', 'dispondremos', 'dispondréis', 'dispondrán'],
      conditional: ['dispondría', 'dispondrías', 'dispondría', 'dispondríamos', 'dispondríais', 'dispondrían'],
      presentYo: 'dispongo', participle: 'dispuesto'
    },
    imponer: {
      present: ['impongo', 'impones', 'impone', 'imponemos', 'imponéis', 'imponen'],
      preterite: ['impuse', 'impusiste', 'impuso', 'impusimos', 'impusisteis', 'impusieron'],
      future: ['impondré', 'impondrás', 'impondrá', 'impondremos', 'impondréis', 'impondrán'],
      conditional: ['impondría', 'impondrías', 'impondría', 'impondríamos', 'impondríais', 'impondrían'],
      presentYo: 'impongo', participle: 'impuesto'
    },
    exponer: {
      present: ['expongo', 'expones', 'expone', 'exponemos', 'exponéis', 'exponen'],
      preterite: ['expuse', 'expusiste', 'expuso', 'expusimos', 'expusisteis', 'expusieron'],
      future: ['expondré', 'expondrás', 'expondrá', 'expondremos', 'expondréis', 'expondrán'],
      conditional: ['expondría', 'expondrías', 'expondría', 'expondríamos', 'expondríais', 'expondrían'],
      presentYo: 'expongo', participle: 'expuesto'
    },
    posponer: {
      present: ['pospongo', 'pospones', 'pospone', 'posponemos', 'posponéis', 'posponen'],
      preterite: ['pospuse', 'pospusiste', 'pospuso', 'pospusimos', 'pospusisteis', 'pospusieron'],
      future: ['pospondré', 'pospondrás', 'pospondrá', 'pospondremos', 'pospondréis', 'pospondrán'],
      conditional: ['pospondría', 'pospondrías', 'pospondría', 'pospondríamos', 'pospondríais', 'pospondrían'],
      presentYo: 'pospongo', participle: 'pospuesto'
    },
    reducir: {
      present: ['reduzco', 'reduces', 'reduce', 'reducimos', 'reducís', 'reducen'],
      preterite: ['reduje', 'redujiste', 'redujo', 'redujimos', 'redujisteis', 'redujeron'],
      presentSubjunctive: ['reduzca', 'reduzcas', 'reduzca', 'reduzcamos', 'reduzcáis', 'reduzcan'],
      presentYo: 'reduzco'
    }
  };

  const memoryVerbs = [...new Set([...commonVerbs, ...moreVerbs])];
  const overridesByLemma = { ...extraOverrides, ...irregular, ...correctedOverrides, ...moreOverrides };
  memoryVerbs.forEach(lemma => registerVerb(lemma, overridesByLemma[lemma] || {}));
  Object.entries(overridesByLemma).forEach(([lemma, overrides]) => {
    if (!memoryVerbs.includes(lemma)) registerVerb(lemma, overrides);
  });

  const reflexiveVerbs = new Set(`acostar despertar dormir lavar levantar llamar sentar vestir ir quedar bañar duchar arrepentir desvanecer parecer`.split(/\s+/));
  const reflexivePronouns = new Set(['me', 'te', 'se', 'nos', 'os']);
  const subjectPersonIndex = new Map([
    ['yo', 0], ['tú', 1], ['él', 2], ['ella', 2], ['usted', 2],
    ['nosotros', 3], ['nosotras', 3], ['vosotros', 4], ['vosotras', 4],
    ['ellos', 5], ['ellas', 5], ['ustedes', 5]
  ]);
  const determiners = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella', 'aquellos', 'aquellas']);
  const auxiliaries = new Set(['he', 'has', 'ha', 'hemos', 'habéis', 'han', 'había', 'habías', 'habíamos', 'habíais', 'habían', 'hube', 'hubiste', 'hubo', 'hubimos', 'hubisteis', 'hubieron', 'habré', 'habrás', 'habrá', 'habremos', 'habréis', 'habrán']);
  const modalWords = new Set(['puede', 'pueden', 'puedo', 'puedes', 'podemos', 'podéis', 'debe', 'deben', 'debo', 'debes', 'debemos', 'deberían', 'quiere', 'quieren', 'quiero', 'quieren', 'va', 'van', 'voy', 'vas', 'vamos']);
  const ambiguousForms = new Set(['vino', 'pasado', 'habla', 'cuento', 'muestra', 'forma', 'llama', 'llamas', 'pasa', 'paso', 'nada', 'como', 'bajo', 'camino', 'canto', 'casa', 'planta', 'cuenta', 'sueño', 'marca', 'falta', 'gusto', 'trabajo', 'estudio', 'juego', 'sal', 'sobre', 'medio', 'prueba', 'vela', 'lista', 'cambio', 'corte']);
  const helperWords = new Set(['no', 'ya', 'nunca', 'siempre', 'también', 'todavía', 'aún', 'que', 'se', 'me', 'te', 'nos', 'os', 'lo', 'la', 'los', 'las']);
  const infinitivePrepositions = new Set(['a', 'de', 'para', 'por', 'sin', 'al', 'que']);
  const irNextClues = new Set(['a', 'hacia', 'hasta', 'desde', 'con', 'por']);
  const adjectiveClues = new Set(['bien', 'mal', 'bueno', 'buena', 'buenos', 'buenas', 'bonito', 'bonita', 'difícil', 'fácil', 'feliz', 'triste', 'tarde', 'temprano', 'listo', 'lista']);

  function wordBefore(text, index) {
    const match = text.slice(0, index).match(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s*$/);
    return normalize(match?.[1] || '');
  }

  function wordAfter(text, index, length) {
    const match = text.slice(index + length).match(/^\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/);
    return normalize(match?.[1] || '');
  }

  function mergeRecords(records, originalForm) {
    const inflections = unique(records.map(record => record.infinitive));
    const tenses = unique(records.map(record => record.tense));
    const persons = unique(records.map(record => record.person));
    const stems = unique(records.map(record => record.stem));
    const presentYos = unique(records.map(record => record.presentYo));
    return {
      form: originalForm,
      infinitive: inflections.join(' / '),
      tense: tenses.join(' or '),
      person: persons.join(' / '),
      stem: stems.join(' / '),
      presentYo: presentYos.join(' / '),
      kind: unique(records.map(record => record.kind)).join(' / ')
    };
  }

  function findRecords(word, passageText, position) {
    const normalizedWord = normalize(word);
    const previous = wordBefore(passageText, position);
    const next = wordAfter(passageText, position, word.length);
    let records = (formIndex.get(normalizedWord) || []).map(record => ({ ...record }));

    if (!records.length) {
      const enclitic = normalizedWord.match(/(me|te|se|nos|os)$/);
      if (enclitic) {
        const base = normalizedWord.slice(0, -enclitic[1].length);
        const infinitives = (formIndex.get(base) || []).filter(record => record.kind === 'infinitive');
        records = infinitives.map(record => ({ ...record, form: word }));
      }
    }
    if (!records.length) return null;

    // A determiner before a form is a strong sign that a noun/adjective was selected,
    // not a finite verb (for example, “el vino” or “el pasado”).
    if (determiners.has(previous) && records.every(record => record.kind !== 'finite')) return null;
    if (determiners.has(previous) && ambiguousForms.has(normalizedWord)) return null;

    const score = record => {
      let value = 0;
      const explicitPerson = subjectPersonIndex.get(previous);
      if (explicitPerson !== undefined) value += record.person === PERSONS[explicitPerson] ? 6 : -3;
      if (reflexivePronouns.has(previous)) value += 3;
      if (auxiliaries.has(previous) && record.kind === 'participle') value += 5;
      if (modalWords.has(previous)) value += 3;
      if (helperWords.has(previous)) value += 2;
      if (infinitivePrepositions.has(previous) && record.kind === 'infinitive') value += 3;
      if (record.infinitive === 'ir' && irNextClues.has(next)) value += 4;
      if (normalizedWord === 'vino' && record.infinitive === 'venir' && irNextClues.has(next)) value += 4;
      if (record.infinitive === 'ser' && adjectiveClues.has(next)) value += 2;
      if (ambiguousForms.has(normalizedWord)) value -= 2;
      if (determiners.has(previous)) value -= 5;
      return value;
    };

    const bestScore = Math.max(...records.map(score));
    if (ambiguousForms.has(normalizedWord) && bestScore < 2) return null;
    const bestRecords = records.filter(record => score(record) === bestScore);

    const attachedPronoun = normalizedWord.match(/(me|te|se|nos|os)$/);
    const hasReflexivePronounBefore = reflexivePronouns.has(previous);
    const enriched = bestRecords.map(record => {
      const lemma = record.infinitive;
      if (reflexiveVerbs.has(lemma) && (attachedPronoun || hasReflexivePronounBefore)) {
        return {
          ...record,
          infinitive: `${lemma}se`,
          presentYo: `me ${record.presentYo}`
        };
      }
      return record;
    });
    return mergeRecords(enriched, word);
  }

  window.analyzeSpanishVerbs = (selectedText, passageText = '', start = 0) => {
    const original = String(selectedText || '');
    const matches = [...original.matchAll(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g)];
    const details = [];
    matches.forEach(match => {
      const detail = findRecords(match[0], String(passageText || ''), Math.max(0, Number(start) + match.index));
      if (detail && !details.some(item => item.form === detail.form && item.infinitive === detail.infinitive)) details.push(detail);
    });
    return details;
  };

  /* --- Verb memory bank ---------------------------------------------------
   * The flashcard verb section is driven by this API. Every verb known to the
   * engine (built-in or added by the reader) has one catalog entry with its
   * present and past forms, plus whether it is regular. */
  const PERSON_LABELS = ['yo', 'tú', 'él / ella / usted', 'nosotros/as', 'vosotros/as', 'ellos / ellas / ustedes'];

  function catalogEntry(lemma, reflexive = false) {
    const entry = verbCatalog.get(normalize(lemma));
    if (!entry) return null;
    if (!reflexive) return entry;
    return { ...entry, infinitive: `${entry.infinitive}se`, reflexive: true };
  }

  window.spanishVerbBank = {
    persons: PERSONS.slice(),
    personLabels: PERSON_LABELS.slice(),
    size: () => verbCatalog.size,
    all: () => [...verbCatalog.values()].sort((a, b) => a.infinitive.localeCompare(b.infinitive, 'es')),
    has: lemma => verbCatalog.has(normalize(lemma).replace(/se$/, '')),
    get: lemma => {
      const key = normalize(lemma);
      const direct = catalogEntry(key);
      if (direct) return direct;
      if (key.endsWith('se')) return catalogEntry(key.slice(0, -2), true);
      return null;
    },
    // Add a verb the reader asked the app to remember. Known verbs keep their
    // stored irregular forms; new ones are conjugated with the regular pattern.
    add: lemma => {
      const key = normalize(lemma);
      if (!/(ar|er|ir)$/.test(key)) return null;
      if (!verbCatalog.has(key)) registerVerb(lemma.trim(), {});
      return catalogEntry(key) || null;
    },
    // Which verbs of the memory does this saved expression contain?
    matchText: (selectedText, passageText = '', start = 0) => {
      const details = window.analyzeSpanishVerbs(selectedText, passageText, start);
      const found = [];
      details.forEach(detail => {
        String(detail.infinitive || '').split('/').map(part => part.trim()).filter(Boolean).forEach(lemma => {
          const entry = window.spanishVerbBank.get(lemma);
          if (entry && !found.some(item => item.infinitive === entry.infinitive)) {
            found.push({ ...entry, matchedForm: detail.form, matchedTense: detail.tense });
          }
        });
      });
      return found;
    }
  };
})();
