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


## 2026-10-19 — Rodada 06: evaluator semântico absoluto e variantes

**Base:** branch `master-desenvolvimento`, sincronizada por fast-forward do SHA `a5a488f5a6803350cd397c4f4fed351bcebbe75f` para `05a262b6b851b3bf72024bebe471eb86b320d8ba`. A tree estava limpa antes da implementação.

**Alterações locais:** `src/shared/videoCharacterTimeline.ts` centraliza o índice/lookup de estado de personagem, e `characterTrack.ts::characterStateAt()` (consumido pela preview atual) delega ao shared. `src/shared/videoSceneIR.ts` adiciona `compileVideoScene()` e `evaluateVideoSceneFrame()` puros: reusa o mesmo lookup/cache e compila spans de transição, intervalos de gaps/text/video com prefix-max-end, assets/elementos por ID e ordem combinada de camadas V5. A avaliação retorna estado authored, transição/progresso absoluto, variantes, mouth/blink, gaps, clips de texto, ticks/timestamps de vídeo, fundo e layer order. O documento permanece imutável. Testes com fixtures sintéticas comparam seleção de intervalo contra o seletor existente em todos os frames e verificam lookup/transform da preview. `package.json` inclui o novo teste nos comandos apropriados.

**Estado de cobertura:** V505/V507/V542 **parciais**. Este IR é semântico, não rasteriza PNG nem reproduz `transitionRenderer`; também não resolve dependências externas do Fabricador/Customizer, não fixa bytes, não captura Electron e não produz MP4. O modo completo ainda precisa ser conectado à composição visual sem alterar regras do editor; o modo estático ainda precisa de comparação MP4/pixels.

**Validações nesta rodada:** antes da implementação, `npm run test:export:synthetic` passou com 20 testes no HEAD sincronizado. Após a implementação: `npm run test:export:synthetic` passou (25 testes, 0 falhas/skips); `npm test` passou (55 testes, 0 falhas/skips); `npm run typecheck` passou; `npm run build` passou. O teste de evaluator foi incluído nos dois comandos de teste aplicáveis. `node --test tests/video-scene-ir.test.cjs tests/video-timeline-index.test.cjs` passou (12/12); comparação de intervalos do IR com o seletor antigo cobre cada frame de 0 a 59 na fixture sintética. `npm run bench:video-timeline` executado separadamente: microbench existente reportou indexed-query speedups de 12,81×/60,3×/1009,86× em 100/1.000/10.000 eventos e playback lookup 3,92×/19,37×/90,13×; estes números comparam apenas funções sintéticas in-memory, **não** o novo IR, React preview, Electron, nem tempo real do app. `git diff --check` passou. Não executar DEV AI/auditorias desligadas. Nenhum perfil real, assets privados, Electron gráfico, FFmpeg instalado ou export real foi acessado nesta rodada.

**Próximo item:** integrar o evaluator com `characterTrack` sem manter regras duplicadas e construir resolução/pinning de dependências antes de tentar rasterização de ator. Em seguida, produzir oráculo de imagem sintético e um surface isolado.


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

## 2026-10-19 — Rodada 04: pesquisa profunda e modernização integral do Video Studio

**Solicitação:** ampliar o escopo além de portar Export Turbo 2× do V4, investigar tecnologias open source, documentar oportunidades para o G-V5 inteiro (preview, mídia, assets, personagens, cache, export e UX) e criar plano de execução separado.

**Método/evidências:** inspeção estática de `G-V5/master-desenvolvimento` (a partir de `7352d748fcd482545f49ac0d546886e9be195108`) e `EDITOR-V4/oai/aggressive-export-v5` (referência `b951b4d2cbb360e3cfef7769e457894337bbc83e`); consulta a documentação primária de FFmpeg, MLT, GES, libopenshot, PixiJS, WebCodecs/MDN, Mediabunny, Electron OSR/shared texture, Remotion, OTIO e Olive. Não executar code, Electron, FFmpeg, CI, bench nem manipular projetos reais nesta rodada.

**Nova área independente criada:** `docs/VIDEO_STUDIO_V5_MODERNIZACAO/`
- `00_PLANO_DIRETOR.md`: objetivos, P0-P6, arquitetura, estratégia de gates e baseline.
- `01_ESTUDO_DE_MOTORES.md`: matriz comparativa de 12 opções, papéis reais, licenças, dependências e adoção por A/B.
- `02_ARQUITETURA_CANONICA.md`: Smart Scene Compiler, RenderIR, PTS racionais, layout fixo, cache, hash e protocolo frame-ready.
- `03_MIGRACAO_E_DADOS.md`: diagnóstico de cópias físicas por projeto em videoLibrary e plano CAS/proxy reversível.
- `04_LAB_E_GATES.md`: fixtures S00-S07, matriz de performance, gates G0-G6, qualidade por pixel/PTS/áudio.
- `05_DECISOES_ADR.md`: ADR-001 a ADR-012 e status de hipóteses.
- `06_BACKLOG_DE_EXECUCAO.md`: tarefas V501–V540 com pré-requisitos e critérios de aceite.
- `README.md`: índice e ponte com documentação anterior.

**Commits de criação representativos:** `ea3ba1fb` (plano), `3b707aa7` (engines), `c726b2a6` (RenderIR), `1df3445a` (dados), `b7bdbd59` (lab), `48c380d4` (ADRs), `85a26f39` (backlog), `4b225499` (índice). Commits posteriores apenas normalizaram Markdown e reconciliaram documentos antigos; consultar a branch para os SHAs finais exatos.

**Documentos anteriores conciliados, sem apagar registros históricos:** `AGENTE_EXPORT_V5/README.md`, `PLANO_MESTRE.md`, `AUDITORIA_CODIGO_2026-10-19.md`, `CONTRATOS_ENGINE_E_TESTES.md` e `BACKLOG_EXECUTAVEL.md`.

**Novos fatos confirmados por código:**
1. `makeCanvasPrint()` renderiza balões e texto em Canvas 2D com regra distinta do preview DOM/CSS; o CSS tem `font-size:clamp(9px,1.4vw,18px)` dependente de viewport. Paridade precisa de motor/layout canônico.
2. `VideoStudioEditor.tsx` posiciona vídeos CSS `z-index:1` e elementos em `zIndex+2`; preservar essas camadas antes de redesenhar mixer.
3. `VideoLibraryStore.attach()` copia arquivos da biblioteca global para projeto com `copyVerified` (verifica size, não SHA); não existe deduplicação CAS de vídeo global por referência no caminho atual.
4. A transição nominal de 250 ms contém 15 ticks a 60fps; `transitionSampleFrames()` gera amostras *estritamente internas* e tipicamente 14 intermediárias quando a janela tem 15 ticks.
5. `VideoStudioEditor.tsx` mantém ciclo de 6 quadros de boca; aplicação precisa depender de frame absoluto no novo evaluator.
6. `sourceStartFrame` mede ticks de timeline 60Hz e não frames codificados da mídia; buscar PTS correto por stream.
7. Electron oferece OSR com shared texture experimental, mas ainda sem ponte nativa no V5. PixiJS WebGL é candidato; WebGPU não deve ser default sem teste. Mediabunny usa MPL-2.0, WebCodecs não muxa sem biblioteca adicional.

**Diretriz de escolha:** RenderIR + compositor especializado V5 + FFmpeg sondado são hipótese líder, enquanto MLT/GES/libopenshot, PixiJS e WebCodecs/Mediabunny competem em testes. Nenhuma biblioteca nova foi instalada nem incorporada ao runtime; nenhuma performance prometida ou comprovada.

**Gates realizados nesta rodada:** leitura e gravação de arquivos via GitHub, comparação estática e links oficiais. **NÃO realizados:** testes Node/typecheck/build, CI do novo HEAD, execução Windows/Electron/FFmpeg, FFprobe, A/B, benchmarks ou paridade real. Workflows de docs não iniciam validação sintética por padrão.

**Próxima sequência executável:** V501/V502 (fixtures e oracle) → V505/V507 (estado por frame) → V509 (manifest pinned) → V508/V510 (texto/layers) → V512–V518 (MP4 serial verdadeiro) → preview/proxy/cache → Turbo. Registrar resultados por tarefa; não marcar concluído sem evidência.

## 2026-10-19 — Rodada 08: manifesto verificável de mídias de vídeo

- Base: `5f4119e8de902eafbcde845f97df939782a78f05`, branch `master-desenvolvimento`.
- Risco confirmado: `VideoExportSnapshot` congela o JSON do roteiro, mas `videoClips` aponta para cópias em disco que ainda podem mudar ou desaparecer. O job store já aceita SHA-256 de mídia, mas faltava produzir e revalidar a identidade dos arquivos por asset.
- Implementado parcialmente: `electron/videoExportAssets.ts` gera um manifesto ordenado apenas com os vídeos referenciados na timeline, deduplica usos repetidos, valida formato/tamanho, confere contenção no root confiável, rejeita link simbólico no arquivo, calcula SHA-256 e revalida metadata durante a leitura. `verifyVideoExportMediaManifest()` detecta bytes diferentes ao retomar/finalizar. O manifesto não contém caminhos absolutos.
- `VideoLibraryStore.resolveProjectMediaDependency()` encontra somente a cópia salva no projeto solicitado e compara ID, tipo, MIME e tamanho; não procura arquivo com mesmo nome em outro projeto.
- Testes novos com arquivos sintéticos cobrem hash, deduplicação, referência ausente, caminho fora do root, alteração após snapshot e associação à cópia certa do projeto. Entraram em `npm test`, `test:export:synthetic` e nos filtros do workflow Windows.
- Validação: `npm test` — 59/59; `npm run test:export:synthetic` — 29/29; `npm run typecheck`, `npm run build` e `git diff --check` passaram.
- Limite: essa etapa ainda não copia bytes para pasta de job nem está chamada por um orquestrador de export, pois o pipeline não possui job IPC executável. Fornecedores de modelo/pose/face/cabelos e imagens embutidas ainda não têm manifesto/digest próprio. V509 segue parcial; export não é retomável com media pinada ainda.

## 2026-10-19 — Rodada 09: cópia pinada no ciclo de vida do job

- Base: `3cf24b15fff3ee069e039f08f30646c774c455c7`, branch `master-desenvolvimento`.
- `VideoExportJobStore.create()` agora aceita dependências com SHA-256 e copia cada arquivo de vídeo referenciado uma vez para `temp/video-studio/export/<job>/assets/<assetId>.<ext>`. A cópia é re-hasheada antes do manifesto ser confirmado; uma divergência limpa somente a pasta recém-criada desse job.
- `reopen()` valida o caminho relativo, tipo de arquivo, hash e tamanho da cópia pinada antes de aceitar checkpoints. `verifyPinnedMedia()` também permite que um futuro runner revalide antes de renderizar/finalizar. Jobs v1 anteriores sem campo `mediaDependencies` continuam legíveis.
- Testes sintéticos verificam independência da mídia original após a cópia, rejeição de cópia pinada adulterada e rollback local quando a origem já diverge do hash.
- Validação: `npm test` — 61/61; `npm run test:export:synthetic` — 31/31; `npm run typecheck`, `npm run build` e `git diff --check` passaram.
- Estado: pinagem de vídeos já implementada no armazenamento de jobs, ainda sem chamada por IPC/runner e sem snapshot completo do documento para retomada automática. Assets de imagens e fornecedores Fabricator/Customizer não estão incluídos. Nenhuma exportação real foi executada.

## 2026-10-19 — Rodada 10: snapshot de cena persistido no job (V509 parcial)

- Base: `df67e56e76af368c5ab8c0a255bb6a2972cbe74a`, branch `master-desenvolvimento`.
- `videoExportSnapshot.ts` agora serializa o documento congelado em JSON versionado e canônico, ordenando as chaves e removendo apenas propriedades `undefined`; a restauração recria o snapshot imutável e reaplica as validações de timeline.
- `VideoExportJobStore.create()` pode gravar `snapshot.json` dentro da pasta própria do job. O SHA-256 do JSON canônico precisa corresponder ao digest recebido, ao ID do Studio e à duração. O manifesto registra o nome fixo do arquivo e `RenderVariant` (`animated` ou `static-characters`). O snapshot é gravado atomicamente antes do manifesto.
- `readSnapshot()` e `reopen()` validam arquivo regular, caminho canônico dentro da pasta do job, SHA-256, Studio, duração e variante; `reopen()` devolve o snapshot congelado junto com o próximo checkpoint. Um job novo pode ser recuperado por `reopen(jobId)` sem consultar o documento vivo; com identidade externa, continua comparando digest/mídias/variante. Jobs v1 legados sem `snapshotFile` continuam compatíveis nos fluxos antigos, mas exigem identidade externa para recuperar.
- Testes sintéticos cobrem ordenação estável, round-trip, restauração independente de edição posterior do projeto, imutabilidade, rejeição de JSON malformado, variante divergente e corrupção/hash incorreto do snapshot.
- Recuperação refinada: `reopen(jobId)` pode restaurar um job novo a partir do snapshot e dos arquivos de mídia pinados do próprio diretório, sem consultar o documento vivo. Se o chamador também enviar identidade externa, IDs, digest, duração, variante e dependências são comparados; jobs legados sem snapshot continuam exigindo essa identidade.
- Validação local: `node --test tests/video-export-snapshot.test.cjs` (4/4), `node --test tests/video-export-jobs.test.cjs` (5/5) e `npm run typecheck` passaram nesta etapa. Nenhuma captura Electron, exportação MP4 ou renderer de pixels foi executado.
- Revalidação depois da recuperação: `npm test` — 63/63; `npm run test:export:synthetic` — 33/33; `npm run typecheck`, `npm run build` e `git diff --check` passaram. O GitHub Actions no SHA `edc0bdf0dba9ba6db145471fc407ad50f83e3c65` passou no Windows, mas antecede este refinamento e não conta como CI desta revisão.
- Limites: o `VideoExportJobStore` ainda não é chamado por um orquestrador IPC/runner de produção; assets de personagem, pose, face, roupa, fontes e fundos não estão materializados como dependências pinadas (algumas imagens seguem embutidas como Data URL no documento); não existe renderer/encoder V5 conectado. A retomada persistente foi testada somente no store sintético, não por reinício real do Electron, e a prova de paridade continua aberta. V509 permanece parcial.

## 2026-10-19 — Rodada 11: imagens do snapshot deduplicadas e pinadas por conteúdo

- Base: `c542088becaa95100156e1d76bca5bb76df328db`, branch `master-desenvolvimento`.
- Problema medido estruturalmente: snapshots do Studio podem repetir as mesmas imagens em `assets`, `characterBases` e `characterKeys`; manter cada Data URL no JSON do job multiplicava o tamanho do documento e as miniaturas/capas não são entradas da cena.
- `electron/videoExportSnapshotAssets.ts` agora extrai Data URLs raster PNG/JPEG/WebP, valida a correspondência básica MIME/magic bytes, calcula SHA-256, deduplica por conteúdo, e serializa referências `gacha-export-asset:<sha>:<mime>`. SVG, formatos desconhecidos, base64 inválido ou bytes com MIME incorreto falham explicitamente.
- `VideoExportJobStore.create()` grava uma cópia única por conteúdo em `assets/images/<sha>.<ext>` dentro do job, valida tamanho/hash e armazena referências no snapshot. `thumbnailDataUrl` e `videoTimeline.coverDataUrl` são removidos da projeção persistida por serem artwork de catálogo, não entradas de render.
- `readSnapshot()` e `reopen()` verificam path, symlink, MIME/extensão, tamanho e SHA de cada imagem; conferem que cada referência tem exatamente um arquivo pinado e reidratam Data URLs para o renderer. Jobs v1 anteriores continuam sendo lidos sem migração; JSON antigo com Data URLs inline funciona com lista de imagens ausente.
- A fixture sintética usa o mesmo PNG em asset, base e key: o job contém somente um arquivo raster, o JSON não contém Data URLs, leitura restaura as URLs necessárias, capas/miniaturas são omitidas, e adulteração de imagem é rejeitada.
- Validação local final desta implementação: `node --test tests/video-export-jobs.test.cjs tests/video-export-snapshot.test.cjs` — 9/9; `npm test` — 63/63; `npm run test:export:synthetic` — 33/33; `npm run typecheck`, `npm run build` e `git diff --check` passaram. CI desta rodada aguarda o push; nenhum gate Electron/FFmpeg foi executado.
- Limites: somente imagens já embutidas no `StudioDocument` são pinadas por este caminho. Dependências resolvidas durante transições via Fabricador/Customizer (modelos, poses, componentes, catálogos e efeitos) ainda não são capturadas; nenhuma exportação real foi executada. V509 permanece parcial.

## 2026-10-19 — Rodada 12: vídeos idênticos compartilham um objeto pinado por hash

- Base: `fefb1b8a34717278feb7eb93c43b7e088d0b84ae`, branch `master-desenvolvimento`.
- Problema: o manifesto já deduplicava clips que referenciam o mesmo `assetId`, mas duas entradas lógicas com bytes idênticos ainda eram copiadas separadamente para cada job.
- `VideoExportJobStore` grava novas cópias pinadas em `assets/<sha256>`, reusa o objeto após validar tipo regular, tamanho e SHA-256, e mantém `assetId` como identidade lógica independente no manifesto. A lista/assinatura de dependências continua preservando cada ID.
- Compatibilidade: o verificador aceita tanto o layout content-addressed quanto caminhos antigos `assets/<assetId>.<extension>`; não reescreve jobs existentes.
- Fixture sintética cria duas dependências com IDs distintos e o mesmo conteúdo: o manifesto mantém as duas referências, há apenas um arquivo no job, e a retomada valida os bytes. Fixture separada reabre job legado no caminho por ID; adulteração continua rejeitada.
- Revalidação local: `node --test tests/video-export-jobs.test.cjs` — 6/6; `npm test` — 64/64; `npm run test:export:synthetic` — 34/34; `npm run typecheck`, `npm run build` e `git diff --check` passaram. Nenhum Electron, FFmpeg, MP4 ou dado pessoal foi utilizado.
- Limites: redução estrutural comprovada para IDs duplicados no fixture, mas sem benchmark de armazenamento ou export real. V509 continua parcial; fornecedores externos de personagem e integração do job com IPC/runner permanecem pendentes.

## 2026-10-19 — Rodada 07: compilador de transições compartilhado

- Base: `f9a0302a333cd2b1f819eb3aa85a5de368fa8a2d`, branch `master-desenvolvimento`.
- Divergência encontrada: `characterTransitions.ts` do preview e `videoSceneIR.ts` mantinham cópias da regra de janelas de transição, desempate de keys e supressão por gaps. As cópias eram equivalentes nos casos atuais, mas podiam divergir em futuras mudanças.
- Correção: `src/shared/videoCharacterTransitions.ts` agora compila uma única lista temporal; o hook do preview e o Scene IR consomem esse mesmo resultado. Mantidos janela de 15 frames, empate pela última key no mesmo frame, transições apenas quando o estado de atuação muda e supressão quando a janela cruza um gap. O preview também consulta samples de transição pelo frame absoluto quando pausado, se já estiverem no cache; a duração/latência da preparação ainda é assíncrona.
- O workflow `.github/workflows/video-export-synthetic.yml` não cobria os paths do Scene IR e dos novos lookups. Os filtros agora incluem módulos e testes de timeline/scene para disparar a validação sintética nos próximos pushes que os alterarem.
- Evidência sintética: teste adiciona key após um gap, verifica que a transição correspondente é suprimida e compara a lista inteira entre o wrapper usado pelo preview e o Scene IR.
- Verificações: `npm test` — 56/56; `node --test tests/video-scene-ir.test.cjs tests/video-timeline-index.test.cjs` — 13/13; `npm run typecheck`, `npm run build` e `git diff --check` passaram.
- Limite: isso unifica o plano temporal, mas não faz rasterização canônica da transição e ainda não conecta o Scene IR ao compositor DOM/print ou a MP4. Nenhum teste Electron/visual foi executado nesta rodada; a apresentação do preview pausado ainda depende do cache React assíncrono.


## 2026-10-19 — Rodada 05: metas de implementação Codex e dois modos de export

**Nova autorização do usuário:** modernização profunda do Video Studio, incluindo reconstrução de implementação interna caso seja tecnicamente melhor, sempre preservando funcionalidades, projetos e dados; extensibilidade obrigatória para adicionar features no futuro; dois modos de export com nomes provisórios Turbo 2× e Turbo 2× sem animações; Codex deverá sincronizar a branch `master-desenvolvimento` e desenvolver tudo localmente com autonomia e pesquisa open source. Persistir objetivo até gates, não encerrar em documentação.

**Documentos novos:**
- `docs/VIDEO_STUDIO_V5_MODERNIZACAO/07_MODOS_DE_EXPORTACAO.md` — enum de `animated` e `static-characters`, preservação de keys authored, vídeos e áudio, desligamento apenas de transições automáticas/blink/mouth em modo estático.
- `docs/VIDEO_STUDIO_V5_MODERNIZACAO/08_ARQUITETURA_EXTENSIVEL_E_RECONSTRUCAO.md` — interfaces e estrutura modular, substituição controlada/retrocompatibilidade, autorização condicionada de rebuild, teste de novo layer.
- `docs/VIDEO_STUDIO_V5_MODERNIZACAO/09_MISSAO_CODEX_AUTONOMA.md` — instruções operacionais completas para Codex local, sincronização segura, fases, testes, commits, pesquisa e critérios objetivos de conclusão.

**Revisados:** README, Plano Diretor, Arquitetura Canônica, Backlog, ADR, Plano Mestre antigo, specs de export, laboratório, diário e índice antigo para evitar objetivos conflitantes. As ideias originais de Smart Scene Compiler, cache semântico persistente, GPU Pixi, MLT/FFmpeg como candidatos, proxy, recuperação, autotuner, benchmark invisível e Smart Export continuam explicitamente exigidas.

**Evidência:** commits documentais na branch `master-desenvolvimento`; consultar head final. **Não ocorreu desenvolvimento da engine, export MP4, CI, benchmarks ou validação gráfica nesta rodada**. Documentação não é prova de aplicação funcional.

**Próximo agente/Codex:** seguir `09_MISSAO_CODEX_AUTONOMA.md`, inventariar código e funções antes de deletar arquivos, implementar e testar os dois modos e arquitetura extensível; progresso medido por gates e benchmarks reais, não por estética de código.

## 2026-10-19 — Rodada 13: matemática de transição de personagem movida para shared

- Base: `705357f90a6172060c6738de2e87033aaedab31c`, branch `master-desenvolvimento`, sincronizada com `origin` antes das alterações.
- `mixPoseArtwork`, interpolação de articulações, transforms da cena/rosto, efeitos faciais, aparência e easing foram extraídos para `src/shared/videoCharacterInterpolation.ts`. O preview manteve o wrapper `characterTransitions.ts` e os imports existentes; o `TransitionRenderer` passou a consumir diretamente o módulo shared.
- Teste sintético novo cobre rotação pela menor distância angular, limites de frame, transforms de palco, seleção de propriedades discretas no meio, interpolação de membro articulado, repeatabilidade e não mutação das poses de origem.
- Estado: V507 avançou na extração da matemática pura compartilhável, mas segue parcial. O `VideoSceneIR` ainda publica descriptor de transição e o renderer de preview ainda resolve assets e rasteriza via Customizer; não há consumidor de render/export usando o interpolador shared, nem prova pixel-equivalente ou execução visual Electron.
- Validação final: `npm test` — 67/67; `npm run test:export:synthetic` — 37/37; `npm run typecheck`; `npm run build`; `git diff --check` passaram. A suíte encontrou e corrigiu a simulação de dependência do wrapper no teste de Scene IR após a extração.
- Limite: somente testes Node sintéticos/build foram executados. Não houve execução visual do Electron, comparação de pixels, export MP4 ou benchmark de performance; nenhum dado pessoal ou mídia real foi usado.

## 2026-10-19 — Rodada 14: provider injetável para dependências centrais da transição

- Base: `d930f22c2983a515591ff7dd26028167edf87114`, branch `master-desenvolvimento`, sincronizada com `origin` antes de editar.
- A inspeção do consumidor real confirmou que `TransitionRenderer` lia modelo, pose, assets/catálogo facial e efeitos padrão diretamente de `window.desktop`. Essas cinco fontes agora estão atrás de `VideoCharacterTransitionCoreAssetProvider`; o adaptador existente do preview preserva o comportamento, enquanto um provider de snapshot aceita dados clonados, profundamente congelados e identificados por chaves sem duplicação.
- O teste sintético confirma que alterações posteriores na origem não afetam o snapshot/provider, faltas retornam como ausências explícitas, e referências duplicadas ou incompatíveis são rejeitadas. O teste usa objetos de fixture sem conteúdo pessoal.
- Ações de qualidade: os paths do módulo/provider e renderer foram acrescentados ao workflow sintético; o provider é injetável, mas ainda não está ligado a um job de export.
- Estado V509: segue parcial. `CustomizerPage.prepareSavedCharacterRenderer()` ainda resolve roupas, cabelo, face, olhos fechados e componentes dependentes usando `window.desktop`; nenhuma coleta transitiva, serialização por hash ou recuperação após reinício foi implementada nesta rodada.
- Validação final: `npm test` — 69/69; `npm run test:export:synthetic` — 39/39; `npm run typecheck`; `npm run build`; `git diff --check` passaram. O workflow sintético foi atualizado para executar com mudanças nestes módulos/testes.
- Limite: não houve Electron gráfico, MP4, captura ou comparação visual. O provider cobre somente fontes centrais consultadas pelo `TransitionRenderer`; o Customizer continua com dependências vivas de roupa/cabelo/face e ainda não há pacote persistido/reidratado por job.

## 2026-10-19 — Rodada 15: provider completo até o compositor de personagem

- Base: `9c6f008244ca5c4331513b4c3854f7f5e2442815`, branch `master-desenvolvimento`, sincronizada com `origin` antes desta rodada.
- A interface `VideoCharacterRenderAssetProvider` agora cobre os métodos do Fabricador/Customizer lidos pelo render de personagem: modelo, pose, hairstyle, roupa, face legacy, catálogo e resumos/ativos faciais. `TransitionRenderer` encaminha a mesma instância para `loadStandardExpressionEffects()` e `prepareSavedCharacterRenderer()`; a função do Customizer usa o provider nos loaders de cabelo, roupa, pose, modelo, face, catálogo, olhos fechados e efeitos. Chamadas normais do Customizer mantêm `window.desktop` como padrão compatível.
- Fixture sintética instancia o `TransitionRenderer` com provider falso e confirma leituras de modelo/duas poses/catálogo, carregamento de efeitos e identidade do provider que chega ao compositor Customizer. Isso valida a rota de chamadas, não pixels/canvas.
- O workflow sintético passou a observar mudanças em `CustomizerPage.tsx` além do provider e renderer.
- Validação local: `npm test` — 70/70; `npm run test:export:synthetic` — 40/40; `npm run typecheck`; `npm run build`; `git diff --check` passaram.
- Limite V509: ainda falta coletar todas as dependências realmente usadas por um personagem/transição, construir um provider completo só de snapshot e persistir/hasear/pinar esses bytes no job para reabertura. O preview continua usando a origem viva; não houve Electron visual, MP4, reinício ou teste de paridade.

## 2026-10-19 — Rodada 16: captura e pinagem transitiva de assets de personagem (base `5ba0ed3`)

### Alterações

- `src/shared/videoCharacterRenderAssets.ts`: substituiu o snapshot restrito ao núcleo por um provider gravador para toda a superfície Fabricador/Customizer já encaminhada ao renderizador. Leituras repetidas compartilham a mesma Promise; valores são clonados/congelados; snapshot JSON é ordenado e versionado; parse valida referências; um provider reaberto falha explicitamente quando a composição pede uma leitura não capturada.
- `src/renderer/src/features/videoStudio/videoCharacterAssetCapture.ts`: novo capturador sequencial percorre cada sample intermediário de transição com `TransitionRenderer`, registra o progresso e permite cancelar entre renders. Falta conectar esse capturador ao fluxo real de preflight/IPC de export.
- `electron/videoExportSnapshotAssets.ts`: a extração e hidratação por SHA-256 agora servem a qualquer payload JSON compatível com imagens PNG/JPEG/WebP; helpers antigos de snapshot continuam disponíveis.
- `electron/videoExportJobs.ts`: o job pode persistir `character-assets.json`, calcular seu hash, pin imagens em `assets/images/` por conteúdo e reidratar o provider após reabertura. Arquivos visuais idênticos entre o snapshot do Studio e os assets do personagem compartilham o mesmo blob físico. Os campos são opcionais para preservar leitura dos jobs legados.
- `tests/video-character-render-assets.test.cjs` e `tests/video-export-jobs.test.cjs`: cobrem memoização, JSON estável, mutação da origem depois da captura, referências ausentes/incompatíveis, captura sequencial e progresso, pinagem/hidratação após reabrir, deduplicação de PNG e rejeição de hash alterado.
- `.github/workflows/video-export-synthetic.yml`: paths da captura e do helper de persistência adicionados ao filtro do gate sintético.
- `docs/VIDEO_STUDIO_V5_MODERNIZACAO/06_BACKLOG_DE_EXECUCAO.md`: V509 atualizado como parcial, com fronteiras restantes.

### Validação local

- `node --test tests/video-character-render-assets.test.cjs tests/video-export-jobs.test.cjs`: 11/11 passaram.
- `npm test`: 72/72 passaram; `npm run test:export:synthetic`: 42/42 passaram.
- `npm run typecheck`, `npm run build` e `git diff --check`: passaram.
- Os testes de captura isolam `TransitionRenderer` com um provider sintético; o teste de `TransitionRenderer` também usa stubs de Customizer. Isso verifica contratos e passagem de provider, não executa pixels do Customizer real nem o runtime Electron.

### Estado e pendências

- V509 avançou em captura/serialização/pinagem e reabertura sintética, mas não está concluído. Não há chamada de produção que crie job com `characterAssets`, nenhum IPC/runner usa o provider reaberto, e nenhuma saída MP4 depende dele ainda.
- A captura atual renderiza todos os samples internos de transição de forma serial; seu custo precisa ser medido em projetos sintéticos longos e pode ser reduzido somente preservando cobertura de todas as dependências.
- Nenhum dado pessoal ou biblioteca local foi aberto ou modificado. Nenhum teste DEV AI/auditoria foi executado.

## 2026-10-19 — Rodada 17: proteção de caminhos ao fixar imagens de job

- Revisão pós-CI identificou que a rotina de pinagem confiava no diretório `assets/images` sem validar os pais antes da primeira escrita. `VideoExportJobStore.pinSnapshotImage()` agora resolve e confere o root do job, rejeita `assets`/`images` como symlink ou junction e só então cria o arquivo temporário dentro do diretório canônico.
- `tests/video-export-jobs.test.cjs` inclui caso sintético com junction/symlink para fora do job e confirma que nenhum arquivo chega ao destino externo.
- Validação: `node --test tests/video-export-jobs.test.cjs` — 8/8 passou; `npm test` — 73/73; `npm run test:export:synthetic` — 43/43; `npm run typecheck`, `npm run build` e `git diff --check` passaram.
- A correção preserva o escopo de V509 parcial; ainda não há conexão com o fluxo de export de produção nem runtime Electron/MP4.

## 2026-10-19 — Rodada 18: smoke local reprodutível do writer com FFmpeg real

- Novo comando manual `scripts/video-studio/ffmpeg-local-smoke.cjs` recebe caminhos absolutos explícitos para `ffmpeg.exe` e `ffprobe.exe`; não procura executável no `PATH`. Gera 60 frames BGRA sintéticos 1920×1080, usa `VideoRawFrameWriter`/perfil atual `h264_mf`, valida metadados do MP4 com FFprobe e decodifica o arquivo inteiro. O MP4 temporário é removido após validação; o JSON de saída guarda versão, licença de build, frames, bytes e hash, sem path local.
- Executado com o FFmpeg WinGet local v8.1.2 Gyan full build. Resultado observado: H.264, 1920×1080, 60/1 FPS, duração 1 s, 60/60 frames lidos, decode integral aprovado, tamanho 1.810.830 bytes, SHA-256 `e3f953be9bdfce958063ba71f315d52b17026d4ca0b1793a2836fb0630eeecc6`.
- O binário usado tem `--enable-gpl`; a saída do harness marca `gplBuild: true` e `redistributionValidated: false`. Ele serve apenas para teste local e não pode ser empacotado/selecionado pelo app sem resolver licença e build compatível.
- Limite: os pixels vêm de `renderSyntheticBgraFrame()`, não de cena/personagens do V5. Não houve Electron, áudio/AAC, interface, cancelamento, recuperação, pipeline VFR, dois modos nem comparação preview/export. Isto prova só a interoperabilidade sintética do writer e deste encoder local, não fecha M2/V515 ou a exportação do produto.


## 2026-10-19 — Continuação independente após 16 commits do Codex

**Base GitHub observada:** `afc0531197ffb52b27c6b24ba804f445a019f5c7` em `master-desenvolvimento` — 16 commits do Codex desde `05a262b6`; feitos semantic scene IR, lookups/transition, pinned assets, job manifest upgrades e testes sintéticos. **Ainda não há MP4 real / compositor completo / UI de export comprovada**.

**Mudanças commitadas nesta continuação:**
1. `src/shared/videoCharacterTimeline.ts` — `VideoCharacterTimelineLookup.stateKeys`: indexa somente keys com estado visual. `videoCharacterStateAt` faz binary search sobre `stateKeys`, eliminando busca reversa linear por grandes sequências de eventos sem artwork; mantém regra de desempate de keyframe no mesmo frame e stage transform. Commit `c0f5734a`.
2. `tests/video-timeline-index.test.cjs` — teste sintético com **12.000 metadata keys**, boundaries, ties de authored state e seek reverso, sem tocar dados reais. Commit `e1b62a41`.
3. `src/shared/videoSceneIR.ts` — validação runtime de `RenderVariant`; recusa valores inválidos de input deserializado em vez de habilitar efeitos implicitamente. Commit `6afd65a7`.
4. `tests/video-scene-ir.test.cjs` — guarda contra variante desconhecida/nula e mantém variantes válidas. Commit `a52fe977`.

**Estado de evidências:** análise do código + commits via GitHub, verificação estática das mudanças. **Não** rodei Node/typecheck/build/Electron/FFmpeg/CI ou benchmarks nesta continuação; commits de código aguardam gate local ou Actions no HEAD. A melhora assintótica é demonstrável pela estrutura de busca, mas o ganho de tempo real **não foi medido**.

**Próximo passo de maior valor:** integrar `VideoSceneIR` aos assets/renderer real e capturar still canônico; depois gerar MP4 serial válido com probe/FFprobe/áudio antes de Turbo. Seguir V505/V507/V509/V512-V518, preservar contratos e dois modos da modernização.

## 2026-10-19 — Corrigir recorte de pose vazando entre faixas

- Causa: o `width`/`height` do personagem descreve o retângulo visível da arte recortada daquela pose. A sincronização global de transformações incluía esses campos e, ao mudar a pose no playhead, copiava as novas dimensões para a pose anterior e todas as demais faixas. Saves antigos também podiam reaplicar `width`/`height` legados em cada estado ao resolver o palco.
- Correção: transformações globais agora sincronizam posição, rotação, espelhamento, escala uniforme/por eixo e camada. A largura e a altura do recorte continuam no estado de cada pose. Leituras de `characterTransforms` legados filtram `width`/`height` sem reescrever os saves.
- Cobertura sintética: `tests/video-character-track.test.cjs` testa duas poses com recortes distintos, mudanças globais que devem alcançar ambas sem alterar os recortes, e compatibilidade com transformações antigas contendo dimensões. `tests/video-timeline-index.test.cjs` atualiza o contrato do resolver global.
- Limite: testes de lógica, typecheck e build não substituem confirmação visual no Electron com roteiro real. Nenhum projeto ou personagem pessoal foi aberto ou alterado.

### 2026-10-20 — oracle Electron DOM/Canvas com preview de vídeo real

- Base de código: `1a4658e955a1b7e1160e1ef6f2b8a7360c69746b`, branch `master-desenvolvimento`; `origin` estava no mesmo SHA antes desta rodada. Sem dados pessoais, DEV AI ou auditorias completas.
- `VideoPreviewOraclePage` agora monta o componente de produção `VideoStudioClipPreview` e aguarda o frame do `<video>` realmente buscado; o preload restrito pode usar a URI do fixture sem ampliar IPC. O harness valida oito seeks e A-B-A em `animated` e `static-characters`, compara ROIs de personagem/texto/vídeo/V546 e confere source tick, camadas e snapshot imutável.
- Correções de paridade no Canvas: caixa de texto/alpha/padding, border radius e cauda de balões; geometria CSS `border-box` na extensão V546; z-order correspondente entre DOM e Canvas. Oracle diferencia contagem de pixel alterado acima de 1 canal sem ocultar MAE, p95 ou erro máximo.
- Evidência: A-B-A binário em ambas as superfícies/variantes. Hashes e métricas de ROI estão em `docs/VIDEO_STUDIO_V5_MODERNIZACAO/04_LAB_E_GATES.md`. ROI de vídeo pior: MAE 0.931, changed ratio 7.68%, p95 1, máximo bruto 107, consistente com o limite documentado para dois decoders diferentes.
- Verificações locais: `npm test` 117/117, `npm run typecheck`, `npm run build` e `GACHA_FFMPEG_PATH=<ffmpeg local> npm run test:video:character-media-oracle` passaram. `git diff --check` é repetido antes do commit. O Actions deste novo SHA ainda deve ser verificado depois do push.
- Escopo continua parcial: prova sintética preview DOM ↔ Canvas não fecha paridade MP4/print/Studio normal nem os critérios completos de V501/V502/V504, V508/V510 e V546. Nenhum gate de release foi marcado como concluído.

### 2026-10-20 — benchmark serial/Turbo da superfície completa (amostra curta)

- Base local: `d44f5dabc87a7ad4a2723160fd4138d2e1078010`, branch `master-desenvolvimento`. Nenhum fetch, push, PR ou merge foi feito nesta etapa.
- `scripts/video-studio/full-engine-worker-benchmark.cjs` agora mede o tempo de parede completo (abertura da superfície, render/encode, montagem e validação), composição e readback, aquisição/escrita de frames, working set dos processos Electron, contagem/decodificação dos frames e SHA-256. Aceita durações de 5, 30 ou 90 segundos. Falhas são propagadas em vez de terminarem como sucesso.
- Corrigido encerramento antecipado do Electron: fechar a janela do benchmark serial fazia o host sair antes de iniciar Turbo. O ciclo serial e os dois workers agora completam na mesma execução.
- Amostra local sintética de 5 s, Windows, Ryzen 5 4600G, 12 processadores lógicos, 16 GB RAM. Serial: 17,14 s, 17,50 fps, working set Electron inicial/pico 94/102 MB. Dois workers: 12,11 s, 24,78 fps, working set Electron inicial/pico 947/1.425 MB. A aceleração observada nesta única amostra foi 1,42×. Processos FFmpeg externos não entram na métrica de RAM.
- Integridade: ambos os MP4 têm H.264, 1920×1080, 60/1, 300 frames lidos e decodificação integral aprovada; tamanho igual (2.948.685 bytes) e SHA-256 igual (`5d354b46dd589efa2344cbac7ef5aaea3a73c731dce4ec093dc9770991c5c2a2`).
- Interpretação: a amostra prova que os dois caminhos executaram e produziram o mesmo arquivo nesta fixture. Uma duração de 5 s e um cenário não satisfazem os benchmarks longos nem os gates de estabilidade/performance; Turbo permanece sem recomendação até repetição em 30/90 s, perfis adicionais e medição de memória incluindo FFmpeg.
- Nenhum dado pessoal, biblioteca de assets ou projeto foi usado. A mídia foi gerada sinteticamente em diretório temporário.

### 2026-10-20 — matriz de perfis full-engine serial/Turbo e guard de memória

- Continuação local sobre `93cebcf`; código consolidado em `ce63f09` (`perf(video-studio): benchmark realistic engine profiles`). Branch `master-desenvolvimento`, sem publicação remota.
- O benchmark usa agora uma fixture compartilhada com o oracle de mídia/personagem e cinco cargas: `mixed-realistic`, `static-heavy`, `transition-heavy`, `imported-video-heavy` e `text-heavy`. Cada perfil foi executado uma vez em 5 s, com saída serial e dois workers.
- Resultados Windows/Ryzen 5 4600G/12 processadores lógicos/16 GB: mixed 21,01/14,80 s (1,42×; working set 1,19/1,66 GB); static 29,26/21,55 s (1,36×; 1,76/3,18 GB); transitions 14,88/12,19 s (1,22×; 0,81/1,18 GB); imported video 32,53/20,88 s (1,56×; 1,39/1,85 GB); text 57,80/42,31 s (1,37×; 4,30/6,07 GB). Por perfil, serial e dois workers geraram o mesmo hash e passaram FFprobe e decode integral: H.264 1920×1080, 60 fps, 300 frames.
- Adicionado ao autotuner um guard provisório de complexidade: 12+ unidades (elementos, clipes de vídeo e grupos aproximados de keys de personagem) escolhem serial; teste cobre fronteira 11/12. A regra limita a explosão observada nas cenas pesadas, mas não é calibração definitiva.
- `npm run test:video:character-media-oracle` (Windows, animated e static-characters), `npm test` (117/117), `npm run typecheck`, `npm run build`, `node --check` dos scripts da fixture/oracle/benchmark e `git diff --check` passaram. Não rodei DEV AI, auditorias completas, nem alterei dados pessoais.
- Limites: amostra única de 5 s por perfil, um PC e um encoder; não há amostras repetidas, projetos de 30/90 s, áudio, ou medição da memória dos subprocessos FFmpeg. O working set do Electron chegou a 6,07 GB em text-heavy com dois workers. Portanto, não se recomenda Turbo como padrão com base nestes resultados; falta benchmark longo e medição de memória do job completo.
- Próximo passo: medir cache frio/quente e invalidação com a mesma fixture, depois repetir a matriz em 30 s e 90 s com supervisão de memória total antes de recalibrar o autotuner. Relatório detalhado: `docs/VIDEO_STUDIO_V5_MODERNIZACAO/04_LAB_E_GATES.md`.

### 2026-10-20 — cache persistente frio/quente (harness atual)

- `npm run bench:video:cache` executado localmente com caminhos explícitos para FFmpeg/FFprobe. O harness Electron gerou 120 frames de uma cena sintética de texto, armazenou 20 estados únicos e validou o MP4 por contagem de frames.
- Cache frio: 5.553,36 ms, 21,61 fps, 20 renders de superfície, 20 misses/20 writes/100 hits, 3.167.900 bytes. Cache quente após nova instância: 4.223,58 ms, 28,41 fps, zero renders, 120 hits, zero misses/writes; velocidade observada 1,315×. Os MP4s tiveram o mesmo tamanho (201.649 bytes).
- Limitação: o harness mede uma cena simples de texto e não executa uma mudança de conteúdo para provar invalidação por `VideoSceneIR.reuseKey`; portanto demonstra reabertura/caminho quente do cache e custo deste caso, não ganho geral nem invalidação semântica completa. Próxima melhoria: ampliar esse harness com a fixture real compartilhada e alteração de uma dependência para provar que apenas os frames afetados perdem cache.

### 2026-10-20 — instrumentação do layer cache no benchmark full-engine

- A surface de export reporta contadores cumulativos de `VideoCanvasLayerCache`; o benchmark calcula deltas por worker e registra hits/misses/evictions/bytes ocupados e desenhos de layer evitados. Não altera o output nem os contratos de projeto.
- Typecheck e build passaram. Perfil misto de 5 s reexecutado: serial 20,60 s e dois workers 14,66 s (1,405×); ambos H.264 1080p60, 300 frames decodificados, mesmo SHA-256 `47544666d67287f60e96c0b568014f06fe467ca0dac59d0a17b0a0e830e768cc`.
- Layer cache serial: 3.042 hits, 148 misses, 136 evictions, pico 99.532.800/100.663.296 bytes (~95 MiB/96 MiB). Dois workers: 3.032 hits, 158 misses, 134 evictions, mesma ocupação máxima por surface. `avoidedLayerDraws` corresponde aos hits, ou seja, rasterizações de layer reutilizadas; o compositor ainda desenha cada canvas de layer no destino.
- Limite: não existe neste ensaio a comparação A/B com layer cache desativado. Portanto os contadores provam hits/evicções e uso do orçamento, mas não quantificam ganho de tempo atribuível ao cache. Próximo passo: comparar cache ligado/desligado na mesma fixture, preservando paridade do hash e acompanhando RAM; somente depois decidir se vale ampliar granularidade ou testar dirty rectangles.
