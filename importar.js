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
  for (let n = 1; n <= doc.numPages; n++) {
    const pag = await doc.getPage(n);
    const { items } = await pag.getTextContent();
    // Agrupa os pedaços pela altura (y) e ordena da esquerda para a direita.
    const grupos = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5], alt = Math.abs(it.transform[3]) || 10;
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

function linhaDaTabela(cel, col) {
  const pega = (i) => (i >= 0 ? cel[i] || '' : '');
  const nome = pega(col.nome);
  if (!nome) return '';
  const series = pega(col.series).match(/\d+/)?.[0];
  const reps = pega(col.reps).replace(/\s*(a|–)\s*/g, '-').replace(/\s*rep[a-zà-ú]*/i, '').replace(/\s+/g, '');
  let t = nome;
  // Coluna única "Séries x Reps" com "4x12"
  const junto = [pega(col.series), pega(col.reps)].find((v) => /\d\s*[x×]\s*(\d|falha|max)/i.test(v));
  if (junto) t += ` ${junto.replace(/\s+/g, '').replace(/×/g, 'x')}`;
  else if (series && reps) t += ` ${series}x${reps}`;
  else if (series) t += ` ${series}x${pega(col.series).replace(/^\d+\s*x?\s*/i, '') || '10'}`;
  else if (reps) t += ` ${/x/i.test(reps) ? reps : '3x' + reps}`;
  const d = col.desc >= 0 ? descansoSeg(pega(col.desc)) : null;
  if (d) t += ` ${d}s`;
  const obs = pega(col.obs);
  if (obs) t += ` (${obs.replace(/[()]/g, '')})`;
  return t;
}

function cabecalhoTreinoNome(t) {
  const s = semAcento(t);
  // "Treino A", "Ficha B - Costas", "Dia 1", "Segunda-feira: Peito"
  const m = t.match(/^\s*(?:treino|ficha|dia)\s+([a-z]|\d{1,2})\b\s*[:\-–]?\s*(.*)$/i)
    || (t.length < 60 && !/\d\s*[x×]\s*\d/.test(t) && t.match(/^\s*(?:treino|ficha)\s+()(.+)$/i));
  const dias = [...s.matchAll(/\b(dom|seg|ter|qua|qui|sex|sab)(?:ingo|unda|ca|rta|nta|ta|ado)?(?:-feira)?\b/g)].map((x) => DIAS[x[1]]);
  if (m) {
    let resto = m[2].replace(/\(([^)]*)\)/, '').replace(/[|@].*$/, '').replace(/^[:\-–\s]+|[:\-–\s]+$/g, '').trim();
    if (!m[1]) {
      // "Ficha de treino" é título de seção, não um treino.
      if (/^(de\s+)?(treino|musculacao|exercicios?)\b/.test(semAcento(resto))) return null;
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

// Modelos de arquivos conhecidos (a partir do primeiro arquivo real de cada pessoa).
// Cada um: { nome, reconhece(textoTodo) → bool, montar(linhas) → { treino, dieta } }.
const MODELOS = [];

export function montarPlano(linhas) {
  const todo = linhas.map((c) => c.join(' ')).join('\n');
  const modelo = MODELOS.find((m) => m.reconhece(todo));
  if (modelo) return { ...modelo.montar(linhas), modelo: modelo.nome };

  const treino = [], dieta = [];
  let modo = null, tabela = null, refeicaoAberta = false;
  for (const cel of linhas) {
    if (!cel.length) { tabela = null; continue; }
    const texto = cel.join(cel.length > 1 ? ' – ' : '');
    const s = semAcento(texto);
    if (LIXO.test(s)) continue;

    const cab = cabecalhoTreino(cel);
    if (cab && cel.length > 1) { tabela = cab; modo = 'treino'; continue; }
    if (tabela && cel.length > 1) { const l = linhaDaTabela(cel, tabela); if (l) treino.push(l); continue; }
    tabela = null;

    const nomeTreino = cabecalhoTreinoNome(texto);
    if (nomeTreino) { modo = 'treino'; treino.push('', nomeTreino); continue; }

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
    modelo: null,
  };
}

export const textoOriginal = (linhas) => linhas.map((c) => c.join('  |  ')).filter(Boolean).join('\n');
