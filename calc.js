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
      const m = corpo.match(/^([^\s:–—-]+)\s*[:–—-]?\s*(.*)$/);
      id = slug(m ? m[1] : corpo);
      nome = m && m[2] ? `${m[1]} · ${m[2].replace(/\s*[:–—-]\s*/, ' · ')}` : corpo;
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
