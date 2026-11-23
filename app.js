import { criarStore, modoLocal, CONVITE_MIN, ENTRADA_DIAS } from './store.js?v=0.4';
import * as C from './calc.js?v=0.4';

const VERSAO = '0.4';
const MAX_PARCEIROS = 5;
const DIAS_EDITAVEIS = 2; // dá para corrigir até anteontem
const JANELA_MAPA = 60; // dias publicados no perfil para a dupla

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
const num = (v) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v || 0);
const ehObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function mesclar(a, b) {
  const out = { ...(ehObj(a) ? a : {}) };
  for (const [k, v] of Object.entries(b)) out[k] = ehObj(v) && ehObj(out[k]) ? mesclar(out[k], v) : v;
  return out;
}

// ---------------- Estado ----------------
let store;
let usuario = null;
let uid = null;
let tela = 'hoje';
let dataSel = C.hoje();
let mesSel = C.hoje().slice(0, 7);
let syncStatus = '';
const D = { perfil: undefined, prefs: {}, plano: null, dias: [], pesos: [], fotos: [], checkins: [], ckJanela: [], comidas: [], desafios: [] };
const P = {}; // parceiros: { [uid]: { perfil, dias, fotos, checkins, paradas } }
const DS = {}; // desafio aberto: { [id]: { checkins, parada } }
const fotosDesafio = {}; // { [checkinId]: [dataURL] | 'carregando' }
let aba = 'placar'; // tela "Juntos": placar | desafios | dupla
let desafioSel = null;
let checkinPendente = null; // abrir o check-in assim que os dados chegarem (link ou compartilhamento)
let paradas = [];
let paradaFotos = null;
let parceirosAssinados = '';
let ultimoPublicado = '';

const prefs = () => ({ metaRefeicoes: 80, metaAgua: 2500, descanso: 90, ...D.prefs });
const diaDoc = (d) => D.dias.find((x) => x.id === d);
const editavel = (d) => d <= C.hoje() && d >= C.somarDias(C.hoje(), -DIAS_EDITAVEIS);
const inicio = () => C.inicioEfetivo(D.perfil?.inicio);
const primeiroNome = (n) => String(n || '').split(' ')[0] || 'você';

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------------- Inicialização ----------------
async function iniciar() {
  store = await criarStore();
  if (modoLocal) {
    $('#btn-login').classList.add('hidden');
    const box = $('#login-local');
    box.classList.remove('hidden');
    box.innerHTML = Object.entries(store.contasTeste).map(([k, c]) => `<button class="btn ${k === 'eu' ? 'primary' : ''} big" data-conta="${k}">Entrar como ${esc(c.displayName)}</button>`).join('')
      + '<p class="aviso">Modo local de teste: os dados ficam só neste navegador. Para testar a dupla, abra outra aba e entre com a outra conta.</p>';
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-conta]'); if (b) store.entrar(b.dataset.conta); });
  }
  $('#btn-login').addEventListener('click', async () => {
    $('#login-erro').textContent = '';
    try { await store.entrar(); } catch (e) { $('#login-erro').textContent = 'Não foi possível entrar: ' + (e.code || e.message); }
  });
  ligarEventos();
  await store.init((u) => { usuario = u; uid = u ? u.uid : null; u ? mostrarApp() : mostrarLogin(); });
  store.assinarStatus((s) => { syncStatus = s; });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

function pararTudo() {
  paradas.forEach((f) => f()); paradas = [];
  if (paradaFotos) paradaFotos(); paradaFotos = null;
  if (paradaJanela) paradaJanela(); paradaJanela = null; janelaIni = '';
  for (const k of Object.keys(P)) { P[k].paradas.forEach((f) => f()); delete P[k]; }
  for (const k of Object.keys(DS)) { DS[k].parada(); delete DS[k]; }
  Object.keys(pontosPublicados).forEach((k) => delete pontosPublicados[k]);
  parceirosAssinados = '';
}

function mostrarLogin() {
  pararTudo();
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

function mostrarApp() {
  pararTudo();
  Object.assign(D, { perfil: undefined, prefs: {}, plano: null, dias: [], pesos: [], fotos: [], checkins: [], ckJanela: [], comidas: [], desafios: [] });
  ultimoPublicado = '';
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#avatar').innerHTML = avatarInner(usuario.photoURL, usuario.displayName);
  paradas = [
    store.assinarDoc(['perfis', uid], (p) => {
      const antes = D.perfil?.parceiros || [];
      D.perfil = p;
      if (!p) {
        // Primeiro acesso: cria o perfil e começa a ofensiva hoje.
        store.definir(['perfis', uid], { nome: usuario.displayName || 'Sem nome', foto: usuario.photoURL || '', inicio: C.hoje(), parceiros: [] });
        return;
      }
      const novos = (p.parceiros || []).filter((x) => !antes.includes(x));
      if (antes.length && novos.length) toast('🤝 Alguém entrou na sua dupla!');
      if (novos.length && $('#modal-corpo [data-esperando-dupla]')) fecharModal();
      assinarParceiros();
      avisarCutucada();
      agendarRender();
    }),
    store.assinarDoc(['usuarios', uid, 'config', 'prefs'], (p) => { D.prefs = p || {}; agendarRender(); }),
    store.assinarDoc(['usuarios', uid, 'config', 'plano'], (p) => { D.plano = p; agendarRender(); }),
    store.assinarCol(['feed', uid, 'dias'], (l) => { D.dias = l; agendarRender(); }),
    store.assinarCol(['usuarios', uid, 'pesos'], (l) => { D.pesos = l.sort((a, b) => (a.id < b.id ? -1 : 1)); agendarRender(); }),
    store.assinarCol(['desafios'], (l) => { D.desafios = l.sort((a, b) => (a.inicio < b.inicio ? 1 : -1)); sincronizarDesafios(); agendarRender(); }, ['membros', 'array-contains', uid]),
  ];
  assinarFotos();
  const q = new URLSearchParams(location.search);
  const acao = q.get('acao');
  if (acao === 'treino') tela = 'treino';
  else if (acao === 'dupla') { tela = 'dupla'; aba = 'dupla'; } else if (acao === 'desafios') { tela = 'dupla'; aba = 'desafios'; } else if (acao === 'checkin') {
    // Link de atalho (iPhone: app Atalhos) ou compartilhamento do Samsung Health / Apple Fitness.
    const pre = C.lerResumoTreino(q.get('texto') || '');
    for (const [k, campo] of [['min', 'minutos'], ['kcal', 'kcal'], ['km', 'km']]) if (q.get(k)) pre[campo] = Number(String(q.get(k)).replace(',', '.')) || undefined;
    if (q.get('tipo')) Object.assign(pre, { tipo: C.lerResumoTreino(q.get('tipo')).tipo || 'outro', titulo: pre.titulo || q.get('tipo') });
    if (q.get('titulo')) pre.titulo = q.get('titulo');
    if (q.get('fonte')) pre.fonte = q.get('fonte');
    checkinPendente = { pre, compartilhado: q.has('compartilhado') };
  }
  if (acao) history.replaceState(null, '', location.pathname);
  agendarRender();
}

function assinarFotos() {
  if (paradaFotos) paradaFotos();
  const d = dataSel;
  const a = store.assinarCol(['feed', uid, 'fotos'], (l) => { D.fotos = l.filter((f) => f.data === d); agendarRender(); }, ['data', '==', d]);
  paradaFotos = a;
  assinarJanela();
  filtrarDia();
}

// Check-ins e comidas dos últimos dias (para o Placar do dia e a rodada da semana).
let janelaIni = '';
let paradaJanela = null;
function assinarJanela() {
  const ini = [C.somarDias(C.hoje(), -8), dataSel].sort()[0];
  if (paradaJanela && janelaIni <= ini) return;
  if (paradaJanela) paradaJanela();
  janelaIni = ini;
  const a = store.assinarCol(['feed', uid, 'checkins'], (l) => { D.ckJanela = l.sort((x, y) => x.em - y.em); filtrarDia(); agendarRender(); }, ['data', '>=', ini]);
  const b = store.assinarCol(['feed', uid, 'comidas'], (l) => { D.comidas = l.sort((x, y) => x.em - y.em); agendarRender(); }, ['data', '>=', ini]);
  paradaJanela = () => { a(); b(); };
}
function filtrarDia() { D.checkins = D.ckJanela.filter((f) => f.data === dataSel); }

// Fotos dos check-ins do desafio: carrega só as que aparecem na tela.
function fotosDoCheckin(dId, c) {
  if (c.uid === uid) { const meu = D.checkins.find((x) => x.id === c.id); if (meu) return meu.fotos || []; }
  const f = fotosDesafio[c.id];
  if (Array.isArray(f)) return f;
  if (!f && c.nFotos) {
    fotosDesafio[c.id] = 'carregando';
    store.lerDoc(['desafios', dId, 'fotos', c.id]).then((x) => { fotosDesafio[c.id] = x?.fotos || []; agendarRender(); })
      .catch(() => { fotosDesafio[c.id] = []; });
  }
  return [];
}

function assinarParceiros() {
  const lista = (D.perfil?.parceiros || []).filter((x) => x !== uid).slice(0, MAX_PARCEIROS);
  const chave = lista.join(',');
  if (chave === parceirosAssinados) return;
  parceirosAssinados = chave;
  for (const k of Object.keys(P)) if (!lista.includes(k)) { P[k].paradas.forEach((f) => f()); delete P[k]; }
  const h = C.hoje();
  for (const p of lista) {
    if (P[p]) continue;
    const o = P[p] = { perfil: null, dias: [], fotos: [], checkins: [], paradas: [] };
    o.paradas.push(
      store.assinarDoc(['perfis', p], (x) => { o.perfil = x; agendarRender(); }),
      store.assinarCol(['feed', p, 'dias'], (l) => { o.dias = l; agendarRender(); }),
      store.assinarCol(['feed', p, 'fotos'], (l) => { o.fotos = l.filter((f) => f.data === h); agendarRender(); }, ['data', '==', h]),
      store.assinarCol(['feed', p, 'checkins'], (l) => { o.checkins = l.filter((f) => f.data === h).sort((a, b) => a.em - b.em); agendarRender(); }, ['data', '==', h]),
    );
  }
}

function avisarCutucada() {
  const c = D.perfil?.cutucada;
  if (!c || !c.em) return;
  const visto = Number(localStorage.getItem('fit-cutucada-vista') || 0);
  if (c.em > visto && Date.now() - c.em < 6 * 3600000 && !avisarCutucada.mostrada?.has(c.em)) {
    (avisarCutucada.mostrada ||= new Set()).add(c.em);
    toast(`👉 ${primeiroNome(c.nome)} te cutucou: ${c.msg || 'bora!'}`, 4000);
    if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
  }
}

const avatarInner = (foto, nome) => (foto
  ? `<img src="${esc(foto)}" alt="" referrerpolicy="no-referrer">`
  : esc(((nome || '?')[0]).toUpperCase()));
const avatarHTML = (foto, nome) => `<span class="avatar">${avatarInner(foto, nome)}</span>`;

// ---------------- Cálculos com os dados ----------------
function avaliar(d) { return C.avaliarDia(D.plano, d, diaDoc(d), prefs()); }

// Para dias passados vale o que foi gravado no dia (o plano pode ter mudado depois).
function cumpridoEm(d) {
  const doc = diaDoc(d);
  if (doc && typeof doc.cumprido === 'boolean' && d < C.hoje()) return doc.cumprido;
  return avaliar(d).cumprido;
}

let cacheOfensiva = null;
function minhaOfensiva() {
  const chave = JSON.stringify([inicio(), C.hoje(), D.dias.map((x) => [x.id, x.atualizado]), D.plano?.atualizado, D.prefs]);
  if (cacheOfensiva?.chave !== chave) cacheOfensiva = { chave, v: C.calcularOfensiva(inicio(), cumpridoEm) };
  return cacheOfensiva.v;
}

function mapaRecente(mapa) {
  const corte = C.somarDias(C.hoje(), -JANELA_MAPA);
  return Object.fromEntries(Object.entries(mapa).filter(([d]) => d >= corte));
}

// Mapa do parceiro com os dias que ele ainda não sincronizou marcados como "sem dados".
function mapaParceiro(pf) {
  const h = C.hoje();
  const mapa = { ...(pf?.mapa || {}) };
  const ate = pf?.atualizado || '';
  for (const d of C.diasEntre(C.somarDias(h, -JANELA_MAPA), h)) {
    if (d < C.inicioEfetivo(pf?.inicio)) continue;
    if (!mapa[d] || (mapa[d] === 'pendente' && d < h)) mapa[d] = d >= ate ? 'semdados' : 'falhou';
  }
  return mapa;
}

function ofensivaComParceiro(pf) {
  const meu = minhaOfensiva().mapa;
  const dele = mapaParceiro(pf);
  const ini = [inicio(), C.inicioEfetivo(pf?.inicio), C.somarDias(C.hoje(), -JANELA_MAPA + 1)].sort().at(-1);
  const neutro = Object.fromEntries(Object.entries(dele).map(([d, v]) => [d, v === 'semdados' ? 'gelo' : v]));
  return C.ofensivaDupla(ini, meu, neutro);
}

// ---------------- Placar do dia ----------------
const metas = () => C.calcularMetas(prefs().corpo || {}, D.pesos.at(-1)?.kg);
const comidasDe = (d) => D.comidas.filter((x) => x.data === d);

function pontosDe(d) {
  const dia = diaDoc(d) || {};
  const av = avaliar(d);
  av.progressoTreino = C.progressoTreino(C.treinoDoDia(D.plano, d, dia), dia);
  return C.pontosDia({ m: metas(), comidas: comidasDe(d), av, dia, checkins: D.ckJanela.filter((x) => x.data === d), metaAgua: prefs().metaAgua });
}

// Grava no registro do dia os pontos e as notas das refeições (a dupla vê) e,
// nos desafios por pontos, o total do dia. Só grava quando muda.
const pontosPublicados = {};
function publicarPontos() {
  if (!D.perfil || !uid) return;
  const h = C.hoje();
  for (let n = 0; n <= DIAS_EDITAVEIS; n++) {
    const d = C.somarDias(h, -n);
    if (d < janelaIni) continue;
    const p = pontosDe(d);
    const doc = diaDoc(d);
    if (!doc && !p.total) continue;
    const dados = {
      pontos: { total: p.total, cats: p.cats, equilibrio: p.equilibrio },
      notasRef: p.notas.map((x) => ({ grupo: x.grupo, nome: x.nome, nota: x.nota, kcal: Math.round(x.kcal), motivos: x.motivos })),
    };
    const s = JSON.stringify(dados);
    if (s !== pontosPublicados[d] && s !== JSON.stringify({ pontos: doc?.pontos, notasRef: doc?.notasRef })) {
      pontosPublicados[d] = s;
      store.definir(['feed', uid, 'dias', d], { ...dados, data: d }, true);
    }
    for (const x of D.desafios) {
      if (x.criterio !== 'pontos' || d < x.inicio || d > x.fim) continue;
      const meu = (DS[x.id]?.pontos || []).find((y) => y.uid === uid);
      const chave = `${x.id}/${d}`;
      if (meu?.dias?.[d] === p.total || pontosPublicados[chave] === p.total) continue;
      pontosPublicados[chave] = p.total;
      store.definir(['desafios', x.id, 'pontos', uid], { uid, dias: { [d]: p.total } }, true);
    }
  }
}

// Publica no perfil o resumo que a dupla vê (só grava quando muda).
function publicarResumo() {
  if (!D.perfil || !uid) return;
  const of = minhaOfensiva();
  const av = avaliar(C.hoje());
  const resumo = {
    nome: usuario.displayName || D.perfil.nome || 'Sem nome',
    foto: usuario.photoURL || '',
    atualizado: C.hoje(),
    ofensiva: { atual: of.atual, recorde: of.recorde, gelo: of.gelo },
    mapa: mapaRecente(of.mapa),
    hoje: { progresso: Math.round(av.progresso * 100), cumprido: av.cumprido },
    objetivo: metas().objetivo,
  };
  const s = JSON.stringify(resumo);
  const atual = JSON.stringify(Object.fromEntries(Object.keys(resumo).map((k) => [k, D.perfil[k]])));
  if (s === atual || s === ultimoPublicado) return;
  ultimoPublicado = s;
  // Substitui os campos por inteiro (um merge manteria dias antigos do mapa).
  store.substituirCampos(['perfis', uid], resumo);
}

// ---------------- Gravar o dia ----------------
function salvarDia(d, patch) {
  if (!editavel(d)) { toast('Esse dia já fechou. Dá para editar até anteontem.'); return; }
  const atual = diaDoc(d) || { id: d };
  const novo = mesclar(atual, patch);
  const treino = C.treinoDoDia(D.plano, d, novo);
  const av = C.avaliarDia(D.plano, d, novo, prefs());
  const extra = {
    data: d,
    cumprido: av.cumprido,
    progresso: Math.round(av.progresso * 100),
    prev: {
      treino: treino ? { id: treino.id, nome: treino.nome, total: treino.exercicios.reduce((a, e) => a + (e.series || 1), 0) } : null,
      refeicoes: (D.plano?.refeicoes || []).map((r) => ({ id: r.id, nome: r.nome, hora: r.hora })),
      metaAgua: prefs().metaAgua,
    },
    atualizado: Date.now(),
  };
  // Atualiza na hora (o Firestore confirma depois) para a tela não piscar.
  const i = D.dias.findIndex((x) => x.id === d);
  const local = { ...novo, ...extra, id: d };
  if (i >= 0) D.dias[i] = local; else D.dias.push(local);
  store.definir(['feed', uid, 'dias', d], { ...patch, ...extra }, true);
  agendarRender();
}

// ---------------- Render ----------------
let renderPendente = false;
let renderAdiado = false;
function agendarRender() {
  if (renderPendente) return;
  renderPendente = true;
  requestAnimationFrame(() => {
    renderPendente = false;
    // Não redesenha enquanto a pessoa digita (perderia o foco).
    const ae = document.activeElement;
    if (ae && ae.matches && ae.matches('main input, main textarea')) { renderAdiado = true; return; }
    render();
  });
}
document.addEventListener('focusout', () => { if (renderAdiado) { renderAdiado = false; setTimeout(agendarRender, 30); } });

function render() {
  if (!usuario || D.perfil === undefined) { $('#conteudo').innerHTML = '<div class="vazio g" style="margin-top:30px">Carregando…</div>'; return; }
  publicarResumo();
  publicarPontos();
  const of = minhaOfensiva();
  $('#fogo-n').textContent = of.atual;
  $('#fogo').classList.toggle('on', of.hojeOk);
  $('#dia-pill').style.visibility = ['hoje', 'treino', 'comer'].includes(tela) ? 'visible' : 'hidden';
  $('#dia-label').textContent = rotuloCurto(dataSel);
  $('#dia-prox').disabled = dataSel >= C.somarDias(C.hoje(), 6);
  $$('.dock button[data-tela]').forEach((b) => b.classList.toggle('active', b.dataset.tela === ({ treino: 'hoje', desafio: 'dupla' }[tela] || tela)));
  const fn = { hoje: telaHoje, treino: telaTreino, comer: telaComer, dupla: telaJuntos, desafio: telaDesafio, progresso: telaProgresso, plano: telaPlano, perfil: telaPerfil }[tela] || telaHoje;
  const y = window.scrollY;
  $('#conteudo').innerHTML = fn();
  window.scrollTo(0, y);
  if (checkinPendente && $('#modal').classList.contains('hidden')) {
    const { pre, compartilhado } = checkinPendente; checkinPendente = null;
    (compartilhado ? lerCompartilhado() : Promise.resolve({ arquivos: [], texto: '' })).then(async ({ arquivos, texto }) => {
      const doTexto = C.lerResumoTreino(texto);
      const fotos = [];
      for (const f of arquivos.slice(0, 2)) { try { fotos.push(await comprimir(f)); } catch (e) { /* ignora */ } }
      dataSel = C.hoje(); assinarFotos();
      modalCheckin({ ...doTexto, ...pre, fotos });
    }).catch((e) => { console.error(e); toast('Não foi possível abrir o check-in.'); });
  }
}

// Arquivos e texto que chegaram pelo "Compartilhar" do celular (o sw.js guarda no cache).
async function lerCompartilhado() {
  const out = { arquivos: [], texto: '' };
  try {
    const c = await caches.open('folego-compartilhado');
    for (const req of await c.keys()) {
      const r = await c.match(req);
      if (req.url.endsWith('/texto')) { const j = await r.json(); out.texto = [j.title, j.text, j.url].filter(Boolean).join('\n'); } else out.arquivos.push(new File([await r.blob()], 'compartilhado', { type: r.headers.get('content-type') || 'image/jpeg' }));
      await c.delete(req);
    }
  } catch (e) { /* sem cache */ }
  return out;
}

const ringHTML = (pct, centro, ok) => {
  const r = 42, c = 2 * Math.PI * r;
  return `<div class="ring-dia ${ok ? 'ok' : ''}"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="${r}"/><circle class="fg" cx="50" cy="50" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(1, pct))}"/></svg><div class="c">${centro}</div></div>`;
};

const seriesTxt = (e) => (e.series > 1 && e.reps ? `${e.series} × ${e.reps}` : e.series > 1 ? `${e.series} séries` : e.reps);

function rotuloCurto(d) {
  const r = C.rotuloDia(d);
  if (!r.includes(',')) return r;
  const x = C.paraData(d);
  return `${C.SEMANA[x.getDay()][0].toUpperCase()}${C.SEMANA[x.getDay()].slice(1)}, ${x.getDate()}/${x.getMonth() + 1}`;
}

function saudacao() {
  const h = new Date().getHours();
  return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

// ---------- Hoje ----------
function telaHoje() {
  const d = dataSel;
  const h = C.hoje();
  const plano = D.plano;
  const dia = diaDoc(d) || {};
  const av = avaliar(d);
  const of = minhaOfensiva();
  const ed = editavel(d);
  const futuro = d > h;
  let html = '';

  const titulo = d === h ? `${saudacao()}, ${esc(primeiroNome(usuario.displayName))}` : esc(C.rotuloDia(d));
  let sub;
  if (!plano) sub = 'Monte seu plano de treino e dieta para começar a ofensiva.';
  else if (futuro) sub = 'Prévia do plano deste dia.';
  else if (av.cumprido) sub = d === h ? `Dia cumprido! 🔥 Ofensiva de ${plural(of.atual, 'dia', 'dias')}.` : 'Dia cumprido ✓';
  else {
    const falta = [];
    if (av.temTreino && !dia.treinoFeito) falta.push('o treino');
    const precisa = Math.ceil(av.total * prefs().metaRefeicoes / 100) - av.feitas;
    if (precisa > 0) falta.push(plural(precisa, 'refeição', 'refeições'));
    sub = (d === h ? 'Para cumprir o dia falta ' : 'Faltou ') + falta.join(' e ') + '.';
    if (!ed && d < h) sub += ' (já fechou)';
  }
  if (plano && inicio() > h && d <= h) sub = `Dia de teste: a ofensiva começa ${inicio() === C.somarDias(h, 1) ? 'amanhã' : 'em ' + esc(C.paraData(inicio()).toLocaleDateString('pt-BR'))}. Hoje não conta. 😉`;
  const pct = Math.round(av.progresso * 100);
  html += `<div class="hoje-hero fade-in"><div class="txt"><div class="ola">${titulo}</div><div class="sub">${sub}</div></div>${plano && !futuro ? ringHTML(av.progresso, `${av.cumprido ? '✓' : pct + '%'}<small>${av.cumprido ? 'cumprido' : 'do dia'}</small>`, av.cumprido) : ''}</div>`;

  if (!futuro) html += cartaoPlacar(d);

  // Cutucada e reações recebidas
  const c = D.perfil?.cutucada;
  if (d === h && c && c.em > Number(localStorage.getItem('fit-cutucada-vista') || 0) && Date.now() - c.em < 12 * 3600000) {
    html += `<div class="banner g"><span class="e">👉</span><div class="info"><b>${esc(primeiroNome(c.nome))} te cutucou</b><small>${esc(c.msg || 'Bora cumprir o dia!')}</small></div><button class="link" data-a="cutucada-ok">Ok</button></div>`;
  }
  const reac = Object.entries(dia.reacoes || {}).filter(([u]) => u !== uid);
  if (reac.length) {
    const nomes = reac.map(([u, e]) => `${esc(primeiroNome(P[u]?.perfil?.nome || 'Sua dupla'))} ${esc(e)}`).join(' · ');
    html += `<div class="banner g" style="box-shadow: inset 3px 0 0 var(--lime)"><span class="e">💬</span><div class="info"><b>Reagiram ao seu dia</b><small>${nomes}</small></div></div>`;
  }

  if (!plano) {
    html += `<div class="vazio g"><span class="big">📋</span>Ainda não há plano.<br>Cole o treino e a dieta (os que o Claude montou, por exemplo) e o app organiza o seu dia.<div class="acoes"><button class="btn lime" data-a="editar-plano">Montar meu plano</button></div></div>`;
    if (!futuro) html += secaoCheckins(d, ed);
    return html;
  }

  // Treino
  const treino = C.treinoDoDia(plano, d, dia);
  if (treino) {
    const prog = C.progressoTreino(treino, dia);
    const nEx = treino.exercicios.length;
    html += `<div class="treino-card g ${dia.treinoFeito ? 'feito' : ''}">
      <div class="lbl">🏋️ Treino ${d === h ? 'de hoje' : 'do dia'}</div>
      <div class="nome">${esc(treino.nome)}</div>
      <div class="m">${plural(nEx, 'exercício', 'exercícios')}${prog > 0 && !dia.treinoFeito ? ` · ${Math.round(prog * 100)}% feito` : ''}${dia.treinoFeito ? ' · concluído' : ''}</div>
      <div class="ex-mini">${treino.exercicios.slice(0, 6).map((e) => `<span>${esc(e.nome)}</span>`).join('')}${nEx > 6 ? `<span>+${nEx - 6}</span>` : ''}</div>
      ${futuro ? '' : `<div class="acoes">
        ${ed ? `<button class="btn ${dia.treinoFeito ? '' : 'lime'}" data-a="ir" data-id="treino">${dia.treinoFeito ? 'Ver treino' : prog > 0 ? 'Continuar' : 'Começar treino'}</button>
        ${dia.treinoFeito ? '<button class="btn" data-a="treino-desfazer">Desmarcar</button>' : '<button class="btn" data-a="treino-feito" title="Marcar como feito sem anotar as cargas">Já fiz ✓</button>'}` : '<button class="btn" data-a="ir" data-id="treino">Ver treino</button>'}
      </div>`}
      ${ed && !dia.treinoFeito && plano.treinos.length > 1 ? '<button class="link" style="margin-top:12px;position:relative" data-a="trocar-treino">Trocar o treino do dia</button>' : ''}
    </div>`;
  } else {
    html += `<div class="treino-card g"><div class="lbl">🏋️ Treino</div><div class="nome">Dia de descanso 😌</div><div class="m">Sem treino na agenda. Hidrate-se e siga a dieta.</div>
      ${ed && plano.treinos.length ? '<button class="link" style="margin-top:12px;position:relative" data-a="trocar-treino">Treinar mesmo assim</button>' : ''}</div>`;
  }
  if (!futuro) html += secaoCheckins(d, ed);

  // Refeições
  const refs = plano.refeicoes || [];
  if (refs.length) {
    const st = dia.refeicoes || {};
    html += `<div class="sec"><div class="sec-h"><h3>🍽️ Refeições</h3><span class="tag ${av.refeicoesOk ? 'green' : 'amber'}">${av.feitas}/${refs.length} · meta ${prefs().metaRefeicoes}%</span></div><div class="list g">`;
    for (const r of refs) {
      const s = st[r.id];
      const fotos = D.fotos.filter((f) => f.refeicaoId === r.id);
      const nota = (dia.notas || {})[r.id];
      html += `<div class="ref ${s || ''}">
        <div class="hora">${esc(r.hora)}</div>
        <div class="info">
          <div class="t">${esc(r.nome)}</div>
          ${r.itens.length ? `<div class="itens">${r.itens.map(esc).join(' · ')}</div>` : ''}
          ${nota ? `<div class="nota-ref">🔄 ${esc(nota)}</div>` : ''}
          ${fotos.length ? `<div class="fotos">${fotos.map((f) => `<img src="${f.img}" alt="" data-a="ver-foto" data-id="${f.id}">`).join('')}</div>` : ''}
          ${ed ? `<div class="st3">
            <button data-a="ref" data-id="${r.id}" data-v="ok" class="${s === 'ok' ? 'on' : ''}">✅ Segui</button>
            <button data-a="ref" data-id="${r.id}" data-v="troca" class="${s === 'troca' ? 'on' : ''}">🔄 Troquei</button>
            <button data-a="ref" data-id="${r.id}" data-v="pulou" class="${s === 'pulou' ? 'on' : ''}">❌ Pulei</button>
            <button class="cam" data-a="foto" data-id="${r.id}" aria-label="Foto da refeição"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></button>
          </div>` : ''}
        </div></div>`;
    }
    html += '</div></div>';
  }

  // Água
  if (!futuro) {
    const meta = prefs().metaAgua;
    const ag = dia.agua || 0;
    html += `<div class="sec"><div class="agua g">
      <div class="agua-top"><span class="e">💧</span><div class="info"><div class="v">${num(ag / 1000)} L</div><div class="m">meta ${num(meta / 1000)} L</div></div>
      ${ed ? `<div class="agua-btns"><button data-a="agua" data-v="-250" aria-label="Menos 250 ml">−</button><button class="mais" data-a="agua" data-v="250">+ 250 ml</button><button class="mais" data-a="agua" data-v="500">+ 500</button></div>` : ''}</div>
      <div class="barra"><div style="width:${Math.min(100, (ag / meta) * 100)}%"></div></div></div></div>`;
    html += secaoHabitos(d, ed);
  }
  return html;
}

// ---------- Placar do dia ----------
function pontosParceiro(p, d) { return (P[p]?.dias || []).find((x) => x.id === d)?.pontos || null; }

function cartaoPlacar(d) {
  const p = pontosDe(d);
  const rivais = (D.perfil?.parceiros || []).filter((x) => x !== uid && P[x]?.perfil).slice(0, 2)
    .map((x) => `<span class="pl-rival">${avatarHTML(P[x].perfil.foto, P[x].perfil.nome)}<b>${pontosParceiro(x, d)?.total ?? '–'}</b></span>`).join('');
  return `<button class="placar g fade-in" data-a="ver-placar" data-id="${d}">
    <div class="pl-top"><div class="info"><div class="lbl">Placar do dia${p.equilibrio ? ' · <span class="eq">⚖️ equilíbrio +10%</span>' : ''}</div><div class="pl-n">${p.total}<small>/100</small></div></div>${rivais ? `<div class="pl-rivais"><small>vs</small>${rivais}</div>` : ''}</div>
    <div class="pl-cats">${Object.entries(C.PESOS).map(([k, max]) => `<div class="pl-cat"><span>${C.PESOS_NOME[k]}</span><div class="barra"><div style="width:${Math.round((p.cats[k] / max) * 100)}%"></div></div><b>${Math.round(p.cats[k])}<small>/${max}</small></b></div>`).join('')}</div>
  </button>`;
}

function modalPlacar(d) {
  const p = pontosDe(d);
  const m = metas();
  abrirModal(`Placar · ${C.rotuloDia(d)}`, `
    <div class="pl-n" style="text-align:center">${p.total}<small>/100</small></div>
    ${p.dicas.length ? `<div class="aviso"><b>Para subir:</b><br>${p.dicas.map(esc).join('<br>')}</div>` : '<div class="aviso">Dia redondo! 🎯</div>'}
    ${p.notas.length ? `<div class="sec"><div class="sec-h"><h3>Notas das refeições</h3></div><div class="list g">${p.notas.map((x) => `<div class="row"><div class="info"><div class="t">${esc(x.nome)}</div><div class="m">${esc(x.motivos.join(' · '))}</div></div><span class="nota-b ${x.nota >= 7 ? 'boa' : x.nota >= 5 ? 'media' : 'ruim'}">${num(x.nota)}</span></div>`).join('')}</div></div>` : ''}
    <div class="sec"><div class="sec-h"><h3>Como conta</h3></div><p class="ajuda-fmt">
      <b>Alimentação (35)</b>: calorias na faixa do seu objetivo (15), proteína (10) e qualidade das refeições (10). Sem registrar na aba Comer, vale até 70% pelas refeições do plano marcadas.<br>
      <b>Treino (25)</b>: treino do plano ou check-in. Dia de descanso planejado vale 15.<br>
      <b>Cardio (15)</b>: minutos de corrida, caminhada, bike, natação, funcional ou esporte (meta ${m.cardioSemana} min por semana).<br>
      <b>Água (10)</b>: meta de ${num(prefs().metaAgua / 1000)} L.<br>
      <b>Bônus (15)</b>: sono de ${m.sono} h ou mais (6), dia sem álcool (3), 8 mil passos (3), 3 refeições registradas (3).<br>
      Cada meta tem teto e o começo vale mais que o finalzinho. Se todas as quatro primeiras passarem da metade: <b>+10%</b>.<br>
      Seu objetivo: <b>${esc(C.OBJETIVOS[m.objetivo])}</b> · ${m.kcal} kcal · ${m.prot} g de proteína.</p></div>
    <div class="acoes"><button class="btn" data-a="objetivo">Ajustar meu objetivo</button></div>`);
}

function secaoHabitos(d, ed) {
  const dia = diaDoc(d) || {};
  const m = metas();
  const p = pontosDe(d);
  const dis = ed ? '' : 'disabled';
  return `<div class="sec"><div class="sec-h"><h3>😴 Hábitos</h3><span class="tag green">bônus ${Math.round(p.cats.bonus)}/15</span></div><div class="list g">
    <div class="row"><div class="info"><div class="t">Sono</div><div class="m">meta ${m.sono} h</div></div><div class="stepper"><button data-a="habito" data-id="sono" data-v="-0.5" ${dis}>−</button><b>${dia.sono ? num(dia.sono) + ' h' : '–'}</b><button data-a="habito" data-id="sono" data-v="0.5" ${dis}>+</button></div></div>
    <div class="row clic" ${ed ? 'data-a="passos"' : ''}><div class="info"><div class="t">Passos</div><div class="m">8 mil = bônus cheio</div></div><span class="val-d">${dia.passos ? Number(dia.passos).toLocaleString('pt-BR') : 'registrar'}</span>${ed ? '<span class="seta">›</span>' : ''}</div>
    <div class="row"><div class="info"><div class="t">Cardio fora do check-in</div><div class="m">caminhada até o trabalho, escada…</div></div><div class="stepper"><button data-a="habito" data-id="cardioMin" data-v="-10" ${dis}>−</button><b>${dia.cardioMin || 0} min</b><button data-a="habito" data-id="cardioMin" data-v="10" ${dis}>+</button></div></div>
    <div class="row ${ed ? 'clic' : ''}" ${ed ? 'data-a="sem-alcool"' : ''}><div class="info"><div class="t">Dia sem álcool</div></div><span class="sw ${dia.semAlcool ? 'on' : ''}"></span></div>
  </div></div>`;
}

// ---------- Comer ----------
const GRUPOS_PADRAO = [['cafe', 'Café da manhã'], ['lanche-manha', 'Lanche da manhã'], ['almoco', 'Almoço'], ['lanche', 'Lanche da tarde'], ['jantar', 'Jantar'], ['ceia', 'Ceia']];
function gruposRefeicao() {
  const ref = D.plano?.refeicoes || [];
  const g = ref.length ? ref.map((r) => ({ id: r.id, nome: r.nome, hora: r.hora })) : GRUPOS_PADRAO.map(([id, nome]) => ({ id, nome, hora: '' }));
  return [...g, { id: 'extra', nome: 'Extra / beliscos', hora: '' }];
}
// Sugere a refeição pela hora
function grupoAgora() {
  const g = gruposRefeicao().filter((x) => x.hora);
  const agora = new Date().toTimeString().slice(0, 5);
  if (!g.length) { const h = new Date().getHours(); return h < 10 ? 'cafe' : h < 12 ? 'lanche-manha' : h < 15 ? 'almoco' : h < 18 ? 'lanche' : h < 22 ? 'jantar' : 'ceia'; }
  return g.reduce((a, x) => (Math.abs(minutos(x.hora) - minutos(agora)) < Math.abs(minutos(a.hora) - minutos(agora)) ? x : a)).id;
}
const minutos = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

function telaComer() {
  const d = dataSel;
  const ed = editavel(d);
  const m = metas();
  const itens = comidasDe(d);
  const t = C.somarItens(itens);
  const pts = pontosDe(d);
  const notas = Object.fromEntries(pts.notas.map((x) => [x.grupo, x]));
  const falta = m.kcal - t.kcal;
  const barra = (v, meta, nome, cls = '') => `<div class="macro ${cls}"><div class="mh"><span>${nome}</span><b>${Math.round(v)}<small>/${meta} g</small></b></div><div class="barra"><div style="width:${Math.min(100, (v / meta) * 100)}%"></div></div></div>`;
  let html = `<div class="hoje-hero fade-in"><div class="txt"><div class="ola">Comer</div><div class="sub">${itens.length ? (falta >= 0 ? `Cabem ~${Math.round(falta)} kcal ${d === C.hoje() ? 'hoje' : 'neste dia'}.` : `${Math.round(-falta)} kcal acima da meta.`) : 'Registre o que comeu: o app calcula as calorias e dá nota para cada refeição.'}</div></div>
    ${ringHTML(t.kcal / m.kcal, `${Math.round(t.kcal)}<small>de ${m.kcal} kcal</small>`, t.kcal >= m.kcal * 0.9 && t.kcal <= m.kcal * 1.1)}</div>`;
  if (!m.completo) html += `<div class="banner g"><span class="e">🎯</span><div class="info"><b>Defina seu objetivo</b><small>Peso, altura e objetivo para calcular suas metas. Por enquanto uso 2000 kcal.</small></div><button class="link" data-a="objetivo">Definir</button></div>`;
  html += `<div class="card g macros">${barra(t.p, m.prot, 'Proteína', 'mp')}${barra(t.cb, m.carb, 'Carboidrato', 'mc')}${barra(t.g, m.gord, 'Gordura', 'mg')}</div>`;
  if (ed) {
    html += `<div class="acao-grid tres">
      <button data-a="comida-add" data-v="codigo"><span>📷</span><b>Código de barras</b><small>pão, iogurte…</small></button>
      <button data-a="comida-add" data-v="buscar"><span>🔎</span><b>Buscar</b><small>arroz, frango…</small></button>
      <button data-a="comida-add" data-v="manual"><span>✍️</span><b>Manual</b><small>eu sei as kcal</small></button></div>`;
  }
  for (const g of gruposRefeicao()) {
    const lista = itens.filter((x) => (x.grupo || 'extra') === g.id);
    const n = notas[g.id];
    if (!lista.length) {
      if (ed) html += `<button class="grupo-vazio" data-a="comida-add" data-v="buscar" data-grupo="${g.id}"><span>${esc(g.hora)}</span>${esc(g.nome)}<i>+ adicionar</i></button>`;
      continue;
    }
    html += `<div class="sec grupo"><div class="sec-h"><h3>${g.hora ? `<small>${esc(g.hora)}</small> ` : ''}${esc(g.nome)}</h3>${n ? `<span class="nota-b ${n.nota >= 7 ? 'boa' : n.nota >= 5 ? 'media' : 'ruim'}">nota ${num(n.nota)}</span>` : ''}</div>
      ${n ? `<div class="motivos">${esc(n.motivos.join(' · '))}</div>` : ''}
      <div class="list g">${lista.map((x) => `<div class="row clic" data-a="comida-ver" data-id="${x.id}"><div class="info"><div class="t">${esc(x.nome)}</div><div class="m">${esc(x.medida || `${num(x.gramas)} g`)}${x.marca ? ` · ${esc(x.marca)}` : ''} · P ${num(x.p)} · C ${num(x.cb)} · G ${num(x.g)}${x.nova === 4 ? ' · <span class="ultra">ultraprocessado</span>' : ''}</div></div><div class="v">${Math.round(x.kcal)} kcal</div></div>`).join('')}
      ${ed ? `<button class="mais-serie" data-a="comida-add" data-v="buscar" data-grupo="${g.id}">+ adicionar em ${esc(g.nome.toLowerCase())}</button>` : ''}</div></div>`;
  }
  html += '<p class="rodape">Alimentos: TACO (NEPA/UNICAMP) e Open Food Facts. Estimativas, não substituem a nutricionista.</p>';
  return html;
}

// Adicionar alimento: busca/código/manual → quantidade → salvar
async function modalComida(modo = 'buscar', grupo = null, existente = null) {
  grupo ||= existente?.grupo || grupoAgora();
  abrirModal(existente ? 'Editar alimento' : 'Adicionar alimento', '<div class="vazio">Carregando…</div>');
  let K;
  try { K = await import('./comida.js?v=0.4'); } catch (e) { $('#modal-corpo').innerHTML = '<p class="erro">Sem conexão para carregar a busca.</p>'; return; }
  const corpo = $('#modal-corpo');
  if (existente) { quantidade(existente.alimento || null); return; }

  const abas = `<div class="abas" style="margin-bottom:12px">${[['buscar', '🔎 Buscar'], ['codigo', '📷 Código'], ['manual', '✍️ Manual']].map(([k, n]) => `<button class="${k === modo ? 'on' : ''}" data-modo="${k}">${n}</button>`).join('')}</div>`;
  const desenhar = () => {
    if (modo === 'buscar') {
      corpo.innerHTML = `${abas}<form id="f-busca"><input name="q" placeholder="Ex.: arroz, frango grelhado, banana" autocomplete="off"></form><div id="resultados" class="resultados"></div>
        <button class="link" id="buscar-off" style="margin-top:12px">Não achou? Procurar produtos industrializados (Open Food Facts)</button>`;
      const f = corpo.querySelector('form');
      setTimeout(() => f.q.focus(), 200);
      let tm;
      const listar = (lista, vazio) => {
        corpo.querySelector('#resultados').innerHTML = lista.length ? lista.map((a, i) => `<div class="row clic" data-i="${i}"><div class="info"><div class="t">${esc(a.nome)}</div><div class="m">${a.marca ? esc(a.marca) + ' · ' : ''}${a.por100.kcal} kcal/100 g · P ${num(a.por100.p)} g${a.nova === 4 ? ' · <span class="ultra">ultraprocessado</span>' : ''}</div></div><span class="seta">›</span></div>`).join('') : `<p class="rodape">${vazio}</p>`;
        corpo.querySelector('#resultados').onclick = (e) => { const r = e.target.closest('[data-i]'); if (r) quantidade(lista[Number(r.dataset.i)]); };
      };
      f.q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(async () => { if (f.q.value.trim().length >= 2) listar(await K.buscarTaco(f.q.value), 'Nada na tabela TACO. Tente outro nome ou procure nos produtos.'); }, 200); });
      f.addEventListener('submit', (e) => e.preventDefault());
      corpo.querySelector('#buscar-off').onclick = async () => {
        if (f.q.value.trim().length < 2) { f.q.focus(); return; }
        corpo.querySelector('#resultados').innerHTML = '<p class="rodape">Procurando…</p>';
        try { listar(await K.buscarProdutos(f.q.value), 'Nenhum produto encontrado.'); } catch (err) { listar([], err.message); }
      };
    } else if (modo === 'codigo') {
      corpo.innerHTML = `${abas}<p class="hero-sub">Tire uma foto bem de perto do código de barras da embalagem.</p>
        <button class="btn lime big" id="foto-cod">📷 Fotografar código</button><input type="file" accept="image/*" capture="environment" hidden id="in-cod">
        <form id="f-cod" style="margin-top:6px"><label>Ou digite os números</label><div class="linha"><div><input name="cod" inputmode="numeric" placeholder="7891234567890"></div><button class="btn" style="flex:0 0 auto">Buscar</button></div></form>
        <p id="cod-st" class="rodape" style="text-align:left"></p>`;
      const st = corpo.querySelector('#cod-st');
      const consultar = async (cod) => {
        st.textContent = `Consultando ${cod}…`;
        try {
          const a = await K.produtoPorCodigo(cod);
          if (a) quantidade(a); else st.innerHTML = `Produto ${esc(cod)} não está no Open Food Facts. Use <b>Manual</b> com a tabela da embalagem.`;
        } catch (err) { st.textContent = err.message; }
      };
      corpo.querySelector('#foto-cod').onclick = () => corpo.querySelector('#in-cod').click();
      corpo.querySelector('#in-cod').onchange = async (e) => {
        const arq = e.target.files[0]; e.target.value = '';
        if (!arq) return;
        st.textContent = 'Lendo o código…';
        try { const cod = await K.lerCodigoDaFoto(arq); if (cod) { corpo.querySelector('[name=cod]').value = cod; consultar(cod); } else st.textContent = 'Não consegui ler. Tente mais perto, com luz, ou digite os números.'; } catch (err) { st.textContent = err.message; }
      };
      corpo.querySelector('#f-cod').addEventListener('submit', (e) => { e.preventDefault(); const v = e.target.cod.value.replace(/\D/g, ''); if (v) consultar(v); });
    } else {
      corpo.innerHTML = `${abas}<form id="f-manual"><label>O que comeu</label><input name="nome" required placeholder="Ex.: X-salada da lanchonete">
        <div class="linha"><div><label>Calorias</label><input name="kcal" inputmode="numeric" required placeholder="kcal"></div><div><label>Quantidade (g)</label><input name="gramas" inputmode="decimal" placeholder="opcional"></div></div>
        <div class="linha"><div><label>Proteína</label><input name="p" inputmode="decimal" placeholder="g"></div><div><label>Carbo</label><input name="cb" inputmode="decimal" placeholder="g"></div><div><label>Gordura</label><input name="g" inputmode="decimal" placeholder="g"></div></div>
        <label>Tipo de comida</label><div class="chips">${[[1, 'Caseira / natural'], [3, 'Processada'], [4, 'Ultraprocessada / fast food']].map(([v, n]) => `<label><input type="radio" name="nova" value="${v}" ${v === 1 ? 'checked' : ''}>${n}</label>`).join('')}</div>
        <div class="acoes"><button class="btn lime">Continuar</button></div></form>`;
      corpo.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.target; const n = (x) => Number(String(x).replace(',', '.')) || 0;
        const gramas = n(f.gramas.value) || 100;
        const fator = 100 / gramas;
        quantidade({ fonte: 'manual', ref: '', nome: f.nome.value.trim(), marca: '', nova: Number(f.nova.value), por100: { kcal: n(f.kcal.value) * fator, p: n(f.p.value) * fator, cb: n(f.cb.value) * fator, g: n(f.g.value) * fator, f: 0 }, medidas: [], gramasPadrao: gramas });
      });
    }
    corpo.querySelectorAll('[data-modo]').forEach((b) => { b.onclick = () => { modo = b.dataset.modo; desenhar(); }; });
  };

  // Passo 2: quanto comeu e em qual refeição
  function quantidade(a) {
    const x = existente;
    a ||= { fonte: x.fonte, ref: x.ref, nome: x.nome, marca: x.marca, nova: x.nova, nutriscore: x.nutriscore, por100: x.por100 || { kcal: (x.kcal / x.gramas) * 100, p: (x.p / x.gramas) * 100, cb: (x.cb / x.gramas) * 100, g: (x.g / x.gramas) * 100, f: (x.f / x.gramas) * 100 }, medidas: x.medidas || [] };
    const medidas = [...(a.medidas || []), { nome: '100 g', g: 100 }];
    const porcao = (a.medidas || []).find((md) => /^porç/.test(md.nome));
    let gramas = x?.gramas || a.gramasPadrao || porcao?.g || 100;
    let medida = x?.medida || '';
    corpo.innerHTML = `<form id="f-qtd">
      <div class="al-nome"><b>${esc(a.nome)}</b>${a.marca ? `<small>${esc(a.marca)}</small>` : ''}<small>${Math.round(a.por100.kcal)} kcal a cada 100 g${a.nova ? ` · ${esc(C.NOVA[a.nova])}` : ''}${a.nutriscore ? ` · Nutri-Score ${a.nutriscore.toUpperCase()}` : ''}</small></div>
      ${medidas.length > 1 ? `<label>Medida</label><div class="chips">${medidas.map((md, i) => `<button type="button" class="chip ${!x && md === (porcao || medidas.at(-1)) ? 'on' : ''}" data-md="${i}">${esc(md.nome)}${md.nome === '100 g' ? '' : ` <small>${num(md.g)} g</small>`}</button>`).join('')}</div>` : ''}
      <div class="linha"><div><label>Quantas</label><input name="qtd" inputmode="decimal" value="1"></div><div><label>Gramas</label><input name="gramas" inputmode="decimal" value="${num(gramas)}" required></div></div>
      <label>Refeição</label><div class="chips">${gruposRefeicao().map((g) => `<label><input type="radio" name="grupo" value="${g.id}" ${g.id === grupo ? 'checked' : ''}>${esc(g.nome)}</label>`).join('')}</div>
      <div id="prev" class="aviso"></div>
      <div class="acoes">${x ? '<button type="button" class="btn danger" data-apagar>Apagar</button>' : ''}<button class="btn lime">${x ? 'Salvar' : 'Adicionar'}</button></div></form>`;
    const f = corpo.querySelector('form');
    let base = x || a.gramasPadrao ? null : porcao || medidas.at(-1); // medida escolhida
    const rotulo = (q, md) => (md.nome === '100 g' ? '' : `${num(q)} ${md.nome}`);
    if (base) medida = rotulo(1, base);
    const prev = () => {
      const g = Number(String(f.gramas.value).replace(',', '.')) || 0;
      const v = K.porQuantidade(a, g);
      const grupoSel = f.grupo.value;
      const outros = comidasDe(x?.data || dataSel).filter((y) => (y.grupo || 'extra') === grupoSel && y.id !== x?.id);
      const nota = C.notaRefeicao([...outros, { ...v, nova: a.nova, nome: a.nome }], metas());
      corpo.querySelector('#prev').innerHTML = `<b>${v.kcal} kcal</b> · P ${num(v.p)} g · C ${num(v.cb)} g · G ${num(v.g)} g${nota ? `<br>Nota da refeição: <b>${num(nota.nota)}</b> · ${esc(nota.motivos.join(' · '))}` : ''}`;
    };
    corpo.querySelectorAll('[data-md]').forEach((b) => { b.onclick = () => { base = medidas[Number(b.dataset.md)]; f.qtd.value = '1'; f.gramas.value = num(base.g); medida = rotulo(1, base); corpo.querySelectorAll('[data-md]').forEach((y) => y.classList.toggle('on', y === b)); prev(); }; });
    f.qtd.addEventListener('input', () => { const q = Number(String(f.qtd.value).replace(',', '.')) || 0; if (base) { f.gramas.value = num(Math.round(base.g * q)); medida = rotulo(q, base); } else { f.gramas.value = num(Math.round((Number(String(f.gramas.dataset.um || gramas)) || 100) * q)); } prev(); });
    f.gramas.dataset.um = gramas;
    f.gramas.addEventListener('input', () => { base = null; medida = ''; prev(); });
    f.addEventListener('change', prev);
    prev();
    corpo.querySelector('[data-apagar]')?.addEventListener('click', () => { store.remover(['feed', uid, 'comidas', x.id]); D.comidas = D.comidas.filter((y) => y.id !== x.id); fecharModal(); toast('Removido'); });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const g = Number(String(f.gramas.value).replace(',', '.'));
      if (!(g > 0)) return;
      const v = K.porQuantidade(a, g);
      const grupoSel = gruposRefeicao().find((y) => y.id === f.grupo.value) || { id: 'extra', nome: 'Extra' };
      const id = x?.id || store.novoId();
      const doc = {
        data: x?.data || dataSel, grupo: grupoSel.id, grupoNome: grupoSel.nome, nome: a.nome, marca: a.marca || '', gramas: g, medida: medida || '',
        ...v, nova: a.nova || null, nutriscore: a.nutriscore || null, fonte: a.fonte, ref: a.ref || '',
        por100: { kcal: Math.round(a.por100.kcal), p: Math.round(a.por100.p * 10) / 10, cb: Math.round(a.por100.cb * 10) / 10, g: Math.round(a.por100.g * 10) / 10, f: Math.round((a.por100.f || 0) * 10) / 10 },
        medidas: (a.medidas || []).slice(0, 8), em: x?.em || Date.now(),
      };
      D.comidas = [...D.comidas.filter((y) => y.id !== id), { id, ...doc }];
      store.definir(['feed', uid, 'comidas', id], doc, false);
      fecharModal(); toast(x ? 'Atualizado' : `+ ${v.kcal} kcal em ${grupoSel.nome.toLowerCase()}`);
      agendarRender();
    });
  }
  desenhar();
}

function modalObjetivo() {
  const c = prefs().corpo || {};
  const peso = D.pesos.at(-1)?.kg || c.peso || '';
  const m = metas();
  abrirModal('Meu objetivo', `<form id="f-obj">
    <label>Objetivo</label><div class="seg">${Object.entries(C.OBJETIVOS).map(([k, n]) => `<label><input type="radio" name="objetivo" value="${k}" ${k === (c.objetivo || 'manter') ? 'checked' : ''}>${n}</label>`).join('')}</div>
    <div class="linha"><div><label>Sexo</label><div class="seg"><label><input type="radio" name="sexo" value="f" ${c.sexo === 'f' ? 'checked' : ''}>F</label><label><input type="radio" name="sexo" value="m" ${c.sexo !== 'f' ? 'checked' : ''}>M</label></div></div><div><label>Idade</label><input name="idade" inputmode="numeric" value="${esc(c.idade || '')}" required></div></div>
    <div class="linha"><div><label>Altura (cm)</label><input name="altura" inputmode="numeric" value="${esc(c.altura || '')}" required></div><div><label>Peso (kg)</label><input name="peso" inputmode="decimal" value="${esc(peso ? num(peso) : '')}" required></div></div>
    <label>Atividade</label><select name="atividade">${Object.entries(C.ATIVIDADE).map(([k, [, n]]) => `<option value="${k}" ${k === (c.atividade || 'moderado') ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <div class="linha"><div><label>Refeições por dia</label><input name="refeicoes" inputmode="numeric" value="${esc(c.refeicoes || D.plano?.refeicoes?.length || 5)}"></div><div><label>Cardio/semana (min)</label><input name="cardioSemana" inputmode="numeric" value="${esc(c.cardioSemana || 150)}"></div><div><label>Sono (h)</label><input name="sono" inputmode="decimal" value="${esc(c.sono || 7)}"></div></div>
    <details class="dicas" style="margin-top:14px"><summary>A nutricionista passou números? (opcional)</summary>
      <div class="linha"><div><label>Calorias/dia</label><input name="kcalManual" inputmode="numeric" value="${esc(c.kcalManual || '')}" placeholder="automático"></div><div><label>Proteína/dia (g)</label><input name="protManual" inputmode="numeric" value="${esc(c.protManual || '')}" placeholder="automático"></div></div></details>
    <div id="obj-prev" class="aviso"></div>
    <p class="rodape" style="text-align:left">Fica só com você. A dupla vê só o objetivo (ex.: "ganhar massa") e os pontos.</p>
    <div class="acoes"><button class="btn lime">Salvar</button></div></form>`, (el) => {
    const f = el.querySelector('form');
    const ler = () => Object.fromEntries(['objetivo', 'sexo', 'idade', 'altura', 'peso', 'atividade', 'refeicoes', 'cardioSemana', 'sono', 'kcalManual', 'protManual'].map((k) => [k, String(f[k].value).replace(',', '.')]));
    const prev = () => { const mm = C.calcularMetas(ler()); el.querySelector('#obj-prev').innerHTML = mm.completo ? `Meta: <b>${mm.kcal} kcal</b> · <b>${mm.prot} g</b> de proteína por dia${mm.tmb ? ` (metabolismo basal ~${mm.tmb} kcal)` : ''}.` : 'Preencha idade, altura e peso.'; };
    f.addEventListener('input', prev); f.addEventListener('change', prev); prev();
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = ler();
      const corpo = { ...v, idade: Number(v.idade) || null, altura: Number(v.altura) || null, peso: Number(v.peso) || null, refeicoes: Number(v.refeicoes) || 5, cardioSemana: Number(v.cardioSemana) || 150, sono: Number(v.sono) || 7, kcalManual: Number(v.kcalManual) || null, protManual: Number(v.protManual) || null };
      salvarPrefs({ corpo });
      D.prefs = { ...D.prefs, corpo };
      if (corpo.peso && corpo.peso !== D.pesos.at(-1)?.kg) store.definir(['usuarios', uid, 'pesos', C.hoje()], { kg: corpo.peso }, false);
      fecharModal(); toast('Objetivo salvo 🎯'); agendarRender();
    });
  });
}

// ---------- Check-in (prova do treino, estilo GymRats) ----------
const duracaoTxt = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`);
function resumoCheckin(c) {
  const t = C.tipoInfo(c.tipo);
  return [c.minutos ? duracaoTxt(c.minutos) : '', c.km ? `${num(c.km)} km` : '', c.kcal ? `${c.kcal} kcal` : '', c.academia ? `📍 ${c.academia}` : ''].filter(Boolean).map(esc).join(' · ') || esc(t.nome);
}

function secaoCheckins(d, ed) {
  const lista = D.checkins.filter((c) => c.data === d);
  const ativos = desafiosAtivos(d).length;
  if (!lista.length) {
    if (!ed) return '';
    return `<div class="sec"><button class="checkin-cta g" data-a="checkin"><span class="e">📸</span><span class="info"><b>Fazer check-in</b><small>Foto, tempo e local do treino${ativos ? ` · conta em ${plural(ativos, 'desafio', 'desafios')}` : ''}</small></span><span class="seta">›</span></button></div>`;
  }
  return `<div class="sec"><div class="sec-h"><h3>📸 Check-in${lista.length > 1 ? 's' : ''}</h3>${ed ? '<button data-a="checkin">+ Novo</button>' : ''}</div><div class="list g">`
    + lista.map((c) => `<div class="row clic" data-a="ver-checkin" data-id="${c.id}">${(c.fotos || [])[0] ? `<img class="thumb" src="${c.fotos[0]}" alt="">` : `<div class="ic">${C.tipoInfo(c.tipo).e}</div>`}
      <div class="info"><div class="t">${C.tipoInfo(c.tipo).e} ${esc(c.titulo || C.tipoInfo(c.tipo).nome)}</div><div class="m">${resumoCheckin(c)}</div></div><span class="seta">›</span></div>`).join('')
    + '</div></div>';
}

// Desafios em que um check-in desta data entra.
const desafiosAtivos = (d) => D.desafios.filter((x) => x.inicio <= d && d <= x.fim);

function modalCheckin(pre = {}, existente = null) {
  const c = existente || {};
  const hoje = C.hoje();
  const dataPadrao = existente?.data || (editavel(dataSel) ? dataSel : hoje);
  const treino = C.treinoDoDia(D.plano, dataPadrao, diaDoc(dataPadrao));
  const v = {
    tipo: c.tipo || pre.tipo || (treino ? 'musculacao' : ''),
    titulo: c.titulo ?? pre.titulo ?? (treino?.nome || ''),
    minutos: c.minutos || pre.minutos || '',
    kcal: c.kcal || pre.kcal || '',
    km: c.km || pre.km || '',
    academia: c.academia ?? (pre.academia || prefs().ultimaAcademia || ''),
    nota: c.nota || '',
    fonte: c.fonte || pre.fonte || 'manual',
  };
  let fotos = [...(c.fotos || pre.fotos || [])];
  const academias = prefs().academias || [];
  const datas = [0, 1, 2].map((n) => C.somarDias(hoje, -n));
  abrirModal(existente ? 'Editar check-in' : 'Check-in', `<form id="f-checkin">
    <div class="ck-fotos" id="ck-fotos"></div>
    <div class="linha"><button type="button" class="btn" data-foto="camera">📷 Tirar foto</button><button type="button" class="btn" data-foto="galeria">🖼️ Galeria / print</button></div>
    <input type="file" name="cam" accept="image/*" capture="environment" hidden><input type="file" name="gal" accept="image/*" multiple hidden>
    <p class="rodape" style="margin-top:8px;text-align:left">A foto é a prova do treino (pode ser você na academia ou o print do Samsung Health / Apple Fitness). Até 2 fotos.</p>
    <label>Dia</label><div class="seg">${datas.map((x) => `<label><input type="radio" name="data" value="${x}" ${x === dataPadrao ? 'checked' : ''}>${esc(rotuloCurto(x))}</label>`).join('')}</div>
    <label>Atividade</label><div class="chips">${C.TIPOS.map((t) => `<label><input type="radio" name="tipo" value="${t.id}" ${t.id === v.tipo ? 'checked' : ''}>${t.e} ${esc(t.nome)}</label>`).join('')}</div>
    <label>Título <small>(opcional)</small></label><input name="titulo" value="${esc(v.titulo)}" placeholder="Ex.: Treino A · Superiores">
    <div class="linha"><div><label>Duração (min)</label><input name="minutos" inputmode="numeric" value="${esc(v.minutos)}" placeholder="60" required></div>
      <div><label>Calorias</label><input name="kcal" inputmode="numeric" value="${esc(v.kcal)}" placeholder="opcional"></div>
      <div><label>Km</label><input name="km" inputmode="decimal" value="${esc(v.km ? num(v.km) : '')}" placeholder="opcional"></div></div>
    <label>Onde treinou</label><input name="academia" list="lista-academias" value="${esc(v.academia)}" placeholder="Ex.: Smart Fit Paulista, casa, parque">
    <datalist id="lista-academias">${academias.map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
    <label>Comentário <small>(opcional)</small></label><input name="nota" value="${esc(v.nota)}" placeholder="Como foi?">
    <div id="ck-desafios"></div>
    <p id="ck-erro" class="erro"></p>
    <div class="acoes">${existente ? '<button type="button" class="btn danger" data-apagar>Apagar</button>' : ''}<button class="btn lime">${existente ? 'Salvar' : 'Fazer check-in ✓'}</button></div>
  </form>`, (el) => {
    const f = el.querySelector('form');
    const desenharFotos = () => {
      el.querySelector('#ck-fotos').innerHTML = fotos.map((src, i) => `<div><img src="${src}" alt=""><button type="button" data-tirar="${i}" aria-label="Tirar foto">✕</button></div>`).join('')
        || '<div class="ck-vazio">📸<small>Sem foto ainda</small></div>';
    };
    const marcados = new Set(existente ? existente.desafios || [] : desafiosAtivos(dataPadrao).map((x) => x.id));
    const desenharDesafios = () => {
      const lista = desafiosAtivos(f.data.value);
      el.querySelector('#ck-desafios').innerHTML = lista.length ? `<label>Conta nos desafios</label>${lista.map((x) => `<label class="chk-l"><input type="checkbox" name="desafio" value="${x.id}" ${marcados.has(x.id) ? 'checked' : ''}>🏆 ${esc(x.nome)}</label>`).join('')}` : '';
    };
    desenharFotos(); desenharDesafios();
    f.addEventListener('change', (e) => {
      if (e.target.name === 'data') desenharDesafios();
      if (e.target.name === 'desafio') e.target.checked ? marcados.add(e.target.value) : marcados.delete(e.target.value);
    });
    el.addEventListener('click', (e) => {
      const bf = e.target.closest('[data-foto]');
      if (bf) { (bf.dataset.foto === 'camera' ? f.cam : f.gal).click(); return; }
      const bt = e.target.closest('[data-tirar]');
      if (bt) { fotos.splice(Number(bt.dataset.tirar), 1); desenharFotos(); }
    });
    const addFotos = async (ev) => {
      const arqs = [...ev.target.files]; ev.target.value = '';
      for (const a of arqs) { if (fotos.length >= 2) break; try { fotos.push(await comprimir(a)); } catch (err) { toast('Não foi possível ler a foto.'); } }
      desenharFotos();
    };
    f.cam.addEventListener('change', addFotos); f.gal.addEventListener('change', addFotos);
    el.querySelector('[data-apagar]')?.addEventListener('click', () => { apagarCheckin(existente); fecharModal(); toast('Check-in apagado'); });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const erro = el.querySelector('#ck-erro');
      const minutos = Math.round(Number(String(f.minutos.value).replace(',', '.')));
      if (!fotos.length) { erro.textContent = 'Coloque pelo menos uma foto (é a prova do treino).'; return; }
      if (!(minutos > 0 && minutos < 1000)) { erro.textContent = 'Informe a duração em minutos.'; return; }
      const tipo = f.tipo.value || 'outro';
      const n = (x) => { const y = Number(String(x).replace(',', '.')); return y > 0 ? y : null; };
      const dados = {
        data: f.data.value, tipo, titulo: f.titulo.value.trim(), minutos,
        kcal: n(f.kcal.value) && Math.round(n(f.kcal.value)), km: n(f.km.value),
        academia: f.academia.value.trim(), nota: f.nota.value.trim(), fonte: v.fonte, fotos,
        desafios: desafiosAtivos(f.data.value).map((x) => x.id).filter((x) => marcados.has(x)),
      };
      salvarCheckin(dados, existente);
      fecharModal();
      toast(existente ? 'Check-in atualizado' : `Check-in feito ✓${dados.desafios.length ? ' 🏆' : ''}`);
    });
  });
}

function salvarCheckin(dados, existente) {
  const id = existente?.id || store.novoId();
  const doc = { ...dados, uid, nome: usuario.displayName || '', foto: usuario.photoURL || '', em: existente?.em || Date.now(), atualizado: Date.now() };
  // Na hora, para a tela não esperar o Firestore
  D.ckJanela = [...D.ckJanela.filter((x) => x.id !== id), { id, ...doc }];
  filtrarDia();
  store.definir(['feed', uid, 'checkins', id], doc, false);
  const { fotos, ...meta } = doc;
  for (const d of existente?.desafios || []) {
    if (!doc.desafios.includes(d)) { store.remover(['desafios', d, 'checkins', id]); store.remover(['desafios', d, 'fotos', id]); }
  }
  for (const d of doc.desafios) {
    store.definir(['desafios', d, 'checkins', id], { ...meta, nFotos: fotos.length }, true);
    store.definir(['desafios', d, 'fotos', id], { uid, fotos }, false);
  }
  // Guarda a academia para sugerir da próxima vez
  if (doc.academia) {
    const lista = [doc.academia, ...(prefs().academias || []).filter((a) => a !== doc.academia)].slice(0, 8);
    salvarPrefs({ academias: lista, ultimaAcademia: doc.academia });
  }
  // Check-in conta como treino feito no dia (se o plano tinha treino)
  const dia = diaDoc(doc.data) || {};
  if (editavel(doc.data) && !dia.treinoFeito && avaliar(doc.data).temTreino) {
    const t = C.treinoDoDia(D.plano, doc.data, dia);
    salvarDia(doc.data, { treinoFeito: true, treinoId: t?.id ?? null });
  }
  agendarRender();
}

function apagarCheckin(c) {
  store.remover(['feed', uid, 'checkins', c.id]);
  for (const d of c.desafios || []) { store.remover(['desafios', d, 'checkins', c.id]); store.remover(['desafios', d, 'fotos', c.id]); }
  D.ckJanela = D.ckJanela.filter((x) => x.id !== c.id);
  filtrarDia();
  agendarRender();
}

// ---------- Treino ----------
function telaTreino() {
  const d = dataSel;
  const dia = diaDoc(d) || {};
  const treino = C.treinoDoDia(D.plano, d, dia);
  if (!treino) { tela = 'hoje'; return telaHoje(); }
  const ed = editavel(d);
  const series = dia.series || {};
  let html = `<div class="treino-head fade-in"><button class="voltar" data-a="ir" data-id="hoje">‹ Voltar</button>
    <h2>${esc(treino.nome)}</h2><div class="m">${esc(C.rotuloDia(d))} · ${plural(treino.exercicios.length, 'exercício', 'exercícios')}${dia.treinoFeito ? ' · concluído ✓' : ''}</div></div>`;
  treino.exercicios.forEach((e, i) => {
    const ult = C.ultimaVez(D.dias, e.id, d);
    const arr = series[e.id] || [];
    const n = Math.max(e.series || 1, arr.length);
    const feitos = arr.filter((s) => s && s.ok).length;
    const meta = [seriesTxt(e), e.descanso ? `descanso ${e.descanso >= 60 && e.descanso % 60 === 0 ? e.descanso / 60 + ' min' : e.descanso + 's'}` : ''].filter(Boolean).join(' · ');
    html += `<div class="ex g ${feitos >= (e.series || 1) ? 'feito' : ''}">
      <div class="ex-h"><div class="n">${i + 1}</div><div class="info"><div class="t">${esc(e.nome)}</div><div class="m">${esc(meta)}</div>${e.obs ? `<div class="obs">${esc(e.obs)}</div>` : ''}</div></div>
      ${ult ? `<div class="ultima">Última vez (${esc(C.rotuloDia(ult.data).toLowerCase())}): <b>${ult.series.map((s) => `${num(s.kg)}kg×${s.reps || '?'}`).join(', ')}</b></div>` : ''}
      <div class="serie-h"><span>#</span><span>kg</span><span>reps</span><span></span></div>`;
    for (let k = 0; k < n; k++) {
      const s = arr[k] || {};
      const ref = ult?.series[k] || ult?.series.at(-1);
      const phKg = ref ? num(ref.kg) : '';
      const phReps = ref?.reps || String(e.reps || '').replace(/[^\d-]/g, '').split('-').pop() || '';
      html += `<div class="serie ${s.ok ? 'ok' : ''}">
        <span class="i">${k + 1}</span>
        <input inputmode="decimal" placeholder="${esc(phKg)}" value="${s.kg ?? ''}" data-ex="${e.id}" data-k="${k}" data-f="kg" ${ed ? '' : 'disabled'}>
        <input inputmode="numeric" placeholder="${esc(phReps)}" value="${s.reps ?? ''}" data-ex="${e.id}" data-k="${k}" data-f="reps" ${ed ? '' : 'disabled'}>
        <button class="chk ${s.ok ? 'on' : ''}" data-a="serie" data-ex="${e.id}" data-k="${k}" ${ed ? '' : 'disabled'} aria-label="Série feita">✓</button>
      </div>`;
    }
    if (ed) html += `<button class="mais-serie" data-a="mais-serie" data-ex="${e.id}">+ série</button>`;
    html += '</div>';
  });
  if (ed) {
    html += dia.treinoFeito
      ? '<div class="acoes"><button class="btn" data-a="treino-desfazer">Reabrir treino</button></div>'
      : '<div class="acoes"><button class="btn lime big" data-a="treino-concluir">Concluir treino 💪</button></div>';
  }
  return html;
}

function lerSeries(exId) {
  const dia = diaDoc(dataSel) || {};
  return [...((dia.series || {})[exId] || [])].map((s) => ({ ...(s || {}) }));
}

function gravarSerie(exId, k, mud) {
  const arr = lerSeries(exId);
  while (arr.length <= k) arr.push({});
  arr[k] = { ...arr[k], ...mud };
  salvarDia(dataSel, { series: { [exId]: arr } });
}

// ---------- Cronômetro de descanso ----------
let timer = { fim: 0, iv: null };
function iniciarTimer(seg) {
  if (!seg) return;
  timer.fim = Date.now() + seg * 1000;
  clearInterval(timer.iv);
  timer.iv = setInterval(tickTimer, 250);
  tickTimer();
}
function tickTimer() {
  const el = $('#timer');
  const rest = Math.ceil((timer.fim - Date.now()) / 1000);
  if (rest <= -8) { pararTimer(); return; }
  el.classList.remove('hidden');
  if (rest <= 0) {
    if (!el.classList.contains('fim')) { el.classList.add('fim'); bip(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); }
    el.innerHTML = '<div><span class="tt">Bora!</span><small>descanso acabou</small></div><button data-a="timer-parar">Ok</button>';
    return;
  }
  el.classList.remove('fim');
  const m = Math.floor(rest / 60), s = rest % 60;
  el.innerHTML = `<div><span class="tt">${m}:${String(s).padStart(2, '0')}</span><small>descanso</small></div><button data-a="timer-mais" data-v="-15">−15</button><button data-a="timer-mais" data-v="15">+15</button><button data-a="timer-parar">Pular</button>`;
}
function pararTimer() { clearInterval(timer.iv); $('#timer').classList.add('hidden'); $('#timer').classList.remove('fim'); }
function bip() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25].forEach((t) => {
      const o = ac.createOscillator(); const g = ac.createGain();
      o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ac.destination);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.15);
    });
  } catch (e) { /* sem som */ }
}

// ---------- Juntos: desafios e dupla ----------
function telaJuntos() {
  const seg = `<div class="abas">${[['placar', '⚔️ Placar'], ['desafios', '🏆 Desafios'], ['dupla', '🤝 Dupla']].map(([k, n]) => `<button class="${aba === k ? 'on' : ''}" data-a="aba" data-id="${k}">${n}</button>`).join('')}</div>`;
  return `<div class="hero fade-in" style="padding-bottom:14px"><div class="ola">Juntos</div></div>${seg}${aba === 'dupla' ? telaDupla() : aba === 'placar' ? telaPlacarJuntos() : telaDesafios()}`;
}

// Pontos de um dia: os meus ao vivo nos dias editáveis; o resto, o que foi publicado.
function meusPontos(d) {
  if (d >= C.somarDias(C.hoje(), -DIAS_EDITAVEIS) && d >= janelaIni) { const p = pontosDe(d); return { total: p.total, cats: p.cats, notasRef: p.notas }; }
  const x = diaDoc(d);
  return x?.pontos ? { ...x.pontos, notasRef: x.notasRef || [] } : null;
}
function pessoasPlacar() {
  const parc = (D.perfil?.parceiros || []).filter((x) => x !== uid && P[x]?.perfil);
  return [
    { uid, nome: usuario.displayName || 'Você', foto: usuario.photoURL || '', objetivo: metas().objetivo, pts: meusPontos },
    ...parc.map((p) => ({ uid: p, nome: P[p].perfil.nome, foto: P[p].perfil.foto, objetivo: P[p].perfil.objetivo, pts: (d) => { const x = (P[p].dias || []).find((y) => y.id === d); return x?.pontos ? { ...x.pontos, notasRef: x.notasRef || [] } : null; } })),
  ];
}

function telaPlacarJuntos() {
  const gente = pessoasPlacar();
  if (gente.length < 2) {
    return `<div class="vazio g" style="margin-top:14px"><span class="big">⚔️</span>O placar compara o dia de vocês: alimentação, treino, cardio, água e hábitos, cada um contra o próprio objetivo.<div class="acoes"><button class="btn lime" data-a="aba" data-id="dupla">Fazer dupla</button></div></div>`;
  }
  const h = C.hoje();
  const hojeP = gente.map((g) => ({ ...g, p: g.pts(h) }));
  const max = Math.max(...hojeP.map((g) => g.p?.total ?? 0));
  let html = `<div class="duelo g fade-in"><div class="lbl">Duelo de hoje</div><div class="duelo-lados">${hojeP.map((g) => `
    <div class="lado ${g.p && g.p.total === max && max > 0 ? 'lider' : ''}">${avatarHTML(g.foto, g.nome)}<b>${esc(primeiroNome(g.nome))}</b><small>${esc(C.OBJETIVOS[g.objetivo] || '')}</small><div class="pl-n">${g.p?.total ?? '–'}</div></div>`).join('<div class="vs">×</div>')}</div>
    <div class="duelo-cats">${Object.entries(C.PESOS).map(([k, mx]) => `<div class="dc"><span>${C.PESOS_NOME[k]}</span><div class="dc-b">${hojeP.map((g) => `<i style="--w:${Math.round(((g.p?.cats?.[k] || 0) / mx) * 100)}%"></i>`).join('')}</div></div>`).join('')}</div>
    <div class="tira-leg"><span>barras: ${hojeP.map((g) => esc(primeiroNome(g.nome))).join(' em cima, ')} embaixo</span></div></div>`;

  // Melhor refeição de cada um hoje
  const melhores = hojeP.map((g) => ({ g, r: [...(g.p?.notasRef || [])].sort((a, b) => b.nota - a.nota)[0] })).filter((x) => x.r);
  if (melhores.length) {
    html += `<div class="sec"><div class="sec-h"><h3>🍽️ Melhor refeição de hoje</h3></div><div class="list g">${melhores.map(({ g, r }) => `<div class="row">${avatarHTML(g.foto, g.nome)}<div class="info"><div class="t">${esc(r.nome)} · ${Math.round(r.kcal)} kcal</div><div class="m">${esc((r.motivos || []).join(' · '))}</div></div><span class="nota-b ${r.nota >= 7 ? 'boa' : r.nota >= 5 ? 'media' : 'ruim'}">${num(r.nota)}</span></div>`).join('')}</div></div>`;
  }

  // Rodada da semana
  const ini = C.inicioSemana(h);
  const dias = [...C.diasEntre(ini, h)].filter((d) => d >= C.INICIO_OFENSIVA);
  const soma = (g, ds) => ds.reduce((a, d) => a + (g.pts(d)?.total || 0), 0);
  const tot = gente.map((g) => ({ g, t: soma(g, dias) }));
  const lider = [...tot].sort((a, b) => b.t - a.t)[0];
  html += `<div class="sec"><div class="sec-h"><h3>🗓️ Rodada da semana</h3><span class="tag green">${dataCurta(ini)} – ${dataCurta(C.somarDias(ini, 6))}</span></div><div class="card g">
    ${dias.length ? `<table class="rodada"><tr><th></th>${gente.map((g) => `<th>${esc(primeiroNome(g.nome))}</th>`).join('')}</tr>
    ${dias.map((d) => `<tr><td>${C.SEMANA[C.diaSemana(d)]}</td>${gente.map((g) => `<td>${g.pts(d)?.total ?? '–'}</td>`).join('')}</tr>`).join('')}
    <tr class="tot"><td>Total</td>${tot.map((x) => `<td>${x.t}</td>`).join('')}</tr></table>
    <div class="sub" style="margin-top:10px">${lider.t ? `${esc(primeiroNome(lider.g.nome))} lidera a rodada 👑` : 'A rodada começou. Bora!'} · vence quem somar mais até domingo</div>` : '<div class="sub">A primeira rodada começa em 24/11.</div>'}
  </div></div>`;

  // Histórico de rodadas
  const semanas = [];
  for (let s = C.inicioSemana(C.INICIO_OFENSIVA); s < ini; s = C.somarDias(s, 7)) {
    const ds = [...C.diasEntre(s, C.somarDias(s, 6))].filter((d) => d >= C.INICIO_OFENSIVA);
    const r = gente.map((g) => ({ g, t: soma(g, ds) })).sort((a, b) => b.t - a.t);
    semanas.push({ s, r, empate: r[1] && r[0].t === r[1].t });
  }
  if (semanas.length) {
    const trofeus = Object.fromEntries(gente.map((g) => [g.uid, semanas.filter((w) => !w.empate && w.r[0].g.uid === g.uid).length]));
    html += `<div class="sec"><div class="sec-h"><h3>🏆 Troféus</h3><span class="tag green">${gente.map((g) => `${esc(primeiroNome(g.nome))} ${trofeus[g.uid]}`).join(' × ')}</span></div><div class="list g">
      ${semanas.reverse().map((w) => `<div class="row"><div class="info"><div class="t">Semana de ${dataCurta(w.s)}</div><div class="m">${w.r.map((x) => `${esc(primeiroNome(x.g.nome))} ${x.t}`).join(' × ')}</div></div><span class="val-d">${w.empate ? 'empate' : `👑 ${esc(primeiroNome(w.r[0].g.nome))}`}</span></div>`).join('')}</div></div>`;
  }
  html += '<p class="rodape">Cada um é comparado com o próprio objetivo. Toque no Placar do dia (tela Hoje) para ver como conta.</p>';
  return html;
}

const eu = () => ({ nome: usuario.displayName || 'Sem nome', foto: usuario.photoURL || '' });
const pessoaDesafio = (d, u) => (u === uid ? eu() : d.perfis?.[u] || P[u]?.perfil || { nome: 'Alguém', foto: '' });
const medalha = (pos) => ['🥇', '🥈', '🥉'][pos - 1] || `${pos}º`;
const pontosTxt = (d, p) => (d.criterio === 'minutos' ? duracaoTxt(p.minutos) : d.criterio === 'pontos' ? `${p.fol} pts` : plural(p.dias, 'dia', 'dias'));
const CRITERIO = { dias: ['dias ativos', 'ganha quem treinar mais dias'], minutos: ['minutos', 'ganha quem somar mais minutos'], pontos: ['pontos Fôlego', 'ganha quem somar mais pontos no Placar do dia'] };
const dataCurta = (s) => C.paraData(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');

function faseTxt(d, st) {
  if (st.fase === 'futuro') return `Começa ${st.faltam === 1 ? 'amanhã' : `em ${st.faltam} dias`} (${dataCurta(d.inicio)})`;
  if (st.fase === 'encerrado') return `Encerrado em ${dataCurta(d.fim)}`;
  return `Dia ${st.dia} de ${st.total} · ${st.restam ? `faltam ${plural(st.restam, 'dia', 'dias')}` : 'último dia!'}`;
}

function sincronizarDesafios() {
  const ids = D.desafios.map((x) => x.id);
  for (const k of Object.keys(DS)) if (!ids.includes(k)) { DS[k].parada(); delete DS[k]; }
  for (const id of ids) {
    if (DS[id]) continue;
    const o = DS[id] = { checkins: [], pontos: [], parada: () => {} };
    const a = store.assinarCol(['desafios', id, 'checkins'], (l) => { o.checkins = l.sort((x, y) => y.em - x.em); agendarRender(); });
    const b = store.assinarCol(['desafios', id, 'pontos'], (l) => { o.pontos = l; agendarRender(); });
    o.parada = () => { a(); b(); };
  }
}

function telaDesafios() {
  let html = '';
  if (!D.desafios.length) {
    return `<div class="vazio g" style="margin-top:14px"><span class="big">🏆</span>Crie um desafio com começo e fim. Cada treino vira um check-in com foto, tempo e local, e o placar mostra quem treinou mais.
      <div class="acoes"><button class="btn lime" data-a="novo-desafio">Criar desafio</button><button class="btn" data-a="entrar-desafio">Tenho um código</button></div></div>`;
  }
  const ordem = { ativo: 0, futuro: 1, encerrado: 2 };
  const lista = D.desafios.map((d) => ({ d, st: C.statusDesafio(d) })).sort((a, b) => ordem[a.st.fase] - ordem[b.st.fase]);
  for (const { d, st } of lista) {
    const placar = C.placarDesafio(d, DS[d.id]?.checkins || [], DS[d.id]?.pontos || []);
    const meu = placar.find((p) => p.uid === uid);
    html += `<button class="desafio g fade-in ${st.fase}" data-a="abrir-desafio" data-id="${d.id}">
      <div class="d-top"><div class="info"><div class="t">🏆 ${esc(d.nome)}</div><div class="m">${esc(faseTxt(d, st))}</div></div>${meu?.pontos && st.fase !== 'futuro' ? `<div class="pos">${medalha(meu.pos)}</div>` : ''}</div>
      <div class="barra"><div style="width:${st.fase === 'futuro' ? 0 : Math.round((st.dia / st.total) * 100)}%"></div></div>
      <div class="d-placar">${placar.slice(0, 3).map((p) => { const pe = pessoaDesafio(d, p.uid); return `<span>${avatarHTML(pe.foto, pe.nome)}<b>${esc(primeiroNome(pe.nome))}</b><small>${esc(pontosTxt(d, p))}</small></span>`; }).join('')}</div>
    </button>`;
  }
  html += '<div class="acoes"><button class="btn" data-a="novo-desafio">+ Criar desafio</button><button class="btn" data-a="entrar-desafio">Tenho um código</button></div>';
  return html;
}

function telaDesafio() {
  const d = D.desafios.find((x) => x.id === desafioSel);
  if (!d) { tela = 'dupla'; return telaJuntos(); }
  const st = C.statusDesafio(d);
  const cks = DS[d.id]?.checkins || [];
  const placar = C.placarDesafio(d, cks, DS[d.id]?.pontos || []);
  const h = C.hoje();
  const fezHoje = cks.some((c) => c.uid === uid && c.data === h);
  let html = `<div class="treino-head fade-in"><button class="voltar" data-a="ir" data-id="dupla">‹ Desafios</button>
    <div class="d-head"><h2>🏆 ${esc(d.nome)}</h2><button class="ico g" data-a="menu-desafio" data-id="${d.id}" aria-label="Opções">⋯</button></div>
    <div class="m">${esc(dataCurta(d.inicio))} – ${esc(dataCurta(d.fim))} · ${(CRITERIO[d.criterio] || CRITERIO.dias)[1]} · ${plural(d.membros.length, 'pessoa', 'pessoas')}</div>
    ${d.descricao ? `<div class="d-desc">${esc(d.descricao)}</div>` : ''}</div>
    <div class="card g"><div class="lbl">${esc(faseTxt(d, st))}</div><div class="barra" style="margin-top:10px"><div style="width:${st.fase === 'futuro' ? 0 : Math.round((st.dia / st.total) * 100)}%"></div></div>
      <div class="acoes" style="margin-top:14px">${st.fase === 'ativo' ? `<button class="btn ${fezHoje ? '' : 'lime'}" data-a="checkin">${fezHoje ? '+ Outro check-in' : '📸 Fazer check-in'}</button>` : ''}<button class="btn" data-a="convidar-desafio" data-id="${d.id}">Convidar</button></div></div>`;

  html += `<div class="sec"><div class="sec-h"><h3>Placar</h3><span class="tag green">${(CRITERIO[d.criterio] || CRITERIO.dias)[0]}</span></div><div class="list g">`
    + placar.map((p) => {
      const pe = pessoaDesafio(d, p.uid);
      return `<div class="row ${p.uid === uid ? 'eu' : ''}"><div class="pos-n">${p.pontos ? medalha(p.pos) : '–'}</div>${avatarHTML(pe.foto, pe.nome)}
        <div class="info"><div class="t">${esc(pe.nome)}${p.saiu ? ' <small>(saiu)</small>' : ''}</div><div class="m">${plural(p.dias, 'dia', 'dias')} · ${duracaoTxt(p.minutos)} · ${plural(p.checkins, 'check-in', 'check-ins')}</div></div>
        <div class="v">${esc(pontosTxt(d, p))}</div></div>`;
    }).join('') + '</div></div>';

  html += '<div class="sec"><div class="sec-h"><h3>Atividade</h3></div>';
  if (!cks.length) html += `<div class="vazio g">${st.fase === 'futuro' ? 'O desafio ainda não começou. Os check-ins aparecem aqui a partir do primeiro dia.' : 'Nenhum check-in ainda. Seja a primeira pessoa! 💪'}</div>`;
  for (const c of cks.slice(0, 40)) {
    const pe = pessoaDesafio(d, c.uid);
    const t = C.tipoInfo(c.tipo);
    const fotos = fotosDoCheckin(d.id, c);
    const reac = Object.entries(c.reacoes || {}).filter(([, v]) => v);
    const minha = c.reacoes?.[uid];
    const conta = (e) => reac.filter(([, v]) => v === e).length;
    html += `<div class="ck g">
      <div class="ck-top">${avatarHTML(pe.foto, pe.nome)}<div class="info"><div class="t">${esc(primeiroNome(pe.nome))}</div><div class="m">${esc(C.rotuloDia(c.data))}${c.data < d.inicio || c.data > d.fim ? ' · fora do período' : ''}</div></div>${c.uid === uid ? `<button class="link" data-a="ver-checkin-d" data-d="${d.id}" data-id="${c.id}">Editar</button>` : ''}</div>
      ${fotos.length ? `<div class="ck-imgs n${fotos.length}">${fotos.map((src, i) => `<img src="${src}" alt="" data-a="ver-img-ck" data-d="${d.id}" data-id="${c.id}" data-i="${i}">`).join('')}</div>` : c.nFotos ? '<div class="ck-imgs carregando"></div>' : ''}
      <div class="ck-t">${t.e} ${esc(c.titulo || t.nome)}</div>
      <div class="ck-m">${resumoCheckin(c)}</div>
      ${c.nota ? `<div class="ck-nota">“${esc(c.nota)}”</div>` : ''}
      <div class="reacoes">${['🔥', '💪', '👏', '❤️'].map((e) => `<button class="${minha === e ? 'on' : ''}" data-a="reagir-ck" data-d="${d.id}" data-id="${c.id}" data-v="${e}">${e}${conta(e) ? ` <small>${conta(e)}</small>` : ''}</button>`).join('')}</div>
    </div>`;
  }
  return html + '</div>';
}

function modalDesafio(existente = null) {
  const d = existente || {};
  const amanha = C.somarDias(C.hoje(), 1);
  const ini = d.inicio || amanha;
  const fim = d.fim || C.somarDias(ini, 29);
  const dupla = (D.perfil?.parceiros || []).filter((x) => x !== uid && !(d.membros || []).includes(x));
  abrirModal(existente ? 'Editar desafio' : 'Novo desafio', `<form id="f-desafio">
    <label>Nome</label><input name="nome" value="${esc(d.nome || '')}" placeholder="Ex.: Verão 2027 💪" required maxlength="60">
    <label>Regras / combinado <small>(opcional)</small></label><input name="descricao" value="${esc(d.descricao || '')}" placeholder="Ex.: mínimo 40 min; quem perder paga o jantar" maxlength="200">
    <div class="linha"><div><label>Começa</label><input type="date" name="inicio" value="${ini}" required></div><div><label>Termina</label><input type="date" name="fim" value="${fim}" required></div></div>
    <div class="chips" style="margin-top:10px">${[7, 14, 30, 60, 90].map((n) => `<button type="button" class="chip" data-dur="${n}">${n} dias</button>`).join('')}</div>
    <label>Quem ganha</label><div class="seg">
      <label><input type="radio" name="criterio" value="pontos" ${!d.criterio || d.criterio === 'pontos' ? 'checked' : ''}>Mais pontos</label>
      <label><input type="radio" name="criterio" value="dias" ${d.criterio === 'dias' ? 'checked' : ''}>Mais dias treinados</label>
      <label><input type="radio" name="criterio" value="minutos" ${d.criterio === 'minutos' ? 'checked' : ''}>Mais minutos</label></div>
    <p class="rodape" style="text-align:left;margin-top:6px">Pontos = soma do Placar do dia (alimentação, treino, cardio, água e bônus), cada um contra o próprio objetivo.</p>
    ${dupla.length ? `<label>Participantes da dupla</label>${dupla.map((p) => `<label class="chk-l"><input type="checkbox" name="membro" value="${p}" ${existente ? '' : 'checked'}>${esc(P[p]?.perfil?.nome || 'Parceiro(a)')}</label>`).join('')}` : ''}
    <p class="rodape" style="text-align:left;margin-top:12px">Outras pessoas entram com um código (botão Convidar dentro do desafio).</p>
    <p class="erro" id="d-erro"></p>
    <div class="acoes"><button class="btn lime">${existente ? 'Salvar' : 'Criar desafio'}</button></div>
  </form>`, (el) => {
    const f = el.querySelector('form');
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-dur]'); if (b) f.fim.value = C.somarDias(f.inicio.value || amanha, Number(b.dataset.dur) - 1); });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!f.inicio.value || !f.fim.value || f.fim.value < f.inicio.value) { el.querySelector('#d-erro').textContent = 'O fim precisa ser depois do começo.'; return; }
      const novos = [...f.querySelectorAll('[name=membro]:checked')].map((x) => x.value);
      const perfis = Object.fromEntries(novos.map((p) => [p, { nome: P[p]?.perfil?.nome || 'Parceiro(a)', foto: P[p]?.perfil?.foto || '' }]));
      const campos = { nome: f.nome.value.trim(), descricao: f.descricao.value.trim(), inicio: f.inicio.value, fim: f.fim.value, criterio: f.criterio.value };
      if (existente) {
        store.definir(['desafios', d.id], { ...campos, membros: [...new Set([...d.membros, ...novos])], perfis }, true);
        toast('Desafio atualizado');
      } else {
        const id = store.novoId();
        store.definir(['desafios', id], { ...campos, dono: uid, membros: [uid, ...novos], perfis: { [uid]: eu(), ...perfis }, criado: Date.now() }, false);
        desafioSel = id; tela = 'desafio';
        toast('🏆 Desafio criado!');
      }
      fecharModal();
    });
  });
}

async function modalConvidarDesafio(id) {
  const d = D.desafios.find((x) => x.id === id);
  if (!d) return;
  abrirModal('Convidar para o desafio', '<div class="vazio">Gerando…</div>');
  try {
    const cod = await store.criarEntrada(id, d.nome);
    const link = location.origin + location.pathname;
    $('#modal-corpo').innerHTML = `<p class="hero-sub" style="text-align:center">Mande este código. A pessoa abre o app, vai em <b>Juntos → Desafios → Tenho um código</b> e digita.</p>
      <div class="codigo">${cod}</div><p class="rodape" style="margin-top:0">Vale por ${ENTRADA_DIAS} dias e serve para mais de uma pessoa.</p>
      <div class="acoes"><button class="btn lime" id="compartilhar">Compartilhar</button><button class="btn" id="copiar">Copiar</button></div>`;
    const texto = `Bora pro desafio "${d.nome}" no Fôlego 🏆\nAbre ${link} → Juntos → Desafios → Tenho um código → ${cod}`;
    $('#copiar').onclick = async () => { try { await navigator.clipboard.writeText(texto); toast('Copiado'); } catch (e) { toast(cod); } };
    $('#compartilhar').onclick = async () => { if (navigator.share) navigator.share({ text: texto }).catch(() => {}); else $('#copiar').click(); };
  } catch (e) {
    $('#modal-corpo').innerHTML = `<p class="erro">Não foi possível gerar o código: ${esc(e.message)}</p>`;
  }
}

function modalEntrarDesafio() {
  abrirModal('Entrar num desafio', `<form><label>Código que você recebeu</label><input name="cod" class="codigo-in" maxlength="6" autocomplete="off" autocapitalize="characters" required><p id="cod-erro" class="erro"></p><div class="acoes"><button class="btn lime">Entrar</button></div></form>`, (el) => {
    const f = el.querySelector('form');
    setTimeout(() => f.cod.focus(), 200);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await store.entrarDesafio(f.cod.value.trim().toUpperCase(), eu());
        fecharModal(); toast(`🏆 Você entrou em "${r.nome}"!`); desafioSel = r.id; tela = 'desafio'; agendarRender();
      } catch (err) {
        el.querySelector('#cod-erro').textContent = err.code === 'permission-denied' ? 'Código inválido ou vencido.' : err.message;
      }
    });
  });
}

function modalMenuDesafio(id) {
  const d = D.desafios.find((x) => x.id === id);
  if (!d) return;
  const dono = d.dono === uid;
  abrirModal(d.nome, `<div class="list g">
    ${dono ? '<div class="row clic" data-op="editar"><div class="info"><div class="t">Editar desafio</div><div class="m">Nome, datas, regra e participantes da dupla</div></div><span class="seta">›</span></div>' : ''}
    <div class="row clic perigo" data-op="sair"><div class="info"><div class="t">Sair do desafio</div><div class="m">Seus check-ins continuam no seu Hoje</div></div></div>
    ${dono ? '<div class="row clic perigo" data-op="apagar"><div class="info"><div class="t">Apagar desafio</div><div class="m">Some para todo mundo</div></div></div>' : ''}
  </div><div id="confirma"></div>`, (el) => {
    el.addEventListener('click', async (e) => {
      const r = e.target.closest('[data-op]'); if (!r) return;
      const op = r.dataset.op;
      if (op === 'editar') { fecharModal(); modalDesafio(d); return; }
      if (op === 'sair' || op === 'apagar') {
        el.querySelector('#confirma').innerHTML = `<p class="hero-sub" style="margin-top:14px">${op === 'sair' ? 'Sair deste desafio?' : 'Apagar o desafio para todos? Não dá para desfazer.'}</p><div class="acoes"><button class="btn danger" data-op="${op}-ok">${op === 'sair' ? 'Sair' : 'Apagar'}</button></div>`;
        return;
      }
      if (op === 'sair-ok') await store.sairDesafio(id);
      if (op === 'apagar-ok') await store.remover(['desafios', id]);
      D.desafios = D.desafios.filter((x) => x.id !== id);
      fecharModal(); tela = 'dupla'; toast(op === 'sair-ok' ? 'Você saiu do desafio' : 'Desafio apagado'); agendarRender();
    });
  });
}

function modalFotos(fotos, extra = '') {
  abrirModal('Foto', fotos.map((src) => `<img class="foto-grande" src="${src}" alt="">`).join('<div style="height:10px"></div>') + extra);
}

// ---------- Dupla ----------
function telaDupla() {
  const lista = (D.perfil?.parceiros || []).filter((x) => x !== uid);
  let html = '<p class="hero-sub" style="margin:16px 4px 14px">A ofensiva da dupla só cresce quando todo mundo cumpre o dia. ❄️ Congelamentos seguram a sequência num dia ruim.</p>';
  if (!lista.length) {
    html += `<div class="vazio g"><span class="big">🤝</span>Chame sua dupla para acompanhar o dia um do outro, reagir e manter a ofensiva juntos.
      <div class="acoes"><button class="btn lime" data-a="gerar-codigo">Gerar código</button><button class="btn" data-a="digitar-codigo">Tenho um código</button></div></div>`;
    return html;
  }
  for (const p of lista) html += cartaoParceiro(p);
  if (lista.length < MAX_PARCEIROS) {
    html += '<div class="acoes"><button class="btn" data-a="gerar-codigo">+ Convidar mais alguém</button><button class="btn" data-a="digitar-codigo">Tenho um código</button></div>';
  }
  return html;
}

function cartaoParceiro(p) {
  const o = P[p] || {};
  const pf = o.perfil;
  if (!pf) return '<div class="par g"><div class="par-top"><span class="avatar">…</span><div class="info"><div class="t">Carregando…</div><div class="m">Se não carregar, a outra pessoa pode ter desfeito a dupla.</div></div></div></div>';
  const h = C.hoje();
  const meu = minhaOfensiva();
  const duo = ofensivaComParceiro(pf);
  const mapaP = mapaParceiro(pf);
  const nome = esc(primeiroNome(pf.nome));
  const ofP = pf.ofensiva || { atual: 0 };
  const parHoje = mapaP[h] === 'ok';

  // Tira de 14 dias: eu em cima, a dupla embaixo
  const dias = [...C.diasEntre(C.somarDias(h, -13), h)];
  const cel = (v) => `<i class="${v === 'semdados' ? 'pendente' : v || ''}"></i>`;
  const tira = `<div class="tira">${dias.map((d) => `<div>${cel(meu.mapa[d])}${cel(mapaP[d])}<span>${C.SEMANA[C.diaSemana(d)][0].toUpperCase()}</span></div>`).join('')}</div>
    <div class="tira-leg"><span>em cima: você · embaixo: ${nome}</span><span>🟩 cumprido · 🟦 congelado</span></div>`;

  // O dia de hoje da dupla
  const dia = (o.dias || []).find((x) => x.id === h);
  let detalhe = '';
  if (!dia) {
    detalhe = `<div class="linha-st"><span class="s">⏳</span><span class="x">${nome} ainda não registrou nada hoje.</span></div>`;
  } else {
    const pv = dia.prev || {};
    if (pv.treino) {
      const ok = Object.values(dia.series || {}).reduce((a, arr) => a + (arr || []).filter((s) => s && s.ok).length, 0);
      detalhe += `<div class="linha-st"><span class="s">${dia.treinoFeito ? '✅' : '🏋️'}</span><span>${esc(pv.treino.nome)} <span class="x">· ${dia.treinoFeito ? 'concluído' : `${ok}/${pv.treino.total} séries`}</span></span></div>`;
    } else {
      detalhe += '<div class="linha-st"><span class="s">😌</span><span class="x">Dia de descanso</span></div>';
    }
    for (const c of o.checkins || []) {
      detalhe += `<div class="linha-st"><span class="s">📸</span><span>${C.tipoInfo(c.tipo).e} ${esc(c.titulo || C.tipoInfo(c.tipo).nome)} <span class="x">· ${resumoCheckin(c)}</span></span></div>`;
    }
    const ic ={ ok: '✅', troca: '🔄', pulou: '❌' };
    for (const r of pv.refeicoes || []) {
      const s = (dia.refeicoes || {})[r.id];
      const nota = (dia.notas || {})[r.id];
      detalhe += `<div class="linha-st"><span class="s">${ic[s] || '▫️'}</span><span>${esc(r.nome)}${nota ? ` <span class="x">· ${esc(nota)}</span>` : ''}</span></div>`;
    }
    if (dia.agua) detalhe += `<div class="linha-st"><span class="s">💧</span><span>${num(dia.agua / 1000)} L <span class="x">de ${num((pv.metaAgua || 2500) / 1000)} L</span></span></div>`;
    const fotos = (o.fotos || []).filter((f) => f.data === h);
    const fotosCk = (o.checkins || []).flatMap((c) => (c.fotos || []).map((src, i) => ({ c, i, src })));
    if (fotos.length || fotosCk.length) {
      detalhe += `<div class="fotos">${fotosCk.map((x) => `<img src="${x.src}" alt="" data-a="ver-ck-par" data-p="${p}" data-id="${x.c.id}" data-i="${x.i}">`).join('')}${fotos.map((f) => `<img src="${f.img}" alt="" data-a="ver-foto-par" data-p="${p}" data-id="${f.id}">`).join('')}</div>`;
    }
  }
  const minha = dia?.reacoes?.[uid];
  const reacoes = ['🔥', '💪', '👏', '❤️', '🥗'].map((e) => `<button class="${minha === e ? 'on' : ''}" data-a="reagir" data-p="${p}" data-v="${e}" ${dia ? '' : 'disabled'}>${e}</button>`).join('');

  return `<div class="par g fade-in">
    <div class="par-top">${avatarHTML(pf.foto, pf.nome)}<div class="info"><div class="t">${esc(pf.nome)}</div>
      <div class="m">🔥 ${plural(ofP.atual || 0, 'dia seguido', 'dias seguidos')}${ofP.gelo ? ` · ❄️ ${ofP.gelo}` : ''} · hoje ${parHoje ? 'cumprido ✓' : `${pf.hoje?.progresso ?? 0}%`}</div></div>
      <button class="ico g" data-a="menu-par" data-p="${p}" aria-label="Opções">⋯</button></div>
    <div class="duo"><div class="av2">${avatarHTML(usuario.photoURL, usuario.displayName)}${avatarHTML(pf.foto, pf.nome)}</div>
      <span class="f ${duo.hojeOk ? '' : 'off'}">🔥</span><span class="num ${duo.atual ? 'on' : ''}">${duo.atual}</span></div>
    <div class="duo-lbl">${duo.hojeOk ? 'Vocês dois cumpriram hoje! 🎉' : `dias juntos · ${meu.hojeOk ? `falta ${nome}` : parHoje ? 'falta você' : 'falta os dois'} hoje`}${duo.recorde > duo.atual ? ` · recorde ${duo.recorde}` : ''}</div>
    ${tira}
    <div class="dia-par"><h4>Hoje de ${nome}</h4>${detalhe}</div>
    <div class="reacoes">${reacoes}<button class="cutucar" data-a="cutucar" data-p="${p}">👉 Cutucar</button></div>
  </div>`;
}

// ---------- Progresso ----------
function telaProgresso() {
  const of = minhaOfensiva();
  const [a, m] = mesSel.split('-').map(Number);
  const prim = `${mesSel}-01`;
  const ultDia = new Date(a, m, 0).getDate();
  const diasMes = [...C.diasEntre(prim, `${mesSel}-${String(ultDia).padStart(2, '0')}`)];
  const cumpridosMes = diasMes.filter((d) => of.mapa[d] === 'ok').length;
  const treinosMes = D.dias.filter((x) => x.id.startsWith(mesSel) && x.treinoFeito).length;

  let html = `<div class="hero fade-in" style="padding-bottom:16px"><div class="ola">Progresso</div></div>
    <div class="grid2">
      <div class="card g"><div class="lbl">Ofensiva atual</div><div class="val">🔥 ${of.atual}</div><div class="sub">recorde ${of.recorde}</div></div>
      <div class="card g"><div class="lbl">Congelamentos</div><div class="val">❄️ ${of.gelo}/${C.MAX_GELO}</div><div class="sub">+1 toda segunda</div></div>
    </div>`;

  // Calendário
  const vazios = (C.diaSemana(prim) + 6) % 7; // semana começa na segunda
  html += `<div class="card g"><div class="ano-nav" style="margin:0"><button class="ico g" data-a="mes" data-v="-1">‹</button><b style="font-size:1rem">${C.nomeMes(m - 1)} ${a}</b><button class="ico g" data-a="mes" data-v="1" ${mesSel >= C.hoje().slice(0, 7) ? 'disabled' : ''}>›</button></div>
    <div class="cal-h">${['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="cal">${'<i class="vz"></i>'.repeat(vazios)}${diasMes.map((d) => `<i class="${of.mapa[d] || ''}">${Number(d.slice(8))}</i>`).join('')}</div>
    <div class="cal-leg"><span><i style="background:var(--lime)"></i>cumprido</span><span><i style="background:rgba(125,211,252,.5)"></i>congelado</span><span><i style="background:rgba(251,113,133,.35)"></i>não cumprido</span></div>
    <div class="stats" style="margin-top:14px"><div><div class="lbl">Dias cumpridos</div><div class="val">${cumpridosMes}</div></div><div><div class="lbl">Treinos</div><div class="val">${treinosMes}</div></div><div><div class="lbl">Recorde</div><div class="val">${of.recorde}</div></div></div>
  </div>`;

  // Peso
  const pesos = D.pesos;
  const ult = pesos.at(-1);
  const delta = ult && pesos.length > 1 ? ult.kg - pesos[0].kg : null;
  html += `<div class="sec"><div class="sec-h"><h3>⚖️ Peso</h3><button data-a="novo-peso">+ Registrar</button></div><div class="card g">`;
  if (!pesos.length) html += '<div class="sub" style="color:var(--muted)">Registre seu peso uma vez por semana, de manhã e em jejum, para ver a tendência. Fica só com você.</div>';
  else {
    html += `<div class="lbl">Atual</div><div class="val">${num(ult.kg)} kg ${delta != null ? `<span class="delta ${delta <= 0 ? 'pos' : 'warn'}">${delta > 0 ? '+' : ''}${num(delta)} kg desde ${esc(C.paraData(pesos[0].id).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }))}</span>` : ''}</div>`;
    if (pesos.length > 1) html += grafico(pesos.map((p) => ({ x: p.id, y: p.kg })), 'kg');
  }
  html += '</div></div>';

  // Exercícios
  const exs = new Map();
  for (const t of D.plano?.treinos || []) for (const e of t.exercicios) if (!exs.has(e.id)) exs.set(e.id, e.nome);
  const linhas = [...exs].map(([id, nome]) => ({ id, nome, hist: C.historicoExercicio(D.dias, id) })).filter((x) => x.hist.length);
  html += '<div class="sec"><div class="sec-h"><h3>🏆 Cargas e recordes</h3></div>';
  if (!linhas.length) html += '<div class="vazio g">Anote as cargas no treino e os recordes aparecem aqui.</div>';
  else {
    html += '<div class="list g">' + linhas.map((x) => {
      const best = Math.max(...x.hist.map((h) => h.kg));
      const quando = x.hist.find((h) => h.kg === best).data;
      return `<div class="row clic" data-a="ver-exercicio" data-id="${x.id}"><div class="ic" style="--c:#c6f432">🏋️</div><div class="info"><div class="t">${esc(x.nome)}</div><div class="m">${plural(x.hist.length, 'treino', 'treinos')} · recorde em ${esc(C.paraData(quando).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }))}</div></div><div class="v">${num(best)} kg</div><span class="seta">›</span></div>`;
    }).join('') + '</div>';
  }
  html += '</div>';
  return html;
}

function grafico(pts, un) {
  if (pts.length < 2) return '';
  const W = 320, H = 130, pad = 18;
  const ys = pts.map((p) => p.y);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (max - min < 1) { min -= 1; max += 1; }
  const x = (i) => pad + (i * (W - pad * 2)) / (pts.length - 1);
  const y = (v) => H - pad - ((v - min) / (max - min)) * (H - pad * 2);
  const linha = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const area = `${linha} L${x(pts.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  const fmtD = (s) => C.paraData(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `<svg class="graf" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <line class="gr" x1="${pad}" x2="${W - pad}" y1="${y(max)}" y2="${y(max)}"/><line class="gr" x1="${pad}" x2="${W - pad}" y1="${y(min)}" y2="${y(min)}"/>
    <path class="ar" d="${area}"/><path class="ln" d="${linha}"/>
    ${pts.map((p, i) => `<circle class="pt" cx="${x(i)}" cy="${y(p.y)}" r="${pts.length > 20 ? 1.8 : 3}"/>`).join('')}
    <text x="${pad}" y="${H - 2}">${fmtD(pts[0].x)}</text><text x="${W - pad}" y="${H - 2}" text-anchor="end">${fmtD(pts.at(-1).x)}</text>
    <text x="${W - pad}" y="${y(max) - 4}" text-anchor="end">${num(max)} ${un}</text>
  </svg>`;
}

// ---------- Plano ----------
function telaPlano() {
  const plano = D.plano;
  let html = '<div class="hero fade-in" style="padding-bottom:14px"><div class="ola">Plano</div><div class="hero-sub">Treino da semana e dieta do dia. Para mudar, edite o texto.</div></div>';
  if (!plano) {
    return html + '<div class="vazio g"><span class="big">📋</span>Cole o plano de treino e a dieta. O formato é simples e tem exemplo.<div class="acoes"><button class="btn lime" data-a="editar-plano">Montar meu plano</button></div></div>';
  }
  const ag = plano.agenda || {};
  const letra = (id) => { const t = plano.treinos.find((x) => x.id === id); return t ? esc(t.nome.split(/[ ·:]/)[0]).slice(0, 3) : ''; };
  html += `<div class="card g"><div class="lbl">Semana</div><div class="plano-dias">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<span class="${ag[d] ? 'on' : ''}">${C.SEMANA[d]}<b>${ag[d] ? letra(ag[d]) : '—'}</b></span>`).join('')}</div></div>`;
  for (const t of plano.treinos) {
    const dias = Object.entries(ag).filter(([, v]) => v === t.id).map(([k]) => C.SEMANA[k]);
    html += `<div class="sec"><div class="sec-h"><h3>🏋️ ${esc(t.nome)}</h3><span class="tag green">${dias.join(', ') || 'sem dia fixo'}</span></div><div class="list g">`
      + t.exercicios.map((e) => `<div class="row"><div class="info"><div class="t">${esc(e.nome)}</div><div class="m">${esc([seriesTxt(e), e.descanso ? `${e.descanso}s descanso` : '', e.obs].filter(Boolean).join(' · '))}</div></div></div>`).join('')
      + '</div></div>';
  }
  if (plano.refeicoes?.length) {
    html += '<div class="sec"><div class="sec-h"><h3>🍽️ Dieta</h3></div><div class="list g">'
      + plano.refeicoes.map((r) => `<div class="ref"><div class="hora">${esc(r.hora)}</div><div class="info"><div class="t">${esc(r.nome)}</div><div class="itens">${r.itens.map(esc).join(' · ')}</div></div></div>`).join('')
      + '</div></div>';
  }
  html += '<div class="acoes"><button class="btn lime" data-a="editar-plano">Editar plano</button></div>';
  return html;
}

// ---------- Perfil ----------
function telaPerfil() {
  const pr = prefs();
  const of = minhaOfensiva();
  const nPar = (D.perfil?.parceiros || []).length;
  return `<div class="perfil fade-in">${avatarHTML(usuario.photoURL, usuario.displayName)}<div><div class="nome">${esc(usuario.displayName || 'Sem nome')}</div><div class="mail">${esc(usuario.email || '')}</div><div class="via">${esc(syncStatus || '')}</div></div></div>
  <div class="sec"><div class="sec-h"><h3>Metas</h3></div><div class="list g">
    <div class="row clic" data-a="objetivo"><div class="info"><div class="t">Meu objetivo</div><div class="m">${metas().completo ? `${metas().kcal} kcal · ${metas().prot} g de proteína por dia` : 'Peso, altura e objetivo para as metas e notas'}</div></div><span class="val-d">${esc(C.OBJETIVOS[metas().objetivo])}</span><span class="seta">›</span></div>
    <div class="row clic" data-a="meta-ref"><div class="info"><div class="t">Refeições para cumprir o dia</div><div class="m">Seguidas ou trocadas</div></div><span class="val-d">${pr.metaRefeicoes}%</span><span class="seta">›</span></div>
    <div class="row clic" data-a="meta-agua"><div class="info"><div class="t">Meta de água</div><div class="m">Não conta para a ofensiva</div></div><span class="val-d">${num(pr.metaAgua / 1000)} L</span><span class="seta">›</span></div>
    <div class="row clic" data-a="meta-desc"><div class="info"><div class="t">Descanso padrão entre séries</div><div class="m">Quando o plano não diz</div></div><span class="val-d">${pr.descanso}s</span><span class="seta">›</span></div>
  </div></div>
  <div class="sec"><div class="sec-h"><h3>Ofensiva</h3></div><div class="list g">
    <div class="row"><div class="info"><div class="t">${inicio() > C.hoje() ? 'Começa em' : 'Começou em'}</div></div><span class="val-d">${esc(C.paraData(inicio()).toLocaleDateString('pt-BR'))}</span></div>
    <div class="row"><div class="info"><div class="t">Recorde</div></div><span class="val-d">🔥 ${of.recorde}</span></div>
    <div class="row clic" data-a="ir" data-id="dupla"><div class="info"><div class="t">Dupla</div></div><span class="val-d">${nPar ? plural(nPar, 'pessoa', 'pessoas') : 'ninguém ainda'}</span><span class="seta">›</span></div>
  </div></div>
  <div class="sec"><div class="list g">
    <div class="row clic" data-a="ir" data-id="plano"><div class="info"><div class="t">Ver plano da semana</div></div><span class="seta">›</span></div>
    <div class="row clic" data-a="editar-plano"><div class="info"><div class="t">Editar plano de treino e dieta</div></div><span class="seta">›</span></div>
    <div class="row clic" data-a="exportar"><div class="info"><div class="t">Exportar backup (JSON)</div></div><span class="seta">›</span></div>
    <div class="row clic perigo" data-a="sair"><div class="info"><div class="t">Sair${store.local ? ' (trocar conta de teste)' : ''}</div></div></div>
  </div></div>
  <div class="rodape">Fôlego v${VERSAO}${modoLocal ? ' · modo local de teste' : ''}<br>Dados no Firebase, protegidos por conta. A dupla vê só o resumo do dia, refeições, check-ins e fotos. Nos desafios, os participantes veem os check-ins enviados para lá.</div>`;
}

// ---------------- Modal ----------------
function abrirModal(titulo, corpo, aoAbrir) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-corpo').innerHTML = corpo;
  $('#modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (aoAbrir) aoAbrir($('#modal-corpo'));
}
function fecharModal() {
  $('#modal').classList.add('hidden');
  document.body.style.overflow = '';
  $('#modal-corpo').innerHTML = '';
  agendarRender();
}

function modalPlano() {
  const p = D.plano || {};
  abrirModal('Plano de treino e dieta', `<form id="f-plano">
    <details class="dicas"><summary>Como escrever</summary><div class="dica"><p class="ajuda-fmt">
      <b>Treino</b>: uma linha <code>TREINO A: Nome | seg, qui</code> e depois um exercício por linha, como <code>Supino reto 4x8-10 90s (obs)</code>. Os dias sem treino são descanso.<br><br>
      <b>Dieta</b>: uma refeição por linha, como <code>07:30 Café da manhã: 2 ovos; 1 pão</code>. Linhas começando com <code>-</code> viram itens da refeição de cima.<br><br>
      Dica: peça ao Claude "reescreva meu plano neste formato" e cole aqui.</p></div></details>
    <label class="btn importar">📄 Importar de arquivo (PDF, Word, Excel)<input type="file" name="arquivo" hidden></label>
    <div id="importado" class="hidden"></div>
    <label>Treino</label><textarea name="treino" placeholder="TREINO A: Superiores | seg, qui&#10;Supino reto 4x10 90s">${esc(p.treinoTexto || '')}</textarea>
    <label>Dieta</label><textarea name="dieta" placeholder="07:30 Café da manhã: 2 ovos; 1 pão integral">${esc(p.dietaTexto || '')}</textarea>
    <div id="previa" class="aviso"></div>
    <div class="acoes">${p.treinoTexto || p.dietaTexto ? '' : '<button type="button" class="btn" data-a="exemplo-plano">Usar exemplo</button>'}<button class="btn lime">Salvar plano</button></div>
  </form>`, (el) => {
    const f = el.querySelector('form');
    const previa = () => {
      const t = C.lerTreino(f.treino.value); const d = C.lerDieta(f.dieta.value);
      const nEx = t.treinos.reduce((a, x) => a + x.exercicios.length, 0);
      const dias = Object.keys(t.agenda).length;
      el.querySelector('#previa').innerHTML = `Entendi: <b>${plural(t.treinos.length, 'treino', 'treinos')}</b> (${plural(nEx, 'exercício', 'exercícios')}), ${plural(dias, 'dia', 'dias')} de treino na semana e <b>${plural(d.refeicoes.length, 'refeição', 'refeições')}</b> por dia.`
        + (t.treinos.length && !dias ? '<br>⚠️ Nenhum dia da semana definido: coloque <code>| seg, qua, sex</code> depois do nome do treino.' : '');
    };
    f.addEventListener('input', previa); previa();
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = C.lerTreino(f.treino.value); const d = C.lerDieta(f.dieta.value);
      store.definir(['usuarios', uid, 'config', 'plano'], { treinoTexto: f.treino.value, dietaTexto: f.dieta.value, treinos: t.treinos, agenda: t.agenda, refeicoes: d.refeicoes, atualizado: Date.now() }, false);
      fecharModal(); toast('Plano salvo ✓');
    });
    el.querySelector('[data-a="exemplo-plano"]')?.addEventListener('click', () => { f.treino.value = C.EXEMPLO_TREINO; f.dieta.value = C.EXEMPLO_DIETA; previa(); });
    import('./importar.js?v=0.4').then((I) => { f.arquivo.accept = I.ACEITA; }).catch(() => {});
    f.arquivo.addEventListener('change', async () => {
      const arq = f.arquivo.files[0]; f.arquivo.value = '';
      if (!arq) return;
      const box = el.querySelector('#importado');
      box.className = 'aviso'; box.textContent = `Lendo ${arq.name}…`;
      try {
        const I = await import('./importar.js?v=0.4');
        const linhas = await I.lerArquivo(arq);
        const r = I.montarPlano(linhas);
        if (r.treino) f.treino.value = r.treino;
        if (r.dieta) f.dieta.value = r.dieta;
        const achou = [r.treino && 'treino', r.dieta && 'dieta'].filter(Boolean).join(' e ');
        box.innerHTML = (achou
          ? `✓ Li o <b>${esc(arq.name)}</b> e preenchi ${achou}${r.modelo ? ` (modelo: ${esc(r.modelo)})` : ''}. <b>Confira e ajuste</b> antes de salvar.`
          : `Não reconheci treino nem dieta em <b>${esc(arq.name)}</b>. O texto do arquivo está abaixo: copie o que precisar para os campos.`)
          + `<details class="dicas"><summary>Texto do arquivo</summary><textarea class="ta" readonly rows="8">${esc(I.textoOriginal(linhas))}</textarea></details>`;
        previa();
      } catch (e) {
        box.className = 'aviso'; box.textContent = '⚠️ ' + (e.message || 'Não consegui ler o arquivo.');
      }
    });
  });
}

function modalTrocarTreino() {
  const dia = diaDoc(dataSel) || {};
  const atual = C.treinoDoDia(D.plano, dataSel, dia)?.id;
  abrirModal('Treino do dia', `<div class="list g">${D.plano.treinos.map((t) => `<div class="row clic" data-escolher="${t.id}"><div class="info"><div class="t">${esc(t.nome)}</div><div class="m">${plural(t.exercicios.length, 'exercício', 'exercícios')}</div></div>${t.id === atual ? '<span class="tag green">atual</span>' : '<span class="seta">›</span>'}</div>`).join('')}</div>
    ${dia.treinoId !== undefined ? '<div class="acoes"><button class="btn" data-escolher="__agenda">Voltar ao da agenda</button></div>' : ''}`, (el) => {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-escolher]'); if (!b) return;
      const v = b.dataset.escolher;
      if (v === '__agenda') {
        const t = (D.plano.agenda || {})[C.diaSemana(dataSel)] ?? null;
        salvarDia(dataSel, { treinoId: t });
      } else salvarDia(dataSel, { treinoId: v });
      fecharModal();
    });
  });
}

async function modalGerarCodigo() {
  abrirModal('Convidar para a dupla', '<div class="vazio">Gerando…</div>');
  try {
    const cod = await store.criarConvite(usuario.displayName || '');
    const link = location.origin + location.pathname;
    $('#modal-corpo').innerHTML = `<div data-esperando-dupla><p class="hero-sub" style="text-align:center">Mande este código para a outra pessoa. Ela abre o app, vai em <b>Dupla → Tenho um código</b> e digita.</p>
      <div class="codigo">${cod}</div><p class="rodape" style="margin-top:0">Vale por ${CONVITE_MIN} minutos. Esta tela fecha sozinha quando ela entrar.</p>
      <div class="acoes"><button class="btn lime" id="compartilhar">Compartilhar</button><button class="btn" id="copiar">Copiar</button></div></div>`;
    const texto = `Bora manter a ofensiva juntos no Fôlego 🔥\nAbre ${link} → Dupla → Tenho um código → ${cod}`;
    $('#copiar').onclick = async () => { try { await navigator.clipboard.writeText(texto); toast('Copiado'); } catch (e) { toast(cod); } };
    $('#compartilhar').onclick = async () => { if (navigator.share) navigator.share({ text: texto }).catch(() => {}); else $('#copiar').click(); };
  } catch (e) {
    $('#modal-corpo').innerHTML = `<p class="erro">Não foi possível gerar o código: ${esc(e.message)}</p>`;
  }
}

function modalDigitarCodigo() {
  abrirModal('Entrar numa dupla', `<form id="f-cod"><label>Código que você recebeu</label><input name="cod" class="codigo-in" maxlength="6" autocomplete="off" autocapitalize="characters" required><p id="cod-erro" class="erro"></p><div class="acoes"><button class="btn lime">Entrar</button></div></form>`, (el) => {
    const f = el.querySelector('form');
    setTimeout(() => f.cod.focus(), 200);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cod = f.cod.value.trim().toUpperCase();
      try {
        const c = await store.usarConvite(cod);
        fecharModal(); toast(`🤝 Agora você e ${primeiroNome(c.nome)} são dupla!`); tela = 'dupla'; agendarRender();
      } catch (err) {
        el.querySelector('#cod-erro').textContent = err.code === 'permission-denied' ? 'Código inválido ou vencido.' : err.message;
      }
    });
  });
}

function modalNumero(titulo, rotulo, valor, sufixo, salvar) {
  abrirModal(titulo, `<form><label>${esc(rotulo)}</label><input name="v" inputmode="decimal" class="valor-big" value="${esc(valor)}"><p class="rodape" style="margin-top:6px">${esc(sufixo)}</p><div class="acoes"><button class="btn lime">Salvar</button></div></form>`, (el) => {
    const f = el.querySelector('form');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Number(String(f.v.value).replace(',', '.'));
      if (!(v > 0)) return;
      salvar(v); fecharModal();
    });
  });
}

const salvarPrefs = (mud) => store.definir(['usuarios', uid, 'config', 'prefs'], mud, true);

function modalMetaRef() {
  const atual = prefs().metaRefeicoes;
  abrirModal('Meta de refeições', `<p class="hero-sub">Quantas refeições do plano precisam ser seguidas (ou trocadas por algo equivalente) para o dia contar na ofensiva.</p>
    <div class="seg" style="margin-top:14px">${[60, 80, 100].map((v) => `<label><input type="radio" name="m" value="${v}" ${v === atual ? 'checked' : ''}>${v}%</label>`).join('')}</div>`, (el) => {
    el.addEventListener('change', (e) => { salvarPrefs({ metaRefeicoes: Number(e.target.value) }); fecharModal(); });
  });
}

function modalExercicio(exId) {
  const nome = (D.plano?.treinos || []).flatMap((t) => t.exercicios).find((e) => e.id === exId)?.nome || exId;
  const hist = C.historicoExercicio(D.dias, exId);
  abrirModal(nome, `${grafico(hist.map((h) => ({ x: h.data, y: h.kg })), 'kg')}
    <div class="list g" style="margin-top:14px">${[...hist].reverse().map((h) => `<div class="row"><div class="info"><div class="t">${esc(C.rotuloDia(h.data))}</div><div class="m">${h.series.map((s) => `${num(s.kg)}×${s.reps || '?'}`).join(' · ')}</div></div><div class="v">${num(h.kg)} kg</div></div>`).join('')}</div>`);
}

// Foto: reduz para ~720px em JPEG para caber no Firestore (limite de 1 MB por documento).
function comprimir(file, max = 720, q = 0.62) {
  return new Promise((ok, erro) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      ok(cv.toDataURL('image/jpeg', q));
    };
    img.onerror = erro;
    img.src = URL.createObjectURL(file);
  });
}

let fotoPara = null;

// ---------------- Eventos ----------------
function ligarEventos() {
  $('#dia-ant').addEventListener('click', () => mudarDia(-1));
  $('#dia-prox').addEventListener('click', () => mudarDia(1));
  $('#dia-label').addEventListener('click', () => { dataSel = C.hoje(); assinarFotos(); agendarRender(); });
  $$('.dock button[data-tela]').forEach((b) => b.addEventListener('click', () => {
    tela = b.dataset.tela;
    if (tela === 'hoje' && dataSel !== C.hoje()) { dataSel = C.hoje(); assinarFotos(); }
    window.scrollTo(0, 0); render();
  }));
  $('#modal-fechar').addEventListener('click', fecharModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });
  document.addEventListener('click', aoClicar);
  document.addEventListener('change', (e) => {
    const i = e.target;
    if (i.matches('.serie input')) {
      const v = i.value.trim().replace(',', '.');
      gravarSerie(i.dataset.ex, Number(i.dataset.k), { [i.dataset.f]: v === '' ? null : Number(v) });
    }
  });
  $('#foto-in').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || !fotoPara) return;
    try {
      const img = await comprimir(f);
      const id = store.novoId();
      const { data, refeicaoId } = fotoPara;
      D.fotos.push({ id, data, refeicaoId, img });
      store.definir(['feed', uid, 'fotos', id], { data, refeicaoId, img, em: Date.now() }, false);
      const st = (diaDoc(data)?.refeicoes || {})[refeicaoId];
      if (!st) salvarDia(data, { refeicoes: { [refeicaoId]: 'ok' } });
      else agendarRender();
      toast('Foto salva 📸');
    } catch (err) { toast('Não foi possível ler a foto.'); }
  });
  // Volta para "hoje" quando o app fica aberto de um dia para o outro.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && usuario) {
      cacheOfensiva = null;
      if (parceirosAssinados) { const k = parceirosAssinados; parceirosAssinados = ''; for (const p of Object.keys(P)) { P[p].paradas.forEach((f) => f()); delete P[p]; } if (k) assinarParceiros(); }
      agendarRender();
    }
  });
}

function mudarDia(n) {
  const novo = C.somarDias(dataSel, n);
  if (novo > C.somarDias(C.hoje(), 6)) return;
  dataSel = novo;
  if (!['hoje', 'treino', 'comer'].includes(tela)) tela = 'hoje';
  if (tela === 'treino' && !C.treinoDoDia(D.plano, dataSel, diaDoc(dataSel))) tela = 'hoje';
  assinarFotos(); render();
}

function aoClicar(e) {
  const b = e.target.closest('[data-a]');
  if (!b || b.disabled) return;
  const a = b.dataset.a, id = b.dataset.id;
  const dia = diaDoc(dataSel) || {};
  switch (a) {
    case 'ir': tela = id; window.scrollTo(0, 0); render(); break;
    case 'editar-plano': modalPlano(); break;
    case 'trocar-treino': modalTrocarTreino(); break;
    case 'treino-feito': {
      const t = C.treinoDoDia(D.plano, dataSel, dia);
      salvarDia(dataSel, { treinoFeito: true, treinoId: t?.id ?? null });
      toast('Treino feito 💪');
      if (!D.checkins.some((c) => c.data === dataSel)) modalCheckin({ tipo: 'musculacao', titulo: t?.nome || '' });
      break;
    }
    case 'checkin': modalCheckin(); break;
    case 'ver-placar': modalPlacar(id || C.hoje()); break;
    case 'objetivo': modalObjetivo(); break;
    case 'habito': { const v = Math.max(0, (Number(dia[id]) || 0) + Number(b.dataset.v)); salvarDia(dataSel, { [id]: id === 'sono' ? Math.min(14, v) : Math.min(600, v) }); break; }
    case 'sem-alcool': salvarDia(dataSel, { semAlcool: !dia.semAlcool }); break;
    case 'passos': modalNumero('Passos', `Passos de ${C.rotuloDia(dataSel).toLowerCase()}`, dia.passos || '', 'Veja no Samsung Health ou no app Saúde do iPhone.', (v) => salvarDia(dataSel, { passos: Math.round(v) })); break;
    case 'comida-add': modalComida(b.dataset.v, b.dataset.grupo || null); break;
    case 'comida-ver': { const x = D.comidas.find((y) => y.id === id); if (x) { if (editavel(x.data)) modalComida(null, null, x); else toast('Esse dia já fechou.'); } break; }
    case 'ver-checkin': {
      const c = D.checkins.find((x) => x.id === id);
      if (!c) break;
      if (editavel(c.data)) modalCheckin({}, c);
      else modalFotos(c.fotos || [], `<div class="aviso">${C.tipoInfo(c.tipo).e} ${esc(c.titulo || C.tipoInfo(c.tipo).nome)} · ${resumoCheckin(c)}</div>`);
      break;
    }
    case 'ver-checkin-d': {
      store.lerDoc(['feed', uid, 'checkins', id]).then((c) => {
        if (!c) { toast('Check-in não encontrado.'); return; }
        if (editavel(c.data)) modalCheckin({}, c); else toast('Esse check-in já fechou. Dá para editar até anteontem.');
      });
      break;
    }
    case 'aba': aba = id; render(); break;
    case 'abrir-desafio': desafioSel = id; tela = 'desafio'; window.scrollTo(0, 0); render(); break;
    case 'novo-desafio': modalDesafio(); break;
    case 'entrar-desafio': modalEntrarDesafio(); break;
    case 'convidar-desafio': modalConvidarDesafio(id); break;
    case 'menu-desafio': modalMenuDesafio(id); break;
    case 'reagir-ck': {
      const c = (DS[b.dataset.d]?.checkins || []).find((x) => x.id === id);
      if (!c) break;
      const v = c.reacoes?.[uid] === b.dataset.v ? null : b.dataset.v;
      c.reacoes = { ...(c.reacoes || {}), [uid]: v };
      store.definir(['desafios', b.dataset.d, 'checkins', id], { reacoes: { [uid]: v } }, true);
      render();
      break;
    }
    case 'ver-img-ck': {
      const c = (DS[b.dataset.d]?.checkins || []).find((x) => x.id === id);
      if (c) modalFotos(fotosDoCheckin(b.dataset.d, c));
      break;
    }
    case 'ver-ck-par': {
      const c = (P[b.dataset.p]?.checkins || []).find((x) => x.id === id);
      if (c) modalFotos(c.fotos || [], `<div class="aviso">${C.tipoInfo(c.tipo).e} ${esc(c.titulo || C.tipoInfo(c.tipo).nome)} · ${resumoCheckin(c)}${c.nota ? `<br>“${esc(c.nota)}”` : ''}</div>`);
      break;
    }
    case 'treino-desfazer': salvarDia(dataSel, { treinoFeito: false }); break;
    case 'treino-concluir': {
      const t = C.treinoDoDia(D.plano, dataSel, dia);
      salvarDia(dataSel, { treinoFeito: true, treinoId: t?.id ?? null });
      pararTimer();
      const recs = C.recordesDoDia(D.dias, diaDoc(dataSel));
      const nomeEx = (x) => t?.exercicios.find((e2) => e2.id === x)?.nome || x;
      toast(recs.length ? `🏆 Recorde: ${recs.map((r) => `${nomeEx(r.exId)} ${num(r.kg)} kg`).join(', ')}` : 'Treino concluído 💪', 4000);
      tela = 'hoje'; window.scrollTo(0, 0); render();
      if (!D.checkins.some((c) => c.data === dataSel)) modalCheckin({ tipo: 'musculacao', titulo: t?.nome || '' });
      break;
    }
    case 'serie': {
      const ex = b.dataset.ex, k = Number(b.dataset.k);
      const arr = lerSeries(ex);
      const s = arr[k] || {};
      const linha = b.closest('.serie');
      const [inKg, inReps] = linha.querySelectorAll('input');
      const vKg = inKg.value.trim().replace(',', '.'), vReps = inReps.value.trim();
      const ok = !s.ok;
      const mud = { ok };
      // Marcar sem digitar usa o valor sugerido (última vez / plano)
      if (ok) {
        mud.kg = vKg !== '' ? Number(vKg) : inKg.placeholder ? Number(inKg.placeholder.replace(',', '.')) : null;
        mud.reps = vReps !== '' ? Number(vReps) : inReps.placeholder ? Number(inReps.placeholder) : null;
      }
      gravarSerie(ex, k, mud);
      if (ok) {
        const t = C.treinoDoDia(D.plano, dataSel, dia);
        const exo = t?.exercicios.find((x) => x.id === ex);
        iniciarTimer(exo?.descanso || prefs().descanso);
      }
      break;
    }
    case 'mais-serie': { const arr = lerSeries(b.dataset.ex); const t = C.treinoDoDia(D.plano, dataSel, dia); const exo = t?.exercicios.find((x) => x.id === b.dataset.ex); while (arr.length < (exo?.series || 1)) arr.push({}); arr.push({}); salvarDia(dataSel, { series: { [b.dataset.ex]: arr } }); break; }
    case 'timer-parar': pararTimer(); break;
    case 'timer-mais': timer.fim += Number(b.dataset.v) * 1000; tickTimer(); break;
    case 'ref': {
      const v = b.dataset.v;
      const atual = (dia.refeicoes || {})[id];
      const novo = atual === v ? null : v;
      salvarDia(dataSel, { refeicoes: { [id]: novo } });
      if (novo === 'troca') {
        abrirModal('O que comeu no lugar?', `<form><input name="n" placeholder="Opcional. Ex.: wrap de frango" value="${esc((dia.notas || {})[id] || '')}"><div class="acoes"><button type="button" class="btn" data-pular>Pular</button><button class="btn lime">Salvar</button></div></form>`, (el) => {
          const f = el.querySelector('form');
          setTimeout(() => f.n.focus(), 200);
          el.querySelector('[data-pular]').onclick = fecharModal;
          f.addEventListener('submit', (ev) => { ev.preventDefault(); salvarDia(dataSel, { notas: { [id]: f.n.value.trim() } }); fecharModal(); });
        });
      }
      break;
    }
    case 'foto': fotoPara = { data: dataSel, refeicaoId: id }; $('#foto-in').click(); break;
    case 'ver-foto': case 'ver-foto-par': {
      const f = a === 'ver-foto' ? D.fotos.find((x) => x.id === id) : (P[b.dataset.p]?.fotos || []).find((x) => x.id === id);
      if (!f) break;
      const meu = a === 'ver-foto' && editavel(f.data);
      abrirModal('Foto', `<img class="foto-grande" src="${f.img}" alt="">${meu ? '<div class="acoes"><button class="btn danger" data-apagar>Apagar foto</button></div>' : ''}`, (el) => {
        el.querySelector('[data-apagar]')?.addEventListener('click', () => { store.remover(['feed', uid, 'fotos', id]); D.fotos = D.fotos.filter((x) => x.id !== id); fecharModal(); });
      });
      break;
    }
    case 'agua': salvarDia(dataSel, { agua: Math.max(0, (dia.agua || 0) + Number(b.dataset.v)) }); break;
    case 'cutucada-ok': localStorage.setItem('fit-cutucada-vista', String(D.perfil?.cutucada?.em || Date.now())); render(); break;
    case 'gerar-codigo': modalGerarCodigo(); break;
    case 'digitar-codigo': modalDigitarCodigo(); break;
    case 'reagir': {
      const p = b.dataset.p;
      const h = C.hoje();
      const atual = (P[p]?.dias || []).find((x) => x.id === h)?.reacoes?.[uid];
      const v = atual === b.dataset.v ? null : b.dataset.v;
      store.definir(['feed', p, 'dias', h], { reacoes: { [uid]: v } }, true);
      if (v) toast(`${v} enviado`);
      break;
    }
    case 'cutucar': {
      const p = b.dataset.p;
      const chave = 'fit-cutucou-' + p;
      if (Date.now() - Number(localStorage.getItem(chave) || 0) < 30 * 60000) { toast('Você já cutucou há pouco. Dá um tempinho 😅'); break; }
      const msgs = ['Bora treinar! 💪', 'Não deixa a ofensiva cair 🔥', 'Já bebeu água hoje? 💧', 'Bora cumprir o dia juntos!'];
      abrirModal('Cutucar', `<div class="list g">${msgs.map((m) => `<div class="row clic" data-msg="${esc(m)}"><div class="info"><div class="t">${esc(m)}</div></div><span class="seta">›</span></div>`).join('')}</div>`, (el) => {
        el.addEventListener('click', (ev) => {
          const r = ev.target.closest('[data-msg]'); if (!r) return;
          store.definir(['perfis', p], { cutucada: { de: uid, nome: usuario.displayName || '', msg: r.dataset.msg, em: Date.now() } }, true);
          localStorage.setItem(chave, String(Date.now()));
          fecharModal(); toast('👉 Cutucada enviada');
        });
      });
      break;
    }
    case 'menu-par': {
      const p = b.dataset.p;
      const nome = P[p]?.perfil?.nome || 'essa pessoa';
      abrirModal(nome, `<p class="hero-sub">Desfazer a dupla faz ${esc(primeiroNome(nome))} parar de ver o seu dia. A ofensiva individual de cada um continua.</p><div class="acoes"><button class="btn danger" data-desfazer>Desfazer dupla</button></div>`, (el) => {
        el.querySelector('[data-desfazer]').onclick = async () => { await store.desfazerDupla(p); fecharModal(); toast('Dupla desfeita'); };
      });
      break;
    }
    case 'mes': {
      const [y, m] = mesSel.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(b.dataset.v), 1);
      mesSel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      render();
      break;
    }
    case 'novo-peso': {
      const ult = D.pesos.at(-1);
      modalNumero('Registrar peso', `Peso de ${C.rotuloDia(C.hoje()).toLowerCase()} (kg)`, ult ? num(ult.kg) : '', 'Fica só com você; a dupla não vê.', (v) => {
        store.definir(['usuarios', uid, 'pesos', C.hoje()], { kg: v }, false); toast('Peso registrado');
      });
      break;
    }
    case 'ver-exercicio': modalExercicio(id); break;
    case 'meta-ref': modalMetaRef(); break;
    case 'meta-agua': modalNumero('Meta de água', 'Litros por dia', num(prefs().metaAgua / 1000), 'Exemplo: 2,5', (v) => salvarPrefs({ metaAgua: Math.round(v * 1000) })); break;
    case 'meta-desc': modalNumero('Descanso padrão', 'Segundos entre séries', prefs().descanso, 'Usado quando o exercício não diz o descanso', (v) => salvarPrefs({ descanso: Math.round(v) })); break;
    case 'exportar': exportar(); break;
    case 'sair': store.sair(); break;
    default: break;
  }
}

async function exportar() {
  const dados = await store.exportarTudo();
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `folego-backup-${C.hoje()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

iniciar();
