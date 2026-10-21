# GATE-F04 — Geometry Engine canônica

**Data:** 2026-10-21  
**Branch:** `Master-AValonia`  
**Última tarefa da fase:** F04.11  
**Resultado:** **PASSOU** para a engine geométrica sintética.  
**Gate global G1:** permanece em execução; F05 ainda precisa comprovar render determinístico e personagem sintético.

## Escopo validado

F04 entrega matemática imutável independente de UI para pontos, retângulos, matrizes, espaços coordenados, transformações, hierarquias, joints/bones, hit testing, z-order, snap e binding de roupa.

| Capacidade | Evidência |
| --- | --- |
| Point/Rect/Matrix/Transform finitos, composition order e overflow rejeitado | `GeometryPrimitiveTests`; F04.01/F04.03 |
| Tipos `ModelSpace`, `SceneSpace`, `ViewSpace`, conversões compostas e inversa | `CoordinateSpaceTests`; F04.02 |
| Escala não uniforme, rotação em torno do pivô e translação na ordem declarada | `GeometryPrimitiveTests`; F04.03 |
| Flips X/Y, reversão de flips e ângulos negativos/extremos finitos | `GeometryPrimitiveTests`; F04.04 |
| Hierarquia local/global com âncoras e snapshots reparentados sem mutação | `TransformHierarchyTests`; F04.05 |
| Rig torso→braço→mão, propagação em cadeia e rejeição de ciclo/parent inválido | `RigSkeletonTests`; F04.06 |
| Hit em coordenada local via inversa, clip, singularidade, z-order e bounds rotacionados/espelhados | `GeometryHitTesterTests`; F04.07 |
| Snap horizontal/vertical por start/center/end, threshold e tie-break determinístico | `SnapEngineTests`; F04.08 |
| Wardrobe binding neutro, rotacionado, espelhado e escalas X/Y não uniformes | `WardrobeBindingMathTests`; comparação estática em `docs/geometry/LEGACY_GEOMETRY_GOLDENS.md`; F04.09/F04.10 |
| Inversas e round-trips com pontos/escala/ângulos fixos e benchmark 10/100/1000 | `GeometryPrimitiveTests`; `tools/BenchmarkGeometry.bat`; F04.10/F04.11 |

O código da engine e os testes não referenciam Avalonia. `ModelSpace`, `SceneSpace` e `ViewSpace` são marcadores matemáticos; o fluxo visual ainda será implementado pelas camadas posteriores.

## Build e testes Release

Executado dentro de `master avalonia/`:

```text
TestarLocal.bat gate
```

Resultado: **PASSOU**, exit code 0. Restore da solution e Headless, build Release com 0 erros; Core 11/11, Architecture 6/6, Geometry 35/35, Assets 27/27, Data 44/44, Headless 15/15. `git diff --check` passou nos commits de implementação e documentação do gate.

O build reportou dois avisos CS0618 preexistentes no `ThumbnailService.cs:218` para `SKPaint.FilterQuality` e `SKFilterQuality`, cuja API recomendada é `SKSamplingOptions`. Não há avisos novos em `GV5.Geometry`.

## Benchmark sintético local

Comando: `tools/BenchmarkGeometry.bat`, que usa o SDK portátil e compila em Release. Operação medida: avaliar world matrices de um rig em cadeia com uma pose completa por parte. Cada ponto reporta a mediana de sete lotes após três warmups.

**Ambiente:** AMD Ryzen 5 4600G with Radeon Graphics, 12 processadores lógicos visíveis, Windows 11 Pro build 26300, .NET 10.0.13, processo x64.

| Partes | Avaliações por lote | Mediana por avaliação | Avaliações/s (estimativa) | Bytes gerenciados alocados por avaliação |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 500 | 0,0088 ms | 114.090 | 1.120 B |
| 100 | 200 | 0,0858 ms | 11.654 | 8.416 B |
| 1.000 | 50 | 0,1483 ms | 6.743 | 84.049 B |

São apenas resultados observados nesta máquina, não limites de produto nem comparação com Electron. A carga avalia matrizes de rig em CPU; não mede Avalonia, render, GPU, memória nativa, input, assets reais ou experiência visual. Repetir em hardware e cargas reais antes de escolher limites de produto.

## Limites e decisão

- `RigJointMode`/`IsSuggested` persistem informação da junta; regras de interação/bloqueio/heurística pertencem ao Fabricador.
- Wardrobe binding cobre projeção geométrica. Overlap de joelho, padding de manga e renderização de peças ficam nos módulos de roupa/renderização.
- A comparação com o legado usou fórmulas e dados sintéticos do código, sem abrir dados pessoais e sem executar a interface Electron.
- Nenhuma paridade visual do Gacha 5 é declarada. As telas continuam pendentes na matriz `docs/ui-fidelity/MATRIZ_PARIDADE_VISUAL.md`.
- G1 continua aberto até F05 entregar PNG transparente determinístico e primeiro personagem sintético renderizado sem lógica de composição na View.

As tarefas F04.01–F04.11 estão validadas e o gate de fase **F04 PASSOU**. Próxima tarefa sequencial: **F05.01**.
