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
- [ ] Publicar: Firebase + GitHub Pages (passos abaixo) e testar com as duas contas reais
- [ ] Colar o plano real dela (e o dele) no app
- [ ] 4. Lembretes (bot do Telegram e/ou notificação)
- [ ] 5. Opcionais: calorias (TACO + Open Food Facts), foto com IA, APK

## Para publicar (feito pelo dono, no PC)
1. Firebase: novo projeto → Authentication (Google) → Firestore → colar `firestore.rules` → Domínios autorizados: `victxrrdgs.github.io`.
2. Colar a configuração web em `firebase-config.js`.
3. GitHub Pages: Settings → Pages → branch `main`, pasta `/`.

## Testes
- `node --test testes/*.test.mjs` — leitura do plano (formato do app e markdown), dia cumprido, ofensiva e congelamento.
- Regras do Firestore: 42 casos no emulador oficial do Firebase (privacidade, convite, dupla, reações, cutucada, fotos, desfazer dupla). O script de teste não está no repositório; dá para refazer com `@firebase/rules-unit-testing`.
- Navegador (modo local, tela de celular, duas abas): plano de exemplo e em markdown, refeições, foto, treino com cargas, recordes, peso, dias passados/futuros, código de dupla, reação, cutucada, desfazer dupla e dados maliciosos da dupla (nada executa). Sem erros no console.
- Ainda não testado com o Firebase de verdade (falta criar o projeto).

## Revisão v0.2 (bugs corrigidos)
- Plano em markdown (títulos, negrito, listas numeradas, "4 séries de 10", "Segunda-feira: Pernas", "Opção 2: …") era lido errado.
- Offline num aparelho novo, o perfil podia ser recriado, apagando a dupla e o início da ofensiva.
- Dados vindos da dupla agora são tratados como não confiáveis (números, estados e fotos validados) e as regras só aceitam foto como imagem.
- Desfazer a dupla agora corta o acesso dos dois lados.
- A ofensiva começa no dia em que o primeiro plano é salvo (antes contava dias sem plano como falha).
- Dias antes do início não são editáveis nem aparecem como "faltou".
- App aberto de um dia para o outro volta para o dia de hoje.
- Primeira dupla não mostrava aviso; resumo de "hoje" da dupla mostrava o dia anterior se ela não tinha aberto o app.
- Foto da refeição: agora dá para escolher da galeria (antes abria só a câmera).
- Cronômetro de descanso não dispara em exercício por tempo; séries sem carga aparecem como "10 reps".
- Erros ao salvar no Firebase agora aparecem na tela.
