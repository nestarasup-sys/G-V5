# GATE-F06 — Fabricador I: modelos e peças

**Data da verificação local:** 2026-10-21
**Branch:** `Master-AValonia`
**Tarefas:** F06.01–F06.14
**Resultado:** **BLOQUEADO — validação de produto/visual pendente.**
**Código e persistência:** fluxo integrado comprovado com fixture sintética e SQLite/AssetStore reais.

## Critério do gate

O Plano Mestre exige importar, editar, desfazer, salvar, reabrir e publicar um modelo real. O fluxo integrado abaixo percorre essas operações com serviços, ViewModel, banco SQLite, arquivos de assets e publicação de revisão imutável reais; a imagem de origem é sintética, criada pelo teste. Isso comprova a integração do pipeline, mas não comprova o resultado com uma folha de personagem representativa do usuário.

| Critério | Evidência | Estado |
|---|---|---|
| Publicar revisões imutáveis e preservar revisão anterior | `SqliteModelRevisionRepositoryTests.Publish_CreatesImmutableSnapshots_PinsAssets_AndIsIdempotent`; triggers SQL rejeitam UPDATE/DELETE e testes confirmam versões/refs | COMPROVADO |
| Falha por asset ausente sem publicação parcial | `PublishRejectsUnavailableReferencedAssetWithoutCreatingRevisionOrReferences` | COMPROVADO |
| Importar e separar folha em peças no fluxo do Fabricador | `FabricatorModelSourceImportTests.ConfirmedSourceIsSplitIntoSortedLegacyCompatiblePngAssets`; Headless importa via picker, persiste os assets/partes e renderiza a prévia | COMPROVADO COM FIXTURE SINTÉTICA |
| Editar, desfazer, salvar, fechar e reabrir SQLite | `FabricadorImportPreviewUiTests.RealSqliteImportEditUndoSaveReopenAndPublishKeepsModelAssetsAndRevision`; verifica duas peças, revisão salva, bytes/metadata disponíveis após reopen e edição antes da publicação | COMPROVADO COM FIXTURE SINTÉTICA |
| Publicar depois da reabertura e ler snapshot | O teste integrado publica `Revision.Initial`, recupera o snapshot persistido e compara AssetIds/transforms às peças salvas | COMPROVADO |
| Erro de importação e retry/cancelamento | `InvalidImageFailsBeforePublicationAndRemovesItsStageFile`; `PublishFailureKeepsPreviewAvailableForRetryAndCancellationDoesNotPublish`; limites de pixel/arquivo | COMPROVADO |
| PNG e comportamento de canvas antes da separação | `SkiaRendererTests.ModelDraftPreviewPngMatchesLegacySourceCanvasForUnseparatedModel` confirma dimensões, origem e pixels contra a regra estática do canvas legado. `FabricatorModelSourceImportTests` compara a peça sólida inteira, margem alfa de 4 px e a cor/alfa de uma borda chroma-feathered com valores esperados pela fórmula portada | PARCIAL — fixture sintética |
| Paridade visual da página Modelos em estado equivalente | Não há capturas reais do Electron e Avalonia na mesma resolução/fixture, nem aprovação visual | PENDENTE |
| Uso com uma folha real representativa no Windows | Não realizado; nenhum arquivo pessoal foi aberto. Diálogo de arquivo, janela nativa, DPI e interação de ponteiro não foram exercitados neste gate | PENDENTE |

## Testes locais executados

Após a integração de segmentação e do fluxo SQLite, foi executado:

```text
TestarLocal.bat rapido
TestarLocal.bat gate
```

Resultado rápido: exit code 0; build Debug com 0 avisos e 0 erros antes do último teste de borda. Resultado Gate mais recente: exit code 0; build Release incremental com 0 avisos/erros. Core 18/18, Architecture 8/8, Geometry 35/35, Assets 31/31, Data 51/51, Rendering 22/22 e Headless 33/33. Total: 198 testes aprovados, nenhum falho ou ignorado. Uma compilação Release anterior recompilou `ThumbnailService.cs` e registrou dois avisos CS0618 preexistentes (`SKPaint.FilterQuality` e `SKFilterQuality`). `git diff --check` passou antes dos commits locais.

O teste integrado usa pastas temporárias, fonte PNG sintética, SQLite, `SqliteAssetStore`, pipeline de importação e revisão. Ele não lê nem altera os dados Electron do usuário.

## Revalidação do checkout atual

Em `2026-10-21`, no HEAD `eaac213` (`native: align Fabricator model shell with legacy layout`), `TestarLocal.bat rapido` foi executado novamente após a alteração da view e do canvas. O build Debug passou com 0 erros e 2 avisos CS0618 preexistentes em `ThumbnailService.cs`; Core 18/18, Geometry 35/35, Architecture 8/8, Assets 31/31, Data 51/51, Rendering 22/22 e Headless 33/33: **198 testes aprovados**.

Essa revalidação confirma que a alteração de layout não quebrou a suíte rápida. Não fornece captura Windows, fixture real, saída independente do worker Electron nem comparação visual; os itens pendentes e o estado bloqueado acima permanecem inalterados.

## Pendências para desbloquear

1. Conferir a folha de modelo real usada pelo fluxo pretendido em Avalonia no Windows, cobrindo seleção, separação, edição, undo/redo, salvamento/reabertura e publicação.
2. Capturar Electron e Avalonia com o mesmo estado, conteúdo, resolução e DPI; comparar estrutura, cores, medidas, estados e PNGs conforme `docs/ui-fidelity/CONTRATO_VISUAL_GACHA5.md`.
3. Comparar a saída do caso antialias/chroma com um PNG capturado de uma execução independente do worker legado; os valores atuais foram derivados da fórmula portada e não substituem essa comparação independente.
4. Atualizar esta página e a matriz novamente quando as capturas Windows/Electron e os casos ampliados de pixels forem coletados. Até lá, não iniciar F07 conforme a regra de gates do Plano Mestre.

Não há captura ou arquivo de fixture de usuário registrado. O status **BLOQUEADO** refere-se ao gate completo; as tarefas F06.12–F06.14 estão documentadas como concluídas, e o trabalho já validado não é desfeito por essa pendência.
