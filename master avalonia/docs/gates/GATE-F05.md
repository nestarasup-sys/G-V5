# GATE-F05 — RenderScene e SkiaRenderer

**Data:** 2026-10-21  
**Branch:** `Master-AValonia`  
**Tarefas:** F05.01–F05.11  
**Resultado:** **PASSOU para renderização determinística CPU/headless e composição de personagem sintético.**  
**G1 global:** **PASSOU para a fundação local CPU/headless**, junto às evidências F02–F04. GPU e paridade visual do produto continuam fora do aceite deste gate.

## Critérios e evidências

| Critério | Evidência verificada |
|---|---|
| Cena e layers imutáveis com AssetId, crop, transform, alpha, blend, flip e ordem | `RenderSceneTests`; F05.01 |
| Construção das partes na ordem back-to-front declarada | `BodyRenderSceneBuilder`; `RenderSceneTests`; F05.02 |
| PNG transparente determinístico de peça | Golden independente em `tests/Fixtures/rendering/synthetic-garment.golden.png`; teste `RenderAsyncMatchesTransparentSyntheticGarmentGoldenPixelForPixel`; F05.04 |
| Composição multi-layer com crop, rotação, alpha, flips e blends | Golden `multi-layer.golden.png`; comparação pixel a pixel; F05.05 |
| Primeiro personagem sintético passa do builder corporal ao renderer | `BodySceneBuilderAndSkiaRenderer_RenderFirstSyntheticCharacter`: seis partes ordenadas (cabeça, torso, dois braços, duas pernas), pixels opacos/coloridos e leases liberados; F05.11 |
| Views não compõem scenes nem chamam Skia | `AppViews_PresentStateWithoutOwningSceneCompositionOrSkiaRendering` inspeciona AXAML e code-behind das Views e rejeita dependências/código de engine; F05.11 |
| Cache e redraw parcial preservam pixels do renderer completo | `IncrementalRenderer_Matches_Full_Render_And_Invalidates_Only_Changed_Layer_Signature`; cenário de 80 layers do benchmark compara a imagem inicial e a alterada, ambos com zero pixels diferentes; F05.09/F05.10 |
| Erro durante redraw parcial não deixa um frame incompleto como baseline | `IncrementalRenderer_Invalidates_Partially_Drawn_Cache_When_Asset_Acquisition_Fails`; teste confirma recuperação pelo render completo; F05.09 |
| Versões antigas/canceladas de preview não são publicadas | Testes Headless de `LatestPreviewRenderer`; F05.08 |
| Overlays não alteram o frame-base nem interceptam input | Testes Headless de grid, seleção e pivôs; F05.07 |
| Desempenho e memória medidos sem incluir comparação pixel a pixel no cronômetro | `docs/benchmarks/F05.10-render-benchmark.md`; F05.10 |
| Contexto GPU independente não é criado prematuramente | `Rendering_StaysOnCpuUntilGpuInteropHasAnExplicitOwnerAndLifecycle`; leitura do renderer confirma superfícies raster CPU; F05.11 |

## Build e testes do gate

Comando local executado:

```text
TestarLocal.bat gate
```

Resultado: **PASSOU**, Release, exit code 0. Build: 0 erros. Testes: Core 11/11, Architecture 8/8, Geometry 35/35, Assets 27/27, Data 44/44, Rendering 18/18, Headless 20/20; nenhuma falha ou teste ignorado.

O build emite dois avisos CS0618 preexistentes em `src/GV5.Data/Thumbnails/ThumbnailService.cs:218` (`SKPaint.FilterQuality`/`SKFilterQuality`). Nenhum aviso ou erro novo foi emitido por F05.

## Limites CPU e GPU registrados em F05.11

- `SkiaRenderer` usa `SKSurface.Create(SKImageInfo)` para rasterização CPU. A suíte headless executa o mesmo renderer sem janela nativa.
- Os limites configurados atualmente são dimensão máxima de 8192 pixels e orçamento de 32.000.000 pixels. Com 4 bytes por pixel, um buffer RGBA no orçamento máximo representa 128.000.000 bytes (aproximadamente 122 MiB). Isso é um limite de entrada/alocação por frame, não um orçamento de RAM do processo.
- `IncrementalSkiaRenderer` mantém no máximo um frame de cena e tem orçamento padrão de 128 MiB; devolve cópia independente ao chamador. Cópias para o chamador e `WriteableBitmap` da apresentação podem coexistir com a cache e com superfícies temporárias. O pico total de RAM não foi medido no tamanho máximo e não é declarado como limitado a 128 MiB.
- `GV5.Rendering` não cria `GRContext`, `GRGlInterface` ou superfície GPU independente. A apresentação Avalonia recebe pixels por `AvaloniaRenderedFrameAdapter`; eventual aceleração do compositor da UI é independente da engine e não foi medida aqui.
- Não houve validação de janela nativa, GPU, múltiplos DPI, benchmark de assets reais ou captura comparável ao Electron. Isso permanece **NÃO TESTADO** e não impede o gate CPU/headless.
- Não se recomenda criar `GRContext` até haver contrato de propriedade/thread/lifetime integrado ao backend de desenho Avalonia e benchmark que demonstre necessidade. O primeiro backend G-V5 permanece raster CPU.

## Resultado

F05 cumpriu o critério G1 do primeiro render: PNG transparente determinístico e personagem sintético são renderizados por uma engine separada, enquanto as Views apenas apresentam estado. **GATE-F05 PASSOU** e **G1 CPU/headless PASSOU**. O próximo trabalho sequencial é **F06.01 — definir modelo, slots/IDs, partes, ordem, sourceTransform e drafts versionados**.

Este resultado não valida a aparência do shell nem qualquer página contra captura real do Gacha 5. A matriz de fidelidade visual continua pendente conforme `docs/ui-fidelity/`.
