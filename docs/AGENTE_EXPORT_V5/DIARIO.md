# Diário — agente de exportação Video Studio V5

## 2026-10-19 — Rodada 01: fundação determinística

**Destinatário:** `nestarasup-sys/G-V5`, `master-desenvolvimento`.

**HEAD ao começar:** `a5a488f5a6803350cd397c4f4fed351bcebbe75f` (GitHub). Commits anteriores de remoção de documentos foram respeitados, não revertidos.

**Referência lida sem escrita:** `nestarasup-sys/EDITOR-V4`, `oai/aggressive-export-v5`, commit `b951b4d2cbb360e3cfef7769e457894337bbc83e`.

### Entregas desta rodada

1. `PLANO_MESTRE.md`: inventário técnico, fases M0–M6, critérios, riscos, rollback, privacidade, referências V4 e fontes oficiais.
2. `src/shared/videoExportSnapshot.ts`: clone isolado congelado de `StudioDocument` (com `VideoTimelineDocument` interno), valida FPS/duração/intervalos de vídeo e zera apenas o relógio **do clone**.
3. `resolveVideoExportFrameSelection()`: reutiliza `resolveVideoFrameSelection()` do Preview para gaps, textos e clips; projeta `sourceFrame` de forma absoluta e sem consultar `playing`.
4. `tests/video-export-snapshot.test.cjs`: três testes com fixtures 100% sintéticas — isolamento/freeze, boundaries `[start,end)`, repetibilidade e rejeição de input inválido.
5. `npm run test:export:synthetic`: comando dedicado de testes do domínio export.
6. `.github/workflows/video-export-synthetic.yml`: job Windows com `npm ci --ignore-scripts`, testes sintéticos, `npm run typecheck`, `npm run build`. **Não chama** `audit:*`, DEV AI, runs de UI/IPC, Electron, FFmpeg, projetos reais nem scripts desativados; nenhum upload de artefatos.

### Conquistas versus limites

- **Implementado**: seleção temporal por frame, isolamento do snapshot, gate automatizado.
- **Ainda não implementado**: render de personagens/roupas/texte/gpu e PNG, pipe completo para FFmpeg, MP4 real, mux AAC real, distribuição de FFmpeg, cancelamento de job em execução, Turbo.
- **GitHub Actions**: workflow de push iniciado em [run 39323107769](https://github.com/nestarasup-sys/G-V5/actions/runs/39323107769) no SHA `b76c98c0f446266c3bef8dba7bc04f3a58db5781`. Resultado **pendente de verificar**, não antecipar.
- **Teste de composição**: não executado. Passagem de testes de unidade não demonstrará paridade visual.
- **Privacidade**: nenhum asset privado, userData, screenshot de usuário, mídia real ou log de produção acessado. Sem mudanças em `master`/V4.

### Próximas etapas autorizadas

1. Resolver eventuais falhas do gate sintético sem afrouxar asserts.
2. Criar um framebuffer BGRA sintético/isolado e validar hashes de 1 frame, contagem, resize e memória (M1).
3. Prototipar surface offscreen V5 que consuma snapshot, com barrier de PNG/renderer e handshake por frame, no início apenas fixtures sintéticas.
4. Selecionar/licenciar e validar FFmpeg empacotável; **não** copiar `ffmpeg-static` GPL do V4.
5. Single-worker MP4 completo e paridade visual antes de qualquer cache/Turbo.

### Evidências externas

- [Electron offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering): bitmap/dirtyRects e ausência de paints quando a página não muda; não usar paint como clock.
- [Electron frame subscription](https://www.electronjs.org/docs/latest/api/web-contents): imagem apresentada precisa de protocolo de barreira para evitar frame antigo.
- [FFmpeg licensing](https://ffmpeg.org/legal.html): configuração de build, GPL/nonfree, origem e distribuição devem ser verificadas.

_Atualizações posteriores devem registrar o SHA real do gate e nunca declarar conclusão a partir de código compilado._
