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
- **Progresso**: calendário do mês, peso (privado), recordes e gráfico por exercício
- **Plano**: cole o treino e a dieta em texto simples (formato em *Plano → Editar → Como escrever*) ou **importe de um arquivo** (PDF, Word .docx, Excel .xlsx, CSV ou texto). O app preenche os campos e você confere antes de salvar.
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
- `sw.js`, `manifest.webmanifest`, `icons/` — instalação como app
- `firestore.rules` — regras de segurança
- `PLANO.md` — plano de desenvolvimento e decisões
