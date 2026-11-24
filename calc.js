// Regras do app (sem interface): datas, leitura dos planos, dia cumprido, ofensiva e progresso.

// ---------------- Datas (sempre no fuso do aparelho, formato AAAA-MM-DD) ----------------
const p2 = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const hoje = () => iso(new Date());
export const paraData = (s) => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d, 12); };
export const somarDias = (s, n) => { const d = paraData(s); d.setDate(d.getDate() + n); return iso(d); };
export const diaSemana = (s) => paraData(s).getDay(); // 0 = domingo
export const difDias = (a, b) => Math.round((paraData(b) - paraData(a)) / 86400000);
export function* diasEntre(ini, fim) { for (let d = ini; d <= fim; d = somarDias(d, 1)) yield d; }

export const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
export const SEMANA_NOME = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const nomeMes = (m) => MESES[m];

export function rotuloDia(s) {
  const h = hoje();
  if (s === h) return 'Hoje';
  if (s === somarDias(h, -1)) return 'Ontem';
  if (s === somarDias(h, 1)) return 'Amanhã';
  const d = paraData(s);
  return `${SEMANA_NOME[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

// ---------------- Texto livre → plano ----------------
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
export const slug = (s) => semAcento(String(s).toLowerCase()).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';

const DIA_RE = /\b(domingo|segunda|terca|quarta|quinta|sexta|sabado|dom|seg|ter|qua|qui|sex|sab)(?:-feira)?\b/g;
const DIA_IDX = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
function lerDias(txt) {
  const t = semAcento(String(txt || '').toLowerCase());
  if (/\b(todos os dias|todo dia|diariamente|diario)\b/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set();
  for (const m of t.matchAll(DIA_RE)) out.add(DIA_IDX[m[1].slice(0, 3)]);
  // "seg a sex", "segunda a sexta"
  const faixa = t.match(/\b(dom|seg|ter|qua|qui|sex|sab)[a-z-]*\s+(?:a|ate)\s+(dom|seg|ter|qua|qui|sex|sab)/);
  if (faixa) for (let d = DIA_IDX[faixa[1]]; ; d = (d + 1) % 7) { out.add(d); if (d === DIA_IDX[faixa[2]]) break; }
  return [...out].sort();
}

// Tira marcas de markdown e de lista. Diz se a linha parecia título ou item de lista.
function limparLinha(bruta) {
  let s = String(bruta).trim();
  const titulo = /^#{1,6}\s/.test(s) || /^(\*\*|__)[^*_]+(\*\*|__):?$/.test(s);
  s = s.replace(/^#{1,6}\s*/, '');
  const lista = /^([-•*+–]|\d{1,2}[.)])\s+/.test(s);
  s = s.replace(/^([-•*+–]|\d{1,2}[.)])\s+/, '').replace(/\*\*|__|`/g, '').replace(/^[\s*_]+|[\s*_]+$/g, '').trim();
  return { s, titulo, lista };
}
const SERIES_RE = /(\d+)\s*(?:[x×]|s[ée]ries?\s*(?:de|x)?)\s*(\d+(?:\s*(?:-|–|a|\/)\s*\d+)?(?:\s*(?:reps?|repeti[cç][oõ]es|s\b|seg\b))?|falha|max)/i;
const DIA_INICIO_RE = /^(domingo|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado)(-feira)?\b/i;

// Formato do treino (aceita também o markdown que o Claude costuma gerar):
//   TREINO A: Superiores | seg, qui        ## Treino A – Peito (segunda e quinta)
//   Supino reto 4x8-10 90s (obs)           1. Supino reto – 4 séries de 8-10 repetições
//   Esteira 20 min                         Segunda-feira: Pernas
export function lerTreino(texto) {
  const treinos = [];
  const agenda = {};
  let atual = null;
  const novoTreino = (nome, id, dias) => {
    while (treinos.some((t) => t.id === id)) id += '-2';
    atual = { id, nome, exercicios: [] };
    treinos.push(atual);
    for (const d of dias) agenda[d] = id;
  };
  for (const bruta of String(texto || '').split(/\r?\n/)) {
    const { s: linha, titulo, lista } = limparLinha(bruta);
    if (!linha) continue;
    const temSeries = SERIES_RE.test(linha);
    const comTreino = linha.match(/^treino\s+(.+)$/i);
    const comDia = !lista && !temSeries && linha.match(DIA_INICIO_RE);
    const ehCab = comTreino || comDia || (titulo && !temSeries) || (!lista && !temSeries && /:$/.test(linha));
    if (!ehCab) {
      if (/^descanso\b/i.test(linha)) { atual = null; continue; }
      if (!atual) novoTreino('Treino', 'treino', []);
      atual.exercicios.push(lerExercicio(linha, atual.exercicios));
      continue;
    }
    // Dias: depois de "|" ou "@", entre parênteses, ou na própria linha.
    let resto = linha;
    let diasTxt = '';
    const sep = resto.match(/\s*[|@]\s*(.+)$/);
    if (sep) { diasTxt = sep[1]; resto = resto.slice(0, sep.index); }
    const par = resto.match(/\(([^)]*)\)/);
    if (!diasTxt && par && lerDias(par[1]).length) { diasTxt = par[1]; resto = resto.replace(par[0], ''); }
    if (!diasTxt) diasTxt = resto;
    const dias = lerDias(diasTxt);
    resto = resto.replace(/[:\s–—-]+$/, '').trim();
    if (/\bdescanso\b|\bfolga\b|\boff\b/i.test(resto) && !comTreino) { atual = null; continue; }
    let nome, id;
    if (comTreino) {
      const corpo = resto.replace(/^treino\s+/i, '');
      // "Treino A – Peito" / "Treino B2: Costas": a letra (ou número) é o código do treino.
      const m = corpo.match(/^([A-Za-z]\d?|\d{1,2})\s*[:–—-]\s*(.+)$/) || corpo.match(/^([A-Za-z]\d?|\d{1,2})$/);
      if (m) { id = slug(m[1]); nome = m[2] ? `${m[1]} · ${m[2]}` : m[1]; } else {
        // Mesmo id e nome que a versão anterior gerava (os registros antigos continuam ligados).
        id = slug(corpo.split(/[:\-–]/)[0]);
        nome = corpo.replace(/\s*:\s*/, ' · ');
      }
    } else if (comDia) {
      const diaNome = comDia[0];
      const tema = resto.slice(comDia[0].length).replace(/^[\s:–—-]+/, '');
      id = slug(tema || diaNome);
      nome = tema ? `${diaNome[0].toUpperCase()}${diaNome.slice(1).toLowerCase()} · ${tema}` : diaNome;
    } else {
      nome = resto.replace(/\s*[:–—]\s*/, ' · ');
      id = slug(resto.split(/[:–—-]/)[0]);
    }
    novoTreino(nome, id, dias);
  }
  return { treinos: treinos.filter((t) => t.exercicios.length), agenda: Object.fromEntries(Object.entries(agenda).filter(([, id]) => treinos.some((t) => t.id === id && t.exercicios.length))) };
}

function lerExercicio(linha, existentes) {
  let resto = linha;
  let obs = '';
  const parObs = resto.match(/\(([^)]*)\)\s*$/);
  if (parObs) { obs = parObs[1].trim(); resto = resto.slice(0, parObs.index).trim(); }
  let descanso = null;
  const DESC_RE = /(?:^|\s|,)(?:desc(?:anso)?\.?:?\s*(?:de\s*)?)?(\d+)\s*(s|seg|segundos|"|min|minutos|')(?=\s|$|,|\))/i;
  // Descanso também pode estar na observação: "(descanso 90s)"
  const descObs = obs.match(/desc(?:anso)?\.?:?\s*(?:de\s*)?(\d+)\s*(s|seg|segundos|"|min|minutos|')/i);
  if (descObs) { descanso = /min|'/i.test(descObs[2]) ? Number(descObs[1]) * 60 : Number(descObs[1]); obs = obs.replace(descObs[0], '').replace(/^[\s,;–-]+|[\s,;–-]+$/g, ''); }
  let series = null, reps = '';
  const sr = resto.match(SERIES_RE);
  if (sr) {
    series = Number(sr[1]);
    reps = sr[2].replace(/\s*(reps?|repeti[cç][oõ]es)$/i, '').replace(/\s*seg$/i, 's').replace(/\s*(–|a)\s*/, '-').replace(/\s+/g, '');
  }
  const desc = resto.match(DESC_RE);
  if (desc && (!sr || desc.index > sr.index)) {
    const n = Number(desc[1]);
    const ehMin = /min|'/i.test(desc[2]);
    // "Esteira 20 min" sem séries é a duração, não o descanso
    if (!sr) reps = `${n} ${ehMin ? 'min' : 's'}`;
    else if (descanso == null) descanso = ehMin ? n * 60 : n;
  }
  const corte = Math.min(...[sr?.index, desc?.index].filter((x) => x != null), resto.length);
  const nome = resto.slice(0, corte).replace(/[:,\s–—-]+$/, '').trim() || linha;
  let id = slug(nome);
  while (existentes.some((e) => e.id === id)) id += '-2';
  return { id, nome, series: series || (reps ? 1 : 3), reps, descanso, obs };
}

const REFEICAO_RE = /^(caf[eé]|desjejum|almo[cç]o|jantar|janta|lanche|ceia|cola[cç][aã]o|pr[eé][\s-]?treino|p[oó]s[\s-]?treino|refei[cç][aã]o|merenda|brunch)/i;
const ALTERNATIVA_RE = /^(op[cç][aã]o|ou\b|alternativa|substitui|varia[cç][aã]o)/i;
const HORA_RE = /\(?\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b\)?(?:\s*(?:às|as|-|–))?/i;

// Formato da dieta (aceita também markdown):
//   07:30 Café da manhã: 2 ovos; 1 pão      ## Café da manhã (7h)
//   - 1 fruta                               - 2 ovos mexidos
export function lerDieta(texto) {
  const refeicoes = [];
  const nova = (nomeBruto, itens) => {
    const h = nomeBruto.match(HORA_RE);
    const hora = h ? `${p2(h[1])}:${h[2] || '00'}` : '';
    let nome = (h ? nomeBruto.replace(h[0], ' ') : nomeBruto).replace(/\(\s*\)/g, '').replace(/^[\s:–—-]+|[\s:–—-]+$/g, '').replace(/\s{2,}/g, ' ').trim() || 'Refeição';
    let id = slug(nome);
    while (refeicoes.some((r) => r.id === id)) id += '-2';
    refeicoes.push({ id, nome, hora, itens });
  };
  for (const bruta of String(texto || '').split(/\r?\n/)) {
    const { s: linha, titulo, lista } = limparLinha(bruta);
    if (!linha) continue;
    const ult = refeicoes.at(-1);
    const dp = linha.match(/^((?:\d{1,2}\s*[:h]\s*\d{2}\s*[-–]?\s*)?[^:]{1,48}?)\s*:\s*(.*)$/);
    const cabeca = dp ? dp[1] : linha;
    const semHora = cabeca.replace(HORA_RE, '').trim();
    const pareceRefeicao = REFEICAO_RE.test(semHora) || /^\d{1,2}\s*(h|:)/.test(cabeca);
    if (ult && (lista || ALTERNATIVA_RE.test(linha)) && !(titulo && pareceRefeicao)) { ult.itens.push(linha); continue; }
    if (titulo || pareceRefeicao || (!ult) || (dp && !dp[2])) {
      const itens = dp && dp[2] ? dp[2].split(/\s*;\s*/).filter(Boolean) : [];
      nova(dp ? dp[1] : linha, itens);
      continue;
    }
    ult.itens.push(linha);
  }
  return { refeicoes };
}

export const EXEMPLO_TREINO = `TREINO A: Superiores | seg, qui
Supino reto com halteres 4x8-10 90s
Remada curvada 4x10 90s
Desenvolvimento 3x10 60s
Puxada na frente 3x12 60s
Tríceps corda 3x12 45s

TREINO B: Inferiores | ter, sex
Agachamento livre 4x8 120s (desce até 90°)
Leg press 4x12 90s
Cadeira extensora 3x15 45s
Mesa flexora 3x12 45s
Panturrilha em pé 4x15 30s

TREINO C: Cardio e core | qua, sab
Esteira inclinada 30 min
Prancha 3x40s
Abdominal infra 3x15 30s`;

export const EXEMPLO_DIETA = `07:30 Café da manhã: 2 ovos mexidos; 1 fatia de pão integral; café sem açúcar
10:00 Lanche: 1 fruta; 10 castanhas
12:30 Almoço: 120 g de frango; 4 col. de arroz; feijão; salada à vontade
16:00 Lanche da tarde: iogurte natural; 1 col. de aveia
19:30 Jantar: 120 g de peixe ou frango; legumes; 2 col. de arroz
22:00 Ceia: chá; 1 fatia de queijo branco`;

// ---------------- Dia ----------------
export function treinoDoDia(plano, data, dia) {
  const ts = plano?.treinos || [];
  const id = dia?.treinoId !== undefined ? dia.treinoId : (plano?.agenda || {})[diaSemana(data)];
  return ts.find((t) => t.id === id) || null;
}
export const previstoNaAgenda = (plano, data) => !!(plano?.treinos || []).find((t) => t.id === (plano?.agenda || {})[diaSemana(data)]);

// Progresso do dia, de 0 a 1, e se o dia está cumprido.
export function avaliarDia(plano, data, dia, prefs = {}) {
  // Sem plano não há o que cumprir: o dia não conta.
  if (!plano || (!(plano.treinos || []).length && !(plano.refeicoes || []).length)) {
    return { cumprido: false, treinoOk: false, refeicoesOk: false, temTreino: false, feitas: 0, marcadas: 0, total: 0, progresso: 0 };
  }
  const pct = (prefs.metaRefeicoes ?? 80) / 100;
  const refs = plano?.refeicoes || [];
  const st = dia?.refeicoes || {};
  const feitas = refs.filter((r) => st[r.id] === 'ok' || st[r.id] === 'troca').length;
  const marcadas = refs.filter((r) => st[r.id]).length;
  const temTreino = previstoNaAgenda(plano, data) || (dia?.treinoId && treinoDoDia(plano, data, dia));
  const treinoOk = !temTreino || !!dia?.treinoFeito;
  const refeicoesOk = !refs.length || feitas / refs.length >= pct - 1e-9;
  const partes = [];
  if (temTreino) partes.push(dia?.treinoFeito ? 1 : progressoTreino(treinoDoDia(plano, data, dia), dia) * 0.8);
  if (refs.length) partes.push(Math.min(1, feitas / Math.max(1, Math.ceil(refs.length * pct))));
  const progresso = partes.length ? partes.reduce((a, b) => a + b, 0) / partes.length : 1;
  return { cumprido: treinoOk && refeicoesOk, treinoOk, refeicoesOk, temTreino: !!temTreino, feitas, marcadas, total: refs.length, progresso };
}

export function progressoTreino(treino, dia) {
  if (!treino) return 0;
  const total = treino.exercicios.reduce((a, e) => a + (e.series || 1), 0);
  const ok = treino.exercicios.reduce((a, e) => a + ((dia?.series || {})[e.id] || []).filter((s) => s && s.ok).length, 0);
  return total ? Math.min(1, ok / total) : 0;
}

// ---------------- Ofensiva ----------------
// Começa com 1 congelamento; ganha 1 toda segunda-feira (máximo 2).
// Um dia não cumprido gasta um congelamento (a ofensiva não cresce, mas não zera).
// Sem congelamento, a ofensiva zera. Hoje só conta quando é cumprido.
export const MAX_GELO = 2;
// Dia em que o app passou a valer de verdade: nada antes disso conta (nem como falha).
export const INICIO_OFENSIVA = '2026-11-24';
export const inicioEfetivo = (inicio) => [inicio || hoje(), INICIO_OFENSIVA].sort().at(-1);
export function calcularOfensiva(inicio, cumpridoEm, ate = hoje()) {
  const mapa = {};
  let atual = 0, recorde = 0, gelo = 1;
  if (!inicio || inicio > ate) return { atual, recorde, gelo, mapa, hojeOk: false };
  const ontem = somarDias(ate, -1);
  for (const d of diasEntre(inicio, ontem)) {
    if (d !== inicio && diaSemana(d) === 1) gelo = Math.min(MAX_GELO, gelo + 1);
    if (cumpridoEm(d)) { atual++; mapa[d] = 'ok'; }
    else if (gelo > 0) { gelo--; mapa[d] = 'gelo'; }
    else { atual = 0; mapa[d] = 'falhou'; }
    recorde = Math.max(recorde, atual);
  }
  if (ate !== inicio && diaSemana(ate) === 1) gelo = Math.min(MAX_GELO, gelo + 1);
  const hojeOk = !!cumpridoEm(ate);
  if (hojeOk) { atual++; mapa[ate] = 'ok'; } else mapa[ate] = 'pendente';
  recorde = Math.max(recorde, atual);
  return { atual, recorde, gelo, mapa, hojeOk };
}

// Ofensiva da dupla: cresce no dia em que os dois cumprem; zera se algum falhou de verdade
// (sem congelamento). Dia faltando no mapa de alguém conta como falha.
export function ofensivaDupla(inicio, mapaA, mapaB, ate = hoje()) {
  let atual = 0, recorde = 0;
  const dias = {};
  if (!inicio || inicio > ate) return { atual, recorde, dias, hojeOk: false };
  for (const d of diasEntre(inicio, somarDias(ate, -1))) {
    const a = mapaA[d] || 'falhou', b = mapaB[d] || 'falhou';
    if (a === 'falhou' || b === 'falhou') { atual = 0; dias[d] = 'falhou'; }
    else if (a === 'ok' && b === 'ok') { atual++; dias[d] = 'ok'; }
    else dias[d] = 'gelo';
    recorde = Math.max(recorde, atual);
  }
  const hojeOk = mapaA[ate] === 'ok' && mapaB[ate] === 'ok';
  if (hojeOk) atual++;
  dias[ate] = hojeOk ? 'ok' : 'pendente';
  recorde = Math.max(recorde, atual);
  return { atual, recorde, dias, hojeOk };
}

// ---------------- Desafios (estilo GymRats) ----------------
// Desafio: { nome, inicio, fim, criterio: 'dias' | 'minutos', membros, perfis }.
// Check-in: { uid, data, minutos, ... }. Só contam os check-ins entre início e fim.
export function statusDesafio(d, h = hoje()) {
  const total = difDias(d.inicio, d.fim) + 1;
  if (h < d.inicio) return { fase: 'futuro', total, faltam: difDias(h, d.inicio), dia: 0 };
  if (h > d.fim) return { fase: 'encerrado', total, dia: total };
  return { fase: 'ativo', total, dia: difDias(d.inicio, h) + 1, restam: difDias(h, d.fim) };
}

// pontosDocs: [{ uid, dias: { 'AAAA-MM-DD': total } }] (critério "pontos": soma do Placar do dia)
export function placarDesafio(d, checkins, pontosDocs = []) {
  const por = Object.fromEntries((d.membros || []).map((u) => [u, { uid: u, dias: new Set(), minutos: 0, checkins: 0, fol: 0 }]));
  for (const c of checkins) {
    if (!c.data || c.data < d.inicio || c.data > d.fim) continue;
    const p = por[c.uid] ||= { uid: c.uid, dias: new Set(), minutos: 0, checkins: 0, fol: 0, saiu: true };
    p.dias.add(c.data); p.minutos += Number(c.minutos) || 0; p.checkins++;
  }
  for (const doc of pontosDocs) {
    const p = por[doc.uid] ||= { uid: doc.uid, dias: new Set(), minutos: 0, checkins: 0, fol: 0, saiu: true };
    for (const [dt, v] of Object.entries(doc.dias || {})) if (dt >= d.inicio && dt <= d.fim && dt <= hoje()) p.fol += Number(v) || 0;
  }
  const lista = Object.values(por).map((p) => ({ ...p, dias: p.dias.size, pontos: d.criterio === 'minutos' ? p.minutos : d.criterio === 'pontos' ? p.fol : p.dias.size }));
  lista.sort((a, b) => b.pontos - a.pontos || b.dias - a.dias || b.minutos - a.minutos);
  // Empate divide a posição
  lista.forEach((p, i) => { p.pos = i && lista[i - 1].pontos === p.pontos ? lista[i - 1].pos : i + 1; });
  return lista;
}

// Lê duração, calorias e distância de um texto compartilhado (Samsung Health, Apple Saúde, Strava...).
export function lerResumoTreino(texto) {
  const t = String(texto || '').replace(/ /g, ' ');
  const out = {};
  const hms = t.match(/\b(\d{1,2}):(\d{2}):(\d{2})\b/);
  const hm = t.match(/\b(\d{1,2})\s*h\s*(\d{1,2})\s*(?:min|m)\b/i);
  const min = t.match(/\b(\d{1,3})\s*(?:min|minutos)\b/i);
  const ms = !hms && t.match(/(?:dura[cç][aã]o|tempo|duration)\D{0,12}(\d{1,3}):(\d{2})\b/i);
  if (hms) out.minutos = Number(hms[1]) * 60 + Number(hms[2]) + (Number(hms[3]) >= 30 ? 1 : 0);
  else if (hm) out.minutos = Number(hm[1]) * 60 + Number(hm[2]);
  else if (ms) out.minutos = Number(ms[1]) + (Number(ms[2]) >= 30 ? 1 : 0);
  else if (min) out.minutos = Number(min[1]);
  const kcal = t.match(/(\d[\d.]*)[ \t]*kcal/i) || t.match(/calorias[^\d]{0,20}(\d[\d.]*)/i) || t.match(/(\d[\d.]*)[ \t]*(?:cal\b|calorias)/i);
  if (kcal) out.kcal = Number(kcal[1].replace(/\./g, ''));
  const km = t.match(/(\d+(?:[.,]\d+)?)[ \t]*km\b/i);
  if (km) out.km = Number(km[1].replace(',', '.'));
  const s = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tipo = s.trim() && TIPOS.find((x) => x.chaves.test(s));
  if (tipo) out.tipo = tipo.id;
  return out;
}

export const TIPOS = [
  { id: 'musculacao', nome: 'Musculação', e: '🏋️', chaves: /muscula|strength|weight|forca|academia/ },
  { id: 'corrida', nome: 'Corrida', e: '🏃', chaves: /corrida|correr|running|run\b/ },
  { id: 'caminhada', nome: 'Caminhada', e: '🚶', chaves: /caminhada|walk/ },
  { id: 'bike', nome: 'Bike', e: '🚴', chaves: /bike|cicl|cycling|bicicleta|spinning/ },
  { id: 'funcional', nome: 'Funcional', e: '🤸', chaves: /funcional|hiit|crossfit|cross training|functional/ },
  { id: 'natacao', nome: 'Natação', e: '🏊', chaves: /nata[cç]|swim|piscina/ },
  { id: 'esporte', nome: 'Esporte', e: '⚽', chaves: /futebol|volei|tenis|beach|basquete|soccer|tennis/ },
  { id: 'yoga', nome: 'Yoga/Pilates', e: '🧘', chaves: /yoga|pilates|alongamento|stretch/ },
  { id: 'outro', nome: 'Outro', e: '✨', chaves: /(?!)/ },
];
export const tipoInfo = (id) => TIPOS.find((x) => x.id === id) || TIPOS.at(-1);

// ---------------- Metas pelo objetivo ----------------
// Cada pessoa é comparada com o próprio objetivo: quem quer emagrecer e quem quer ganhar massa
// têm metas diferentes, e a nota é "o quanto você se alinhou ao seu objetivo".
export const OBJETIVOS = { emagrecer: 'Emagrecer', manter: 'Manter / definir', ganhar: 'Ganhar massa' };
export const ATIVIDADE = { sedentario: [1.2, 'Sedentário'], leve: [1.375, 'Leve (1 a 3x por semana)'], moderado: [1.55, 'Moderado (3 a 5x)'], intenso: [1.725, 'Intenso (6 a 7x)'] };
const lim = (x, a, b) => Math.min(b, Math.max(a, x));
const r1 = (x) => Math.round(x * 10) / 10;

// mp: metas do plano para o dia (da nutricionista: kcal, faixa min-max, proteína, água...).
// Ordem: o que a pessoa digitou > plano > cálculo automático.
export function calcularMetas(corpo = {}, pesoAtual = null, mp = null, objetivoPlano = null) {
  if (mp?.kcal) {
    const base = calcularMetas({ ...corpo, kcalManual: corpo.kcalManual || mp.kcal, protManual: corpo.protManual || mp.prot }, pesoAtual, null, objetivoPlano);
    return {
      ...base, completo: true,
      ...(mp.carb ? { carb: mp.carb } : {}), ...(mp.gord ? { gord: mp.gord } : {}),
      ...(!corpo.kcalManual && mp.min && mp.max ? { faixa: [mp.min, mp.max] } : {}),
      ...(mp.protMin ? { protMin: mp.protMin } : {}), ...(mp.agua ? { agua: mp.agua } : {}),
    };
  }
  const kg = Number(pesoAtual || corpo.peso) || 0, cm = Number(corpo.altura) || 0, idade = Number(corpo.idade) || 0;
  const objetivo = OBJETIVOS[corpo.objetivo] ? corpo.objetivo : OBJETIVOS[objetivoPlano] ? objetivoPlano : 'manter';
  let kcal = null, tmb = null;
  if (kg && cm && idade) {
    // Mifflin-St Jeor
    tmb = 10 * kg + 6.25 * cm - 5 * idade + (corpo.sexo === 'f' ? -161 : 5);
    const gasto = tmb * (ATIVIDADE[corpo.atividade]?.[0] || 1.375);
    kcal = Math.round((objetivo === 'emagrecer' ? Math.max(tmb * 1.05, gasto - 500) : objetivo === 'ganhar' ? gasto + 300 : gasto) / 10) * 10;
  }
  const prot = kg ? Math.round(kg * (objetivo === 'manter' ? 1.6 : 2)) : null;
  const k = Number(corpo.kcalManual) || kcal, p = Number(corpo.protManual) || prot;
  return {
    objetivo, completo: !!(k && p), tmb: tmb && Math.round(tmb),
    kcal: k || 2000, prot: p || 110,
    gord: Math.round(((k || 2000) * 0.28) / 9),
    carb: Math.round(((k || 2000) - (p || 110) * 4 - (k || 2000) * 0.28) / 4),
    refeicoes: Number(corpo.refeicoes) || 5,
    cardioSemana: Number(corpo.cardioSemana) || 150,
    sono: Number(corpo.sono) || 7,
  };
}

// ---------------- Comida ----------------
// Item registrado: { kcal, p, cb, g, f (fibra), nova (1 natural … 4 ultraprocessado) } já na quantidade comida.
export function somarItens(itens) {
  const t = { kcal: 0, p: 0, cb: 0, g: 0, f: 0 };
  for (const i of itens) for (const k of Object.keys(t)) t[k] += Number(i[k]) || 0;
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, r1(v)]));
}

export const NOVA = { 1: 'In natura', 2: 'Ingrediente culinário', 3: 'Processado', 4: 'Ultraprocessado' };
const NOVA_NOTA = { 1: 10, 2: 9, 3: 6, 4: 2 };

// NOVA aproximado para os alimentos da TACO (pela categoria e pelo nome).
export function novaTaco(nome, cat) {
  const n = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/salsicha|linguica|mortadela|presunto|salame|apresuntado|hamburguer|nuggets|bacon|empanad|biscoito|bolacha|refrigerante|achocolatado|bebida lactea|iogurte, sabor|margarina|maionese|ketchup|salgadinho|macarrao instantaneo|sorvete|chocolate|bala|pirulito|gelatina|cereal matinal|barra de cereal|pao, de forma|bisnaguinha|pizza|lasanha|refresco|po para/.test(n)) return 4;
  if (/^pao|queijo|cerveja|vinho|cachaca|doce de|geleia|compota|conserva|enlatad|defumad|seco|charque|bolo|torrada|requeijao|creme de leite|leite condensado/.test(n)) return 3;
  if (/oleo|azeite|manteiga|acucar|mel\b|sal\b|banha/.test(n)) return 2;
  if (/industrializados|acucarados/i.test(cat)) return 4;
  if (/preparados|miscelaneas/i.test(cat.normalize('NFD').replace(/[̀-ͯ]/g, ''))) return 3;
  return 1;
}

// Nota da refeição (0 a 10) para o objetivo da pessoa, com os motivos.
// alvo: kcal previstas para esta refeição no cardápio do dia (se houver)
export function notaRefeicao(itens, m, alvo = null) {
  if (!itens.length) return null;
  const t = somarItens(itens);
  const alvoK = alvo || m.kcal / m.refeicoes, alvoP = alvo ? (m.prot * alvo) / m.kcal : m.prot / m.refeicoes;
  const r = t.kcal / alvoK;
  const [ini, fim, queda] = { emagrecer: [0.5, 1, 14], manter: [0.6, 1.15, 10], ganhar: [0.8, 1.45, 7] }[m.objetivo];
  const nK = lim(r < ini ? 10 - (ini - r) * 8 : r <= fim ? 10 : 10 - (r - fim) * queda, 0, 10);
  const nP = lim((10 * t.p) / (alvoP * 0.8), 0, 10);
  let soma = 0, peso = 0;
  for (const i of itens) { const w = Math.max(5, Number(i.kcal) || 0); soma += (NOVA_NOTA[i.nova] ?? 6) * w; peso += w; }
  const nQ = lim(soma / peso + (t.f >= 6 ? 1 : 0), 0, 10);
  const [wK, wP, wQ] = { emagrecer: [0.45, 0.3, 0.25], manter: [0.35, 0.3, 0.35], ganhar: [0.35, 0.45, 0.2] }[m.objetivo];
  const nota = r1(nK * wK + nP * wP + nQ * wQ);
  const motivos = [];
  if (r > fim) motivos.push(`${Math.round((r - 1) * 100)}% acima ${alvo ? `do previsto no cardápio (${Math.round(alvo)} kcal)` : `das calorias ideais por refeição${m.objetivo === 'emagrecer' ? ' para emagrecer' : ''}`}`);
  else if (r < ini) motivos.push(m.objetivo === 'ganhar' ? 'pouca comida para ganhar massa' : 'refeição leve');
  else motivos.push('calorias na medida');
  motivos.push(t.p >= alvoP * 0.8 ? `boa proteína (${Math.round(t.p)} g)` : `pouca proteína (${Math.round(t.p)} g de ~${Math.round(alvoP)} g)`);
  const ultra = itens.filter((i) => i.nova === 4);
  if (ultra.length) motivos.push(`ultraprocessado: ${ultra.map((i) => i.nome.split(',')[0]).slice(0, 2).join(', ')}`);
  else if (nQ >= 9) motivos.push('comida de verdade');
  if (t.f >= 6) motivos.push('rica em fibras');
  return { nota, ...t, motivos };
}

// ---------------- Placar do dia (0 a 100) ----------------
// Cada categoria tem teto, os primeiros 70% de cada meta valem mais que o finalzinho
// (curva), e quem cumpre pelo menos metade de todas as categorias ganha +10%.
export const PESOS = { alimentacao: 35, treino: 25, cardio: 15, agua: 10, bonus: 15 };
export const PESOS_NOME = { alimentacao: '🍽️ Alimentação', treino: '🏋️ Treino', cardio: '🏃 Cardio', agua: '💧 Água', bonus: '😴 Bônus' };
export const TIPOS_CARDIO = ['corrida', 'caminhada', 'bike', 'natacao', 'funcional', 'esporte'];
const curva = (x) => Math.pow(lim(x, 0, 1), 0.7);

function pontosKcal(kcal, m) {
  // Faixa que "vale ponto" definida no plano: dentro dela, nota cheia
  if (m.faixa) {
    const [mn, mx] = m.faixa;
    const fora = kcal < mn ? (mn - kcal) / m.kcal : kcal > mx ? (kcal - mx) / m.kcal : 0;
    return 15 * lim(1 - fora / 0.35, 0, 1);
  }
  const d = (kcal - m.kcal) / m.kcal;
  const [a, b] = { emagrecer: [-0.25, 0.05], manter: [-0.1, 0.1], ganhar: [-0.05, 0.15] }[m.objetivo];
  const fora = d < a ? a - d : d > b ? d - b : 0;
  return 15 * lim(1 - fora / 0.35, 0, 1);
}

// ctx: { m (metas), comidas, av (avaliarDia), dia (registro), checkins, metaAgua }
export function pontosDia({ m, comidas = [], av = {}, dia = {}, checkins = [], metaAgua = 2500 }) {
  const c = {};
  const dicas = [];
  // Alimentação
  const grupos = {};
  for (const i of comidas) (grupos[i.grupo || 'outro'] ||= []).push(i);
  const notas = Object.entries(grupos).map(([g, it]) => ({ grupo: g, nome: it[0].grupoNome || g, ...notaRefeicao(it, m, m.alvos?.[g]) }));
  if (comidas.length) {
    const t = somarItens(comidas);
    const mediaNota = notas.reduce((a, x) => a + x.nota * x.kcal, 0) / Math.max(1, notas.reduce((a, x) => a + x.kcal, 0));
    c.alimentacao = pontosKcal(t.kcal, m) + 10 * curva(t.p / m.prot) + mediaNota;
    if (t.p < m.prot * 0.9) dicas.push(`Faltam ~${Math.round(m.prot - t.p)} g de proteína para a meta.`);
    if (t.kcal < m.kcal * 0.75) dicas.push(`Ainda cabem ~${Math.round(m.kcal - t.kcal)} kcal hoje.`);
  } else if (av.total) {
    c.alimentacao = PESOS.alimentacao * 0.7 * (av.feitas / av.total);
    dicas.push('Registre o que comeu na aba Comer: sem registro, a alimentação vale no máximo 70%.');
  } else {
    c.alimentacao = 0;
    dicas.push('Registre o que comeu na aba Comer.');
  }
  // Treino: check-in ou treino do plano feito vale tudo; dia de descanso planejado vale 60%.
  // Sem plano de treino (ou sem dias de treino definidos) não existe "dia de descanso": vale 0 até ter treino ou check-in.
  let descanso = false;
  if (dia.treinoFeito || checkins.length) c.treino = PESOS.treino;
  else if (av.temTreino) { c.treino = PESOS.treino * 0.6 * (av.progressoTreino || 0); dicas.push('Treino do dia ainda não foi feito.'); }
  else if (av.descansoPlanejado) { c.treino = PESOS.treino * 0.6; descanso = true; }
  else { c.treino = 0; dicas.push('Sem treino no plano para hoje: faça um check-in de treino ou monte o plano para pontuar.'); }
  // Cardio: meta da semana dividida pelos dias
  const minCardio = checkins.filter((x) => TIPOS_CARDIO.includes(x.tipo)).reduce((a, x) => a + (Number(x.minutos) || 0), 0) + (Number(dia.cardioMin) || 0);
  const alvoCardio = m.cardioSemana / 7;
  c.cardio = PESOS.cardio * curva(minCardio / alvoCardio);
  if (minCardio < alvoCardio) dicas.push(`Cardio: ${Math.round(minCardio)} de ~${Math.round(alvoCardio)} min hoje.`);
  // Água
  c.agua = PESOS.agua * curva((Number(dia.agua) || 0) / metaAgua);
  // Bônus: sono, dia sem álcool, passos, refeições registradas
  const sono = Number(dia.sono) || 0, passos = Number(dia.passos) || 0;
  c.bonus = (sono >= m.sono ? 6 : sono >= m.sono - 1 ? 3 : 0) + (dia.semAlcool ? 3 : 0) + (passos >= 8000 ? 3 : passos >= 5000 ? 1.5 : 0) + (Object.keys(grupos).length >= 3 ? 3 : 0);
  const base = Object.values(c).reduce((a, b) => a + b, 0);
  const equilibrio = ['alimentacao', 'treino', 'cardio', 'agua'].every((k) => c[k] >= PESOS[k] * 0.5);
  const total = Math.round(Math.min(100, base * (equilibrio ? 1.1 : 1)));
  return { total, cats: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, r1(v)])), equilibrio, notas, minCardio, dicas, descanso };
}

// Rodadas semanais (segunda a domingo) a partir dos pontos de cada dia.
export const inicioSemana = (s) => somarDias(s, -((diaSemana(s) + 6) % 7));

// ---------------- Treino: histórico e recordes ----------------
const seriesOk = (dia, exId) => ((dia?.series || {})[exId] || []).filter((s) => s && s.ok && (Number(s.kg) > 0 || Number(s.reps) > 0));

// Última vez que o exercício foi feito antes da data.
export function ultimaVez(dias, exId, antesDe) {
  const ds = dias.filter((d) => d.id < antesDe && seriesOk(d, exId).length).sort((a, b) => (a.id < b.id ? 1 : -1));
  return ds[0] ? { data: ds[0].id, series: seriesOk(ds[0], exId) } : null;
}

export const melhorKg = (series) => Math.max(0, ...series.map((s) => Number(s.kg) || 0));

export function historicoExercicio(dias, exId) {
  return dias
    .map((d) => ({ data: d.id, series: seriesOk(d, exId) }))
    .filter((x) => x.series.length)
    .sort((a, b) => (a.data < b.data ? -1 : 1))
    .map((x) => ({ ...x, kg: melhorKg(x.series), volume: x.series.reduce((a, s) => a + (Number(s.kg) || 0) * (Number(s.reps) || 0), 0) }));
}

// Recordes batidos num dia (carga maior que a melhor carga de todos os dias anteriores).
export function recordesDoDia(dias, dia) {
  const out = [];
  for (const exId of Object.keys(dia?.series || {})) {
    const kg = melhorKg(seriesOk(dia, exId));
    if (!kg) continue;
    const antes = dias.filter((d) => d.id < dia.id).map((d) => melhorKg(seriesOk(d, exId)));
    if (antes.some((x) => x > 0) && kg > Math.max(...antes)) out.push({ exId, kg });
  }
  return out;
}
