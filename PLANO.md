# Fôlego — plano de desenvolvimento

App fitness (PWA) para casal/amigos próximos: treino e dieta do dia, ofensiva 🔥 individual e da dupla, progresso.
Projeto separado do `financas`, mas com a mesma base: HTML/JS puro, GitHub Pages, Firebase (login Google + Firestore), visual "glass" escuro (paleta verde/lima).

## Decisões (padrões sugeridos, ajustáveis)
- Nome provisório: **Fôlego**.
- Dia cumprido = treino do dia feito (ou dia sem treino na agenda) **e** ≥ 80% das refeições seguidas/trocadas.
- Congelamento: começa com 1, ganha 1 toda segunda (máx. 2). Dia falho gasta 1; sem congelamento, zera.
- Ofensiva da dupla cresce só quando os dois cumprem. Até 5 parceiros.
- Sem contagem de calorias no começo (foco em "segui o plano").
- Fotos de refeição comprimidas (~80 KB) direto no Firestore (sem Firebase Storage/Blaze).
- Peso e fotos de progresso: privados.

## Fases
- [x] 0. Base: regras (`calc.js`), dados (`store.js`, modo local com 2 contas de teste), regras do Firestore, estilos, `index.html`
- [x] 0. `app.js` (interface), `sw.js`, `manifest.webmanifest`, ícones, `firebase-config.js` (vazio = modo local)
- [x] 1. Hoje: treino do dia com séries/carga/última vez + cronômetro; refeições ✅🔄❌ + foto; água; ofensiva
- [x] 1. Plano: importar treino e dieta por texto (formato em `calc.js`: `lerTreino`, `lerDieta`)
- [x] 2. Dupla: código de convite, ofensiva compartilhada, feed do dia do parceiro, reações, cutucar
- [x] 3. Progresso: calendário, peso, recordes e gráfico por exercício
- [x] Publicar: Firebase (`folego-c33b7`) + GitHub Pages (`main`, raiz)
- [x] Importar plano de arquivo (PDF, Word, Excel, CSV, texto) — `importar.js`
- [ ] Modelo do arquivo real do plano dela (a partir do primeiro arquivo, em `MODELOS`)
- [ ] Testar a dupla com as duas contas reais
- [ ] Colar/importar o plano real dela (e o dele) no app
- [ ] 4. Lembretes (bot do Telegram e/ou notificação)
- [ ] 5. Opcionais: calorias (TACO + Open Food Facts), foto com IA, APK

## Para publicar (feito pelo dono, no PC)
1. Firebase: novo projeto → Authentication (Google) → Firestore → colar `firestore.rules` → Domínios autorizados: `victxrrdgs.github.io`.
2. Colar a configuração web em `firebase-config.js`.
3. GitHub Pages: Settings → Pages → branch `main`, pasta `/`.

## Testado
Fluxo completo no modo local (Chromium, tela de celular, duas abas): plano de exemplo → refeições → treino com cargas → dia cumprido → código de dupla → reação e cutucada. Sem erros no console.
Publicado e com login Google funcionando no Firebase real.
Importação testada com PDF (inclusive tabela de exercícios), Word com tabela e Excel com várias abas.
