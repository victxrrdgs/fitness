// Aba Comer: busca na TACO (alimentos brasileiros, local), Open Food Facts (produtos com código de barras)
// e leitura do código de barras pela foto. Carregado só quando a pessoa vai registrar um alimento.
import { novaTaco } from './calc.js?v=0.4';

const BARCODE = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.4/dist/iife/ponyfill.js';
const BARCODE_SRI = 'sha384-V0LFv1UaolwYOQ6Y1C07pBzM25t1t+HbAAwyN47cJtg/Sqa2jYnTPGGt+oL1kjS/';
const OFF = 'https://world.openfoodfacts.org';
const CAMPOS_OFF = 'code,product_name,product_name_pt,brands,nutriments,nova_group,nutriscore_grade,serving_quantity,serving_size';

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------------- TACO ----------------
let taco = null;
export async function carregarTaco() {
  if (!taco) {
    taco = fetch(new URL('./dados/taco.json', import.meta.url)).then((r) => r.json()).then((j) => {
      j.alimentos.forEach((a) => { a.busca = semAcento(a.n); a.nova = novaTaco(a.n, a.c); });
      return j;
    });
  }
  return taco;
}

export async function buscarTaco(texto, max = 25) {
  const t = await carregarTaco();
  const termos = semAcento(texto).split(/[^a-z0-9]+/).filter((x) => x.length > 1);
  if (!termos.length) return [];
  const out = [];
  for (const a of t.alimentos) {
    let s = 0;
    for (const q of termos) {
      const i = a.busca.indexOf(q);
      if (i < 0) { s = -1; break; }
      s += i === 0 ? 6 : /[\s,]/.test(a.busca[i - 1]) ? 3 : 1;
    }
    if (s < 0) continue;
    // Prefere o pronto para comer (cozido, grelhado...) ao cru
    if (/cozid|grelhad|assad|refogad|frit/.test(a.busca)) s += 1;
    out.push({ s: s - a.n.length / 200, a });
  }
  return out.sort((x, y) => y.s - x.s).slice(0, max).map(({ a }) => ({
    fonte: 'taco', ref: String(a.i), nome: a.n, marca: '', categoria: a.c, nova: a.nova,
    por100: { kcal: a.k, p: a.p, cb: a.cb, g: a.g, f: a.f },
    medidas: (Array.isArray(t.medidas[a.i]) ? t.medidas[a.i] : t.medidas[a.i] ? [t.medidas[a.i]] : []).map((x) => ({ nome: x.m, g: x.g })),
  }));
}

// ---------------- Open Food Facts ----------------
function deOff(p) {
  const n = p.nutriments || {};
  const kcal = n['energy-kcal_100g'] ?? (n.energy_100g != null ? n.energy_100g / 4.184 : null);
  if (kcal == null) return null;
  const medidas = [];
  if (Number(p.serving_quantity) > 0) medidas.push({ nome: `porção${p.serving_size ? ` (${p.serving_size})` : ''}`, g: Number(p.serving_quantity) });
  const nome = p.product_name_pt || p.product_name || 'Produto sem nome';
  const ns = p.nutriscore_grade && /^[a-e]$/.test(p.nutriscore_grade) ? p.nutriscore_grade : null;
  return {
    fonte: 'off', ref: p.code, nome, marca: (p.brands || '').split(',')[0].trim(),
    // Sem a classificação na base: produto de embalagem é no mínimo processado; o nome ou Nutri-Score D/E indicam ultraprocessado
    nova: Number(p.nova_group) || Math.max(3, novaTaco(nome, ''), ns === 'd' || ns === 'e' ? 4 : 0), nutriscore: p.nutriscore_grade && /^[a-e]$/.test(p.nutriscore_grade) ? p.nutriscore_grade : null,
    por100: { kcal: Math.round(kcal), p: Number(n.proteins_100g) || 0, cb: Number(n.carbohydrates_100g) || 0, g: Number(n.fat_100g) || 0, f: Number(n.fiber_100g) || 0 },
    medidas,
  };
}

export async function produtoPorCodigo(codigo) {
  const cod = String(codigo).replace(/\D/g, '');
  if (cod.length < 8) throw new Error('Código inválido.');
  const r = await fetch(`${OFF}/api/v2/product/${cod}.json?fields=${CAMPOS_OFF}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Não consegui consultar o Open Food Facts agora.');
  const j = await r.json();
  return j.status === 1 && j.product ? deOff({ code: cod, ...j.product }) : null;
}

export async function buscarProdutos(texto) {
  const q = encodeURIComponent(texto.trim());
  const r = await fetch(`${OFF}/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=20&countries_tags_en=brazil&fields=${CAMPOS_OFF}`);
  if (!r.ok) throw new Error('Não consegui consultar o Open Food Facts agora.');
  const j = await r.json();
  return (j.products || []).map(deOff).filter(Boolean);
}

// ---------------- Código de barras pela foto ----------------
let detector = null;
async function obterDetector() {
  if (detector) return detector;
  const formatos = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
  if ('BarcodeDetector' in window) {
    try {
      const sup = await window.BarcodeDetector.getSupportedFormats();
      if (formatos.some((f) => sup.includes(f))) return (detector = new window.BarcodeDetector({ formats: formatos.filter((f) => sup.includes(f)) }));
    } catch (e) { /* usa a biblioteca */ }
  }
  // iPhone e navegadores sem leitor nativo: biblioteca ZXing (carrega só agora)
  if (!window.BarcodeDetectionAPI) {
    await new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = BARCODE; s.integrity = BARCODE_SRI; s.crossOrigin = 'anonymous';
      s.onload = ok; s.onerror = () => { s.remove(); erro(new Error('Sem conexão para ler o código. Digite os números.')); };
      document.head.append(s);
    });
  }
  return (detector = new window.BarcodeDetectionAPI.BarcodeDetector({ formats: formatos }));
}

export async function lerCodigoDaFoto(arquivo) {
  const det = await obterDetector();
  const img = await createImageBitmap(arquivo);
  const achados = await det.detect(img);
  img.close?.();
  return achados[0]?.rawValue || null;
}

// Valores para uma quantidade em gramas
export function porQuantidade(alimento, gramas) {
  const f = (Number(gramas) || 0) / 100;
  const v = alimento.por100;
  return { kcal: Math.round(v.kcal * f), p: Math.round(v.p * f * 10) / 10, cb: Math.round(v.cb * f * 10) / 10, g: Math.round(v.g * f * 10) / 10, f: Math.round(v.f * f * 10) / 10 };
}
