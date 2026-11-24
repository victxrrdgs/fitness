import { slug } from './calc.js?v=0.6';

// Importar plano de arquivo (PDF, Word, Excel, CSV ou texto). Carregado só ao escolher um arquivo.
// Cada leitor devolve "linhas": listas de células (parágrafo = 1 célula, linha de tabela = várias).
// Depois montarPlano() separa treino e dieta e escreve no formato que calc.js entende.
// Formatos específicos (o arquivo da nutricionista, a ficha do personal) entram em MODELOS.

const MAMMOTH = 'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js';
const MAMMOTH_SRI = 'sha384-8NWE3bZDrmRI4IePMoQaEoLhAQ1MmRMJkdNgnGiHRFanTqsFKr0TmK6aSZvFJ/PO';
const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const EXCELJS_SRI = 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz';

export const ACEITA = '.pdf,.docx,.xlsx,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain';

const scripts = {};
function carregarScript(src, sri, global) {
  if (window[global]) return Promise.resolve(window[global]);
  scripts[src] ||= new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = src; s.integrity = sri; s.crossOrigin = 'anonymous';
    s.onload = () => ok(window[global]);
    s.onerror = () => { delete scripts[src]; s.remove(); erro(new Error('Sem conexão para ler o arquivo. Tente de novo com internet.')); };
    document.head.append(s);
  });
  return scripts[src];
}

const limpar = (s) => String(s ?? '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------------- Leitores ----------------
async function lerPdf(buf) {
  const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const linhas = [];
  linhas.pdf = []; // pedaços com posição, por página (para modelos que leem colunas)
  for (let n = 1; n <= doc.numPages; n++) {
    const pag = await doc.getPage(n);
    const { items } = await pag.getTextContent();
    const brutos = [];
    linhas.pdf.push(brutos);
    // Agrupa os pedaços pela altura (y) e ordena da esquerda para a direita.
    const grupos = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5], alt = Math.abs(it.transform[3]) || 10;
      brutos.push({ x, y, alt, str: limpar(it.str) });
      let g = grupos.find((k) => Math.abs(k.y - y) < alt * 0.5);
      if (!g) { g = { y, alt, itens: [] }; grupos.push(g); }
      g.itens.push({ x, fim: x + (it.width || 0), str: it.str });
    }
    grupos.sort((a, b) => b.y - a.y);
    for (const g of grupos) {
      g.itens.sort((a, b) => a.x - b.x);
      // Espaço grande entre pedaços = outra coluna da tabela.
      const celulas = [];
      let atual = '', fim = null;
      for (const it of g.itens) {
        const gap = fim == null ? 0 : it.x - fim;
        if (fim != null && gap > g.alt * 1.5) { celulas.push(atual); atual = it.str; }
        else atual += (fim != null && gap > g.alt * 0.15 && !/\s$/.test(atual) ? ' ' : '') + it.str;
        fim = it.fim;
      }
      celulas.push(atual);
      linhas.push(celulas.map(limpar).filter(Boolean));
    }
  }
  return linhas;
}

async function lerWord(buf) {
  const mammoth = await carregarScript(MAMMOTH, MAMMOTH_SRI, 'mammoth');
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });
  // DOMParser não executa nada; só lemos o texto.
  const corpo = new DOMParser().parseFromString(html, 'text/html').body;
  const linhas = [];
  const andar = (el) => {
    for (const filho of el.children) {
      const tag = filho.tagName;
      if (tag === 'TABLE') {
        for (const tr of filho.querySelectorAll('tr')) linhas.push([...tr.children].map((td) => limpar(td.textContent)).filter(Boolean));
      } else if (tag === 'UL' || tag === 'OL') {
        for (const li of filho.querySelectorAll(':scope > li')) linhas.push(['- ' + limpar(li.textContent)]);
      } else if (/^(P|H\d)$/.test(tag)) {
        // Quebras de linha dentro do parágrafo viram linhas separadas.
        filho.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
        for (const parte of filho.textContent.split('\n')) linhas.push([limpar(parte)]);
      } else andar(filho);
    }
  };
  andar(corpo);
  return linhas;
}

function valorCelula(v) {
  if (v == null) return '';
  if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return valorCelula(v.result);
    if (v.text) return v.text;
    return '';
  }
  return String(v);
}

async function lerExcel(buf) {
  const ExcelJS = await carregarScript(EXCELJS, EXCELJS_SRI, 'ExcelJS');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const linhas = [];
  wb.eachSheet((ws) => {
    linhas.push([limpar(ws.name)]);
    ws.eachRow((row) => {
      const cel = [];
      row.eachCell((c) => cel.push(limpar(valorCelula(c.value))));
      linhas.push(cel.filter(Boolean));
    });
  });
  return linhas;
}

function lerTexto(txt, csv) {
  return txt.split(/\r?\n/).map((l) => (csv ? l.split(/[;\t]|,(?=\S)/) : [l]).map(limpar).filter(Boolean));
}

export async function lerArquivo(arq) {
  const nome = arq.name.toLowerCase();
  const ext = nome.split('.').pop();
  if (arq.size > 15 * 1024 * 1024) throw new Error('Arquivo muito grande (máx. 15 MB).');
  if (ext === 'pdf') return lerPdf(await arq.arrayBuffer());
  if (ext === 'docx') return lerWord(await arq.arrayBuffer());
  if (ext === 'xlsx') return lerExcel(await arq.arrayBuffer());
  if (ext === 'csv') return lerTexto(await arq.text(), true);
  if (ext === 'txt') return lerTexto(await arq.text(), false);
  if (ext === 'doc' || ext === 'xls') throw new Error(`Arquivo .${ext} antigo: abra no Word/Excel e salve como .${ext}x, ou exporte em PDF.`);
  throw new Error('Formato não suportado. Use PDF, Word (.docx), Excel (.xlsx), CSV ou texto.');
}

// ---------------- Linhas → plano ----------------
const REFEICAO = /\b(cafe da manha|desjejum|colacao|lanche|almoco|jantar|janta|ceia|pre[- ]?treino|pos[- ]?treino|refeicao\s*\d*)\b/;
const SECAO_DIETA = /\b(dieta|plano alimentar|cardapio|alimentacao)\b/;
const SECAO_TREINO = /\b(treino|ficha|musculacao|exercicios?)\b/;
const DIAS = { dom: 'dom', seg: 'seg', ter: 'ter', qua: 'qua', qui: 'qui', sex: 'sex', sab: 'sab' };
const LIXO = /^(pagina\s*\d+|\d+\s*(\/|de)\s*\d+|total\b.*|valor energetico.*|kcal.*)$/;

const hora = (t) => { const m = t.match(/\b(\d{1,2})\s*(?:[:h]\s*(\d{2})|h)\b/i); return m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : ''; };

// "4 séries de 10 a 12 repetições" → "4x10-12"; "descanso 1'30" → "90s"
function normalizarExercicio(t) {
  return t
    .replace(/(\d+)\s*s[eé]ries?\s*(?:de|x|×)?\s*(\d+(?:\s*(?:a|-|–|\/)\s*\d+)?)\s*(?:rep[a-zà-ú]*)?/i, (_, s, r) => `${s}x${r.replace(/\s*(a|–)\s*/, '-').replace(/\s+/g, '')}`)
    .replace(/(\d+)\s*'\s*(\d{2})\s*"?/g, (_, m, s) => `${Number(m) * 60 + Number(s)}s`)
    .replace(/(\d+)\s*(?:seg|segundos)\b/gi, '$1s');
}

function descansoSeg(v) {
  const t = semAcento(String(v));
  const ms = t.match(/(\d+)\s*'\s*(\d{1,2})/); if (ms) return Number(ms[1]) * 60 + Number(ms[2]);
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(min|')/); if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 60);
  const s = t.match(/(\d+)/); return s ? Number(s[1]) : null;
}

// Tabela de exercícios: acha as colunas pelo cabeçalho.
function cabecalhoTreino(cel) {
  const c = cel.map(semAcento);
  const idx = (re) => c.findIndex((x) => re.test(x));
  const col = { nome: idx(/exerc|atividade|movimento/), series: idx(/serie/), reps: idx(/rep/), desc: idx(/desc|interv|pausa/), obs: idx(/obs|metodo|tecnica|carga|cadencia/) };
  return col.nome >= 0 && (col.series >= 0 || col.reps >= 0) ? col : null;
}

// "Cardio: 25 a 30 min de escada ou bike" → "Cardio (escada ou bike) 30 min (25 a 30 min)"
function linhaCardio(t) {
  const r = t.match(/(\d+)\s*(?:a|-|–)\s*(\d+)\s*min/i) || t.match(/(\d+)()\s*min/i);
  const desc = t.replace(/^cardio\s*:?\s*/i, '').replace(/\d+\s*(?:(?:a|-|–)\s*\d+\s*)?min(?:utos)?\s*(?:de\s+)?/i, '').trim();
  return `Cardio${desc ? ` (${desc})` : ''}${r ? ` ${r[2] || r[1]} min` : ''}${r && r[2] ? ` (${r[1]} a ${r[2]} min)` : ''}`;
}

// descPadrao: [min, max] do "Descanso de 60 a 90 s" do texto (principais com 4+ séries ficam com o maior)
function linhaDaTabela(cel, col, descPadrao = null) {
  const pega = (i) => (i >= 0 ? cel[i] || '' : '');
  const nome = pega(col.nome);
  if (!nome) return '';
  if (/^cardio\b/i.test(nome)) return linhaCardio(nome);
  const series = pega(col.series).match(/\d+/)?.[0];
  // "8 a 10" → 8-10; "30 s" → 30s; "10 cada perna" → 10 (cada perna)
  const rm = pega(col.reps).replace(/\s*rep[a-zà-ú]*/i, '').match(/^(\d+(?:\s*(?:a|-|–|\/)\s*\d+)?)\s*(s|seg|segundos)?\b\s*(.*)$/i);
  const reps = rm ? rm[1].replace(/\s*(a|–|\/)\s*/g, '-').replace(/\s+/g, '') + (rm[2] ? 's' : '') : pega(col.reps).replace(/\s+/g, '');
  const extra = rm?.[3]?.trim() || '';
  let t = nome;
  // Coluna única "Séries x Reps" com "4x12"
  const junto = [pega(col.series), pega(col.reps)].find((v) => /\d\s*[x×]\s*(\d|falha|max)/i.test(v));
  if (junto) t += ` ${junto.replace(/\s+/g, '').replace(/×/g, 'x')}`;
  else if (series && reps) t += ` ${series}x${reps}`;
  else if (series) t += ` ${series}x${pega(col.series).replace(/^\d+\s*x?\s*/i, '') || '10'}`;
  else if (reps) t += ` ${/x/i.test(reps) ? reps : '3x' + reps}`;
  const d = col.desc >= 0 ? descansoSeg(pega(col.desc)) : descPadrao ? (Number(series) >= 4 ? descPadrao[1] : descPadrao[0]) : null;
  if (d) t += ` ${d}s`;
  const obs = [extra, pega(col.obs)].filter(Boolean).join('; ');
  if (obs) t += ` (${obs.replace(/[()]/g, '')})`;
  return t;
}

function cabecalhoTreinoNome(t) {
  const s = semAcento(t);
  // "Seg · Quadríceps", "Sáb/Dom · Cardio leve", "Segunda-feira: Peito"
  const ab = s.length < 70 && s.match(/^\s*((?:(?:seg|ter|qua|qui|sex|sab|dom)[a-z.-]*\s*(?:\/|,|e|&)\s*)*(?:seg|ter|qua|qui|sex|sab|dom)[a-z.-]*)\s*[·:\-–|]\s*(.+)$/);
  if (ab) {
    const dias = [...ab[1].matchAll(/(seg|ter|qua|qui|sex|sab|dom)/g)].map((x) => DIAS[x[1]]);
    return `TREINO ${t.slice(t.length - ab[2].length).trim()} | ${[...new Set(dias)].join(', ')}`;
  }
  // "Treino A", "Ficha B - Costas", "Dia 1", "Segunda-feira: Peito"
  const m = t.match(/^\s*(?:treino|ficha|dia)\s+([a-z]|\d{1,2})\b\s*[:\-–]?\s*(.*)$/i)
    || (t.length < 60 && !/\d\s*[x×]\s*\d/.test(t) && t.match(/^\s*(?:treino|ficha)\s+()(.+)$/i));
  const dias = [...s.matchAll(/\b(dom|seg|ter|qua|qui|sex|sab)(?:ingo|unda|ca|rta|nta|ta|ado)?(?:-feira)?\b/g)].map((x) => DIAS[x[1]]);
  if (m) {
    let resto = m[2].replace(/\(([^)]*)\)/, '').replace(/[|@].*$/, '').replace(/^[:\-–\s]+|[:\-–\s]+$/g, '').trim();
    if (!m[1]) {
      // "Ficha de treino" e "Treino da Rafa" são títulos, não um treino.
      if (/^(de\s+)?(treino|musculacao|exercicios?)\b/.test(semAcento(resto))) return null;
      if (/^(da|do)\s+[A-ZÀ-Ú]/.test(resto)) return null;
      resto = resto.replace(/^(de|do|da)\s+/i, '');
      resto = resto.charAt(0).toUpperCase() + resto.slice(1);
    }
    const nome = m[1] ? m[1].toUpperCase() + (resto ? ': ' + resto : '') : resto;
    return `TREINO ${nome}${dias.length ? ' | ' + [...new Set(dias)].join(', ') : ''}`;
  }
  const d = s.match(/^\s*(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\b\s*[:\-–]?\s*(.*)$/);
  if (d && t.length < 60) {
    const resto = t.slice(t.length - d[2].length).trim();
    return `TREINO ${t.slice(0, t.length - d[2].length).replace(/[:\-–\s]+$/, '')}${resto ? ': ' + resto : ''} | ${DIAS[d[1].slice(0, 3)]}`;
  }
  return null;
}

// ---------------- Modelo: dieta com cardápio por dia (tabela semanal) ----------------
// Ex.: "Dieta da Rafa · 23/11 a 20/12": quadro de metas por semana, regras e, em cada página, uma
// semana com uma linha por dia (Dia | Café da manhã (9h) | Almoço (13h) | ... | Extra | Total do dia).
const numBr = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
function dataDoAno(dd, mm) {
  const h = new Date();
  let y = h.getFullYear();
  const dt = new Date(y, mm - 1, dd);
  if (dt - h > 180 * 86400000) y--; else if (h - dt > 180 * 86400000) y++;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
const somarDiasIso = (iso, n) => { const [a, m, d] = iso.split('-').map(Number); const x = new Date(a, m - 1, d + n, 12); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

// Linhas quebradas da mesma comida voltam a ser um item ("Crepioca com mussarela" + "+ mamão").
function juntarItens(linhasCel) {
  const itens = [];
  let kcal = null;
  for (const l of linhasCel) {
    const k = l.match(/^([\d.]+)\s*kcal$/i);
    if (k) { kcal = numBr(k[1]); continue; }
    const ant = itens.at(-1);
    const abertos = ant ? (ant.match(/\(/g) || []).length - (ant.match(/\)/g) || []).length : 0;
    const continua = ant && (abertos > 0 || /(\s(e|com|de|do|da|ao|na|no|em)|\+)$/i.test(ant) || /^[+(]/.test(l) || /^[a-zà-ú]/.test(l) || /^\d+\s*(g|ml|%)$/i.test(l) || /^\d+%$/.test(l));
    if (continua) itens[itens.length - 1] = `${ant} ${l}`.replace(/\s+/g, ' ');
    else itens.push(l);
  }
  return { itens, kcal };
}

const DIA_LINHA = /^(seg|ter|qua|qui|sex|s[áa]b|dom)\w*\.?\s+(\d{1,2})\/(\d{1,2})/i;

function lerSemanaPdf(itens) {
  const cab = itens.find((i) => i.str === 'Dia');
  if (!cab) return null;
  const cols = itens.filter((i) => Math.abs(i.y - cab.y) < cab.alt * 0.5).sort((a, b) => a.x - b.x)
    .map((i) => {
      const nome = i.str.replace(/\s*\(.*\)\s*$/, '').trim();
      return { x: i.x, nome, hora: (i.str.match(/\((\d{1,2})h(\d{2})?\)/) || []).slice(1), total: /^total/i.test(nome) };
    });
  const colDe = (x) => { let c = 0; cols.forEach((k, i) => { if (k.x <= x + 3) c = i; }); return c; };
  // Cada linha de comida pertence ao dia cuja etiqueta ("Sáb 28/11") está na mesma altura ou logo acima
  // (a etiqueta pode ficar um pouco abaixo da primeira linha, por isso a folga).
  const corpo = itens.filter((i) => i.y < cab.y - 1);
  const dias = corpo.filter((i) => colDe(i.x) === 0 && DIA_LINHA.test(i.str)).sort((a, b) => b.y - a.y)
    .map((i) => { const m = i.str.match(DIA_LINHA); return { y: i.y, tol: i.alt * 0.8, data: dataDoAno(Number(m[2]), Number(m[3])), cols: {} }; });
  for (const it of corpo.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const c = colDe(it.x);
    if (c === 0) continue;
    const dono = dias.filter((d) => it.y <= d.y + d.tol).at(-1);
    if (dono) (dono.cols[c] ||= []).push(it.str);
  }
  return { cols, dias };
}

function modeloDietaSemanal(linhas) {
  const todo = linhas.map((c) => c.join(' | ')).join('\n');
  const cardapio = {};
  let refeicoes = null;
  for (const pag of linhas.pdf || []) {
    const sem = lerSemanaPdf(pag);
    if (!sem) continue;
    const ref = sem.cols.map((c, i) => ({ ...c, i })).filter((c) => c.i > 0 && !c.total);
    refeicoes ||= ref.map((c) => ({ id: slug(c.nome), nome: c.nome, hora: c.hora[0] ? `${c.hora[0].padStart(2, '0')}:${c.hora[1] || '00'}` : '' }));
    const iTot = sem.cols.findIndex((c) => c.total);
    for (const d of sem.dias) {
      const dia = {};
      for (const c of ref) {
        const { itens, kcal } = juntarItens(d.cols[c.i] || []);
        if (itens.length) dia[slug(c.nome)] = { itens, ...(kcal != null ? { kcal } : {}) };
      }
      const tot = (d.cols[iTot] || []).join(' ');
      const k = tot.match(/([\d.]+)\s*kcal/i), p = tot.match(/P\s*([\d,]+)\s*g/), cb = tot.match(/C\s*([\d,]+)\s*g/), g = tot.match(/G\s*([\d,]+)\s*g/);
      if (k) dia.total = { kcal: numBr(k[1]), ...(p ? { p: numBr(p[1]) } : {}), ...(cb ? { cb: numBr(cb[1]) } : {}), ...(g ? { g: numBr(g[1]) } : {}) };
      cardapio[d.data] = dia;
    }
  }
  // Período do plano ("23/11 a 20/12") e metas por semana
  const per = todo.match(/(\d{1,2})\/(\d{1,2})\s*a\s*(\d{1,2})\/(\d{1,2})/);
  const datas = Object.keys(cardapio).sort();
  const fimPlano = per ? dataDoAno(Number(per[3]), Number(per[4])) : datas.at(-1);
  const linha = (re) => linhas.find((c) => c.length > 1 && re.test(semAcento(c[0])));
  const iCal = linhas.findIndex((c) => c.length > 1 && /^calorias por dia/.test(semAcento(c[0])));
  const metasPlano = [];
  if (iCal > 0) {
    const cabec = linhas[iCal - 1];
    const vals = (re) => (linha(re) || []).slice(1);
    const kc = vals(/^calorias por dia/), faixa = vals(/^vale ponto/), pr = vals(/^proteina/), cbs = vals(/^carbo/), gs = vals(/^gordura/), ag = vals(/^agua/);
    kc.forEach((v, i) => {
      const h = cabec[cabec.length - kc.length + i] || '';
      const a = h.match(/(\d{1,2})\s*a\s*(\d{1,2})\/(\d{1,2})/), b = h.match(/a partir de\s*(\d{1,2})\/(\d{1,2})/i);
      const de = a ? dataDoAno(Number(a[1]), Number(a[3])) : b ? dataDoAno(Number(b[1]), Number(b[2])) : datas[0];
      const ate = a ? dataDoAno(Number(a[2]), Number(a[3])) : fimPlano;
      const f = (faixa[i] || '').match(/([\d.]+)\s*e\s*([\d.]+)/);
      const pm = (pr[i] || '').match(/([\d,]+)\s*g(?:.*?m[ií]nimo\s*([\d,]+))?/i);
      const agua = (ag[i] || '').match(/([\d,]+)\s*(l|ml)/i);
      metasPlano.push({
        de, ate, kcal: numBr((v.match(/[\d.]+/) || [0])[0]),
        ...(f ? { min: numBr(f[1]), max: numBr(f[2]) } : {}),
        ...(pm ? { prot: numBr(pm[1]), ...(pm[2] ? { protMin: numBr(pm[2]) } : {}) } : {}),
        ...((cbs[i] || '').match(/[\d,]+/) ? { carb: numBr(cbs[i].match(/[\d,]+/)[0]) } : {}),
        ...((gs[i] || '').match(/[\d,]+/) ? { gord: numBr(gs[i].match(/[\d,]+/)[0]) } : {}),
        ...(agua ? { agua: Math.round(numBr(agua[1]) * (/^l$/i.test(agua[2]) ? 1000 : 1)) } : {}),
      });
    });
  }
  const notas = linhas.filter((c) => c.length === 1 && /^[•·▪-]\s/.test(c[0])).map((c) => c[0].replace(/^[•·▪-]\s*/, ''));
  // Notas de rodapé das semanas ("No sábado, o jantar é a refeição livre...")
  const s = semAcento(todo);
  const objetivo = /recomposi|defini/.test(s) ? 'manter' : /emagrec|perda de peso|deficit/.test(s) ? 'emagrecer' : /hipertrofi|ganho de massa|ganhar massa/.test(s) ? 'ganhar' : null;
  const dieta = (refeicoes || []).map((r) => `${r.hora ? r.hora + ' ' : ''}${r.nome}:`).join('\n');
  return {
    treino: '', dieta,
    extras: { cardapio, metasPlano, dietaNotas: notas, ...(objetivo ? { objetivoPlano: objetivo } : {}) },
    resumo: `cardápio de ${datas.length} dias (${datas[0] ? datas[0].slice(8) + '/' + datas[0].slice(5, 7) : ''} a ${datas.at(-1) ? datas.at(-1).slice(8) + '/' + datas.at(-1).slice(5, 7) : ''}), ${metasPlano.length} período(s) de metas e ${notas.length} regras`,
  };
}

// Modelos de arquivos conhecidos (a partir do primeiro arquivo real de cada pessoa).
// Cada um: { nome, reconhece(texto, linhas) → bool, montar(linhas) → { treino, dieta, extras?, resumo? } }.
const MODELOS = [
  {
    nome: 'Dieta com cardápio por dia',
    reconhece: (todo, linhas) => !!linhas.pdf && /total do dia/i.test(todo) && /caf[eé] da manh[aã]/i.test(todo) && linhas.some((c) => DIA_LINHA.test(c[0] || '')),
    montar: modeloDietaSemanal,
  },
];

export function montarPlano(linhas) {
  const todo = linhas.map((c) => c.join(' ')).join('\n');
  const modelo = MODELOS.find((m) => m.reconhece(todo, linhas));
  if (modelo) return { ...modelo.montar(linhas), modelo: modelo.nome };

  const treino = [], dieta = [], treinoNotas = [];
  // "Descanso de 60 a 90 s entre as séries" vale para as tabelas sem coluna de descanso
  const dp = semAcento(todo).match(/descanso\s+de\s+(\d+)\s*(?:a|-)\s*(\d+)\s*s/) || semAcento(todo).match(/descanso\s+de\s+(\d+)()\s*s/);
  const descPadrao = dp ? [Number(dp[1]), Number(dp[2] || dp[1])] : null;
  let modo = null, tabela = null, refeicaoAberta = false;
  for (const cel of linhas) {
    if (!cel.length) { tabela = null; continue; }
    const texto = cel.join(cel.length > 1 ? ' – ' : '');
    const s = semAcento(texto);
    if (LIXO.test(s)) continue;

    const cab = cabecalhoTreino(cel);
    if (cab && cel.length > 1) { tabela = cab; modo = 'treino'; continue; }
    if (tabela && cel.length > 1) { const l = linhaDaTabela(cel, tabela, descPadrao); if (l) treino.push(l); continue; }
    tabela = null;

    const nomeTreino = cabecalhoTreinoNome(texto);
    if (nomeTreino) { modo = 'treino'; treino.push('', nomeTreino); continue; }
    // Antes do primeiro treino, marcadores e textos longos são orientações, não exercícios
    if (modo === 'treino' && !treino.some((l) => l.startsWith('TREINO')) && !/\d+\s*[x×]\s*\d/.test(normalizarExercicio(texto))) {
      if (/^[•·▪*-]\s/.test(texto) || texto.length > 70) treinoNotas.push(texto.replace(/^[•·▪*-]\s*/, ''));
      else if (/^[a-zà-ú]/.test(texto) && treinoNotas.length) treinoNotas[treinoNotas.length - 1] += ` ${texto}`; // continuação da frase
      continue;
    }

    const ehRefeicao = REFEICAO.test(s) && texto.length <= 70;
    if (ehRefeicao) {
      modo = 'dieta';
      const h = hora(texto);
      const nome = texto.replace(/\(?\s*(?:as\s*|às\s*)?\b\d{1,2}\s*(?:[:h]\s*\d{2}|h)\b\s*\)?/i, '').replace(/^[\s\-–•:|]+|[\s\-–•:|]+$/g, '');
      // "Almoço: arroz, feijão" na mesma linha
      const [n, ...depois] = nome.split(/\s*:\s*/);
      dieta.push(`${h ? h + ' ' : ''}${n}:${depois.length ? ' ' + depois.join(': ').replace(/,\s*/g, '; ') : ''}`);
      refeicaoAberta = true;
      continue;
    }
    if (SECAO_DIETA.test(s) && texto.length < 50) { modo = 'dieta'; refeicaoAberta = false; continue; }
    if (SECAO_TREINO.test(s) && texto.length < 50 && !/\d\s*x\s*\d/.test(s)) { modo = 'treino'; continue; }

    const ex = normalizarExercicio(texto.replace(/ – /g, ' '));
    if (/\d+\s*[x×]\s*(\d|falha|max)/i.test(ex)) { modo = 'treino'; treino.push(ex.replace(/^[\s•*\-–]+/, '')); continue; }

    if (modo === 'treino') treino.push(ex.replace(/^[\s•*\-–]+/, ''));
    else if (modo === 'dieta' && refeicaoAberta) dieta.push('- ' + texto.replace(/^[\s•*\-–]+/, ''));
  }
  return {
    treino: treino.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trim(),
    dieta: dieta.join('\n').trim(),
    extras: treinoNotas.length ? { treinoNotas } : {},
    modelo: null,
  };
}

export const textoOriginal = (linhas) => linhas.map((c) => c.join('  |  ')).filter(Boolean).join('\n');
