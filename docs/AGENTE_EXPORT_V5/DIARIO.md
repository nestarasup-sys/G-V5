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
