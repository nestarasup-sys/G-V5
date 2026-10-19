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

### Verificação posterior — Windows Actions e correção do gate

- Primeiro CI em `b76c98c0`: 14/16 testes aprovados; os dois que falharam eram **testes já existentes** da biblioteca de exportações, devido à comparação de `realpath` do job com caminho não canônico em Windows. Novos testes de snapshot passaram. [Run 39323107769](https://github.com/nestarasup-sys/G-V5/actions/runs/39323107769).
- Correção em `electron/videoExports.ts` (`2bc726ee`): comparar a localização canônica do job com a raiz temporária canônica, mantendo rejeição de symlink/junction que escape do diretório do job.
- Gate após correção: [run 39323448321](https://github.com/nestarasup-sys/G-V5/actions/runs/39323448321), **success** no SHA `e8b98b2b202af9d3e541db7f394677c377fa31cb`: testes sintéticos, typecheck e build em Windows. Não é smoke Electron nem prova de MP4 real.
- Corrigido gatilho de CI para ignorar alterações somente na pasta de documentação e executar os gates independentes mesmo se um teste falhar; DEV AI permanece desativado.

### Rodada 02 — Raster sintético isolado [em validação]

- `electron/videoSyntheticRaster.ts`: imagem BGRA gerada deterministicamente por frame absoluto; guardas de dimensões e tamanho (limite por buffer), produtor sequencial com checagem de cancelamento.
- `tests/video-synthetic-raster.test.cjs`: 1920×1080/8.294.400 bytes, SHA idêntico ao repetir frame, frames diferentes com SHA distinto, alpha e boundaries, cancelamento e transporte exato ao `VideoRawFrameWriter` via filho Node sintético.
- Incluído no `test:export:synthetic` e no workflow Windows. **Pendente**: status do run no SHA `e846286552228fb6329effb5978e9f6fcd6d0511` ([Actions](https://github.com/nestarasup-sys/G-V5/actions/runs/39323908215)).
- Esta fixture não representa personagens, roupas, preview, compositor do Video Studio, FFmpeg, codec ou MP4; é apenas um gatilho de validação byte-a-byte.

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


## 2026-10-19 — Rodada 03: reanálise independente e consolidação documental

**Escopo executado:** revisão estática do código do G-V5 master-desenvolvimento e do EDITOR-V4 oai/aggressive-export-v5. Branch inicial observada G-V5: 71183cc5cc56840c7d6390d98146a9032d7d79d3. V4 observado b951b4d2cbb360e3cfef7769e457894337bbc83e. Leitura por GitHub; nenhum Electron/FFmpeg iniciado, nenhum benchmark local, nenhum projeto ou asset privado acessado.

**Entregas commitadas nesta branch:**
- 932fdbf63b5ebeb1605d9062935acda7084a44f3 — AUDITORIA_CODIGO_2026-10-19.md
- 66bc40ff430350865cfc968e11f349898ada12c0 — CONTRATOS_ENGINE_E_TESTES.md
- 00f246f4d6f9dd907bfc0e913172133d3965f121 — BACKLOG_EXECUTAVEL.md
- bbd160d26f81e860dcecba58fa45569203c0533f — README.md
- PLANO_MESTRE.md — atualizado nesta rodada para cruzar os quatro documentos; SHA no log do GitHub.

**Fatos novos encontrados:**
1. useCharacterTransitions.ts condiciona samples interpolados a playing; export em frame arbitrário exige comportamento canônico.
2. transitionRenderer.ts busca modelos, poses e catálogo externo assíncrono; freeze do Studio não equivale a snapshot de assets.
3. videoExportSnapshot.ts cria apenas seleção temporal e sourceFrame em ticks de 1/60 s, sem frame de mídia nem compositor completo.
4. videoExportJobs.ts tem checkpoint sequencial e SHA, não valida decodificação ou conclusão fora de ordem para Turbo.
5. videoRawFrameWriter.ts espera callback por frame, de modo que maxInFlight=2 não prova pipeline realmente paralelo; confirmar com benchmark.
6. O áudio gerado é plano FFmpeg, não mux executado; VideoExportLibrary publica arquivo com metadados, não certifica codec/duração/PTS por conta própria.
7. O CI sintético permite typecheck/build no Windows, mas não cobre paridade raster, decoder, Electron ou FFmpeg real.

**Gates desta rodada:** leitura e escrita confirmadas pelo GitHub. Testes de unidade, typecheck, build, Windows Actions, MP4 real e visual parity: **NÃO EXECUTADOS nesta rodada**; não herdar sucesso de SHA anterior como prova da revisão documental atual.

**Próxima ação técnica:** E01 (manifest de dependências) + E02 (frame evaluator com transições) + E03 (fixture visual); depois surface/encoder serial antes de chunks Turbo. Não publicar componente de export como funcional antecipadamente.

**Rollback:** documentos não alteraram runtime nem projeto; qualquer implementação futura permanece atrás de gate até provas Electron/FFmpeg, com serial estável antes de Turbo.
