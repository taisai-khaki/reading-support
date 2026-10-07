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

  function registerVerb(lemma, overrides = {}) {
    const ending = normalize(lemma).slice(-2).replace('í', 'i');
    if (!['ar', 'er', 'ir'].includes(ending)) return;
    const regular = regularForms(lemma, ending);
    const stem = regular.stem;
    const forms = { ...regular, ...overrides };
    const presentYo = overrides.presentYo || forms.present[0];
    const metadata = { infinitive: lemma, stem: stem ? `${stem}-` : 'irregular', presentYo };

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

  const overridesByLemma = { ...extraOverrides, ...irregular };
  commonVerbs.forEach(lemma => registerVerb(lemma, overridesByLemma[lemma] || {}));
  Object.entries(overridesByLemma).forEach(([lemma, overrides]) => {
    if (!commonVerbs.includes(lemma)) registerVerb(lemma, overrides);
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
})();
