# Fôlego

App web (PWA) para seguir **treino e dieta do dia** em dupla: ofensiva 🔥 estilo Duolingo, feed do dia do parceiro, reações, cutucadas e progresso (cargas, recordes, peso).

## Testar agora (sem Firebase)
Com `firebase-config.js` vazio, o app roda em **modo local**: os dados ficam só no navegador e há duas contas de teste.
Abra `index.html` por um servidor local (`python -m http.server` na pasta) e, para testar a dupla, abra duas abas (uma com cada conta).

## Recursos
- **Hoje**: treino do dia (séries, carga, "última vez", cronômetro de descanso), refeições ✅ segui / 🔄 troquei / ❌ pulei com foto, água
- **Dia cumprido** = treino feito (quando há treino na agenda) e ≥ 80% das refeições (ajustável no Perfil)
- **Ofensiva**: ❄️ congelamento (começa com 1, +1 toda segunda, máx. 2) segura a sequência num dia ruim
- **Dupla** (até 5 pessoas): código de convite, ofensiva compartilhada, tira de 14 dias, dia do parceiro com fotos, reações e cutucar
- **Desafios** (estilo GymRats, aba *Juntos*): nome, regras, início e fim; ganha quem treinar mais dias ou somar mais minutos. Placar, feed com fotos e reações. Gente da dupla entra direto; outras pessoas entram com código (vale 7 dias, até 20 pessoas)
- **Check-in**: prova do treino com foto (até 2), atividade, duração, calorias, km, onde treinou e comentário. Conta como treino feito no dia e entra nos desafios ativos
  - **Android / Samsung Health**: no resumo do treino, *Compartilhar → Fôlego* abre o check-in com a imagem (e tempo/calorias, se vierem no texto). Precisa do app instalado pelo Chrome
  - **iPhone / Apple Saúde**: anexe o print do treino, ou use um atalho (app Atalhos) que abra `https://victxrrdgs.github.io/fitness/?acao=checkin&min=45&kcal=320&km=5.2&tipo=Corrida&fonte=apple`
- **Placar do dia (0 a 100)**, cada um contra o próprio objetivo (emagrecer, manter, ganhar massa): alimentação 35 (calorias na faixa, proteína, qualidade), treino 25, cardio 15, água 10, bônus 15 (sono, dia sem álcool, passos, refeições registradas). Cada categoria tem teto e curva; +10% se todas as quatro principais passarem da metade
- **Juntos → Placar**: duelo do dia, melhor refeição de cada um, rodada semanal (segunda a domingo) e troféus. Desafios podem ser por **pontos**
- **Comer**: registrar o que comeu por **código de barras** (Open Food Facts; no iPhone usa a biblioteca ZXing), **busca na TACO** com medidas caseiras do IBGE, ou **manual**. Cada refeição ganha nota de 0 a 10 com os motivos. Metas calculadas em *Perfil → Meu objetivo* (Mifflin-St Jeor) ou os números da nutricionista
- **Ofensiva** conta a partir de 24/11/2026 (`INICIO_OFENSIVA` em `calc.js`); antes disso nada conta como falha
- **Progresso**: calendário do mês, peso (privado), recordes e gráfico por exercício
- **Plano**: cole o treino e a dieta em texto simples (formato em *Plano → Editar → Como escrever*) ou **importe de um arquivo** (PDF, Word .docx, Excel .xlsx, CSV ou texto). O app preenche os campos e você confere antes de salvar.
  - Dieta em PDF com **cardápio por dia** (uma semana por página: Dia | Café | Almoço | Lanche | Jantar | Extra | Total) vira cardápio por data, com **metas por período** (calorias, faixa que vale ponto, proteína, água) e as regras da nutricionista. A tela Hoje mostra o cardápio do dia e o Placar usa essas metas.
- Funciona offline e pode ser instalado no celular

## Publicar
1. **Firebase** (console.firebase.google.com): criar projeto → *Authentication* → ativar **Google** → *Firestore Database* → criar → aba *Regras*: colar `firestore.rules` → publicar.
2. *Authentication → Settings → Authorized domains*: adicionar `victxrrdgs.github.io`.
3. *Configurações do projeto → Seus apps → Web (</>)*: registrar o app e copiar o objeto de configuração para `firebase-config.js`.
4. **GitHub Pages**: *Settings → Pages* → branch `main`, pasta `/`. O app fica em `https://victxrrdgs.github.io/fitness/`.

## Segurança
A configuração em `firebase-config.js` é pública por natureza; quem protege os dados são as regras em `firestore.rules`:
plano, preferências e peso são privados; o perfil (nome, ofensiva) e o registro do dia/fotos de refeição só são lidos por quem o dono colocou na dupla.

## Arquivos
- `index.html`, `styles.css`, `app.js` — interface
- `calc.js` — regras (leitura do plano, dia cumprido, ofensiva, recordes)
- `store.js` — Firebase ou modo local
- `importar.js` — leitura de PDF/Word/Excel e conversão para o formato do plano (carregado só ao importar)
- `vendor/pdfjs/` — pdf.js 6.5.438 (Mozilla, Apache 2.0)
- `comida.js` — busca TACO, Open Food Facts e leitura do código de barras (carregado só ao registrar comida)
- `dados/taco.json` — TACO 4ª ed. (NEPA/UNICAMP, 2011; reprodução permitida citando a fonte) e medidas caseiras do IBGE POF 2008-2009, extraídas de [taco-br-mcp](https://github.com/ianhudsonai/taco-br-mcp) (MIT)
- `sw.js`, `manifest.webmanifest`, `icons/` — instalação como app
- `firestore.rules` — regras de segurança
- `PLANO.md` — plano de desenvolvimento e decisões
