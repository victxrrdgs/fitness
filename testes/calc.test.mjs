// Testes das regras do app. Rodar: node --test testes/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../calc.js';

test('exemplo de treino', () => {
  const t = C.lerTreino(C.EXEMPLO_TREINO);
  assert.deepEqual(t.agenda, { 1: 'a', 2: 'b', 3: 'c', 4: 'a', 5: 'b', 6: 'c' });
  assert.deepEqual(t.treinos.map((x) => x.exercicios.length), [5, 5, 3]);
  const ag = t.treinos[1].exercicios[0];
  assert.deepEqual([ag.nome, ag.series, ag.reps, ag.descanso, ag.obs], ['Agachamento livre', 4, '8', 120, 'desce até 90°']);
  const [esteira, prancha] = t.treinos[2].exercicios;
  assert.deepEqual([esteira.series, esteira.reps, esteira.descanso], [1, '30 min', null]);
  assert.equal(prancha.reps, '40s');
});

test('treino em markdown', () => {
  const t = C.lerTreino(`## Treino A – Peito e tríceps (segunda e quinta)
1. Supino reto – 4 séries de 8-10 repetições (descanso 90s)
2. Crucifixo: 3x12
**Treino B — Costas (terça/sexta)**
- Puxada frontal 4 x 10
Domingo: descanso
Sábado: Pernas
- Agachamento 4x8
- Cadeira extensora 3x15 (quadríceps)`);
  assert.deepEqual(t.agenda, { 1: 'a', 2: 'b', 4: 'a', 5: 'b', 6: 'pernas' });
  const sup = t.treinos[0].exercicios[0];
  assert.deepEqual([sup.nome, sup.series, sup.reps, sup.descanso], ['Supino reto', 4, '8-10', 90]);
  assert.equal(t.treinos[2].exercicios[1].obs, 'quadríceps');
});

test('dieta: formato do app e markdown', () => {
  const a = C.lerDieta(C.EXEMPLO_DIETA).refeicoes;
  assert.equal(a.length, 6);
  assert.deepEqual([a[0].hora, a[0].nome, a[0].itens.length], ['07:30', 'Café da manhã', 3]);
  const b = C.lerDieta(`## Café da manhã (7h)
- 2 ovos mexidos
## Almoço (12h30)
- 150g de frango
- Opção 2: carne moída
**Lanche da tarde - 16h**
* iogurte
7h30 - Pré-treino: banana
Jantar: peixe; salada`).refeicoes;
  assert.deepEqual(b.map((r) => [r.hora, r.nome, r.itens.length]), [
    ['07:00', 'Café da manhã', 1], ['12:30', 'Almoço', 2], ['16:00', 'Lanche da tarde', 1], ['07:30', 'Pré-treino', 1], ['', 'Jantar', 2],
  ]);
});

test('dia cumprido', () => {
  const plano = { ...C.lerTreino(C.EXEMPLO_TREINO), ...C.lerDieta(C.EXEMPLO_DIETA) };
  const seg = '2026-11-23';
  const refs = Object.fromEntries(['cafe-da-manha', 'lanche', 'almoco', 'lanche-da-tarde', 'jantar'].map((r) => [r, 'ok']));
  assert.equal(C.avaliarDia(plano, seg, { refeicoes: refs }).cumprido, false, 'falta o treino');
  assert.equal(C.avaliarDia(plano, seg, { refeicoes: refs, treinoFeito: true }).cumprido, true);
  assert.equal(C.avaliarDia(plano, '2026-11-29', { refeicoes: refs }).cumprido, true, 'domingo sem treino');
  assert.equal(C.avaliarDia(null, seg, {}).cumprido, false, 'sem plano não conta');
});

test('ofensiva com congelamento', () => {
  const ok = new Set(['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20', '2026-11-23']);
  const o = C.calcularOfensiva('2026-11-16', (d) => ok.has(d), '2026-11-23');
  assert.equal(o.mapa['2026-11-18'], 'gelo');
  assert.equal(o.mapa['2026-11-21'], 'falhou');
  assert.deepEqual([o.atual, o.recorde, o.gelo], [1, 4, 1]);
  const d = C.ofensivaDupla('2026-11-16', o.mapa, { ...o.mapa, '2026-11-23': 'pendente' }, '2026-11-23');
  assert.deepEqual([d.atual, d.hojeOk], [0, false]);
});

test('placar: treino sem plano vale 0; descanso do plano vale 15', () => {
  const m = C.calcularMetas({});
  const semPlano = C.pontosDia({ m, av: {}, dia: {} });
  assert.equal(semPlano.cats.treino, 0);
  assert.equal(semPlano.descanso, false);
  const descanso = C.pontosDia({ m, av: { descansoPlanejado: true }, dia: {} });
  assert.deepEqual([descanso.cats.treino, descanso.descanso], [15, true]);
  const feito = C.pontosDia({ m, av: { temTreino: true }, dia: { treinoFeito: true } });
  assert.equal(feito.cats.treino, 25);
  const checkin = C.pontosDia({ m, av: {}, dia: {}, checkins: [{ tipo: 'musculacao', minutos: 50 }] });
  assert.equal(checkin.cats.treino, 25);
});
