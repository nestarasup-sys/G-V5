# GATE-F08 — Roupas, binding e revisões

Data da auditoria: 2026-10-21  
Branch: `Master-AValonia`  
Escopo: auditoria técnica de F08.01–F08.12, com fixtures sintéticas e testes locais.

## Critérios do gate

| Critério | Evidência | Resultado |
| --- | --- | --- |
| Roupa presa a um modelo publicado exato | `WardrobeSet.Model`, `WardrobePoseResolver.Resolve` e repositório rejeitam revisão divergente; coberto por `WardrobeContractTests`, `WardrobePoseResolverTests` e testes SQLite de publicação | PASSOU |
| Binding local ao osso continua coerente em poses alteradas | `WardrobeBindingMath.Resolve` aplica centro, escala X/Y, rotação e flips; testes de matemática e F08.11 renderizam manga em pose-base e braço a 28° | PASSOU tecnicamente |
| Ordem de composição é estável | Resolver ordena por índice do osso e sequência; `WardrobeRenderSceneBuilder` intercala cada roupa após sua camada e reserva a fase final a óculos/acessórios permitidos; testes Core e Rendering cobrem a regra | PASSOU |
| Publicar não altera consumidores silenciosamente | Snapshots publicados têm IDs e checksums próprios, são append-only; publicar de novo sem mudança é idempotente, edição posterior cria nova revisão e preserva as anteriores; testes SQLite reabrem o banco e conferem ambas | PASSOU |
| Dados e arquivos seguem íntegros | Transações SQLite, revisão otimista, asset references por draft/publicação, FK restritiva, detecção de assets ausentes e GC apenas após liberar referências; testes exercitam falhas e caminhos de exclusão | PASSOU |
| Catálogo não carrega coleção inteira de miniaturas | Paginação/cursor estável, filtro por modelo/categoria e prefetch somente da janela visível, cobertos por testes headless | PASSOU |
| Exclusão destrutiva é protegida por dependências | Consulta lista dependências de modelo, pose e roupa; publicação imutável bloqueia delete; uma roupa não publicada só é removida sob revisão esperada e transação | PASSOU para APIs existentes |
| Variações visuais sintéticas não regrediram | Cinco goldens 64×64 cobrem manga, calça, saia, acessório de cabeça e pose rotacionada; comparação pixel a pixel e painel de diferenças | PASSOU em CPU |

## Fluxo renderizado auditado

`WardrobeBinding.Bind` → `WardrobeBindingMath.Resolve` → `WardrobeComponentPosePlacement` → `WardrobeRenderSceneBuilder` → `SkiaRenderer`.

O builder usa crop proveniente dos metadados do asset, preserva posição/escala/rotação/flip, insere roupa junto ao osso e mantém acessórios permitidos acima das camadas de cabelo. Ele não modifica `WardrobeSet`, pose ou revisões publicadas.

## Divergências e limitações registradas

- A interface Avalonia do Fabricador ainda não está ligada ao editor, catálogo ou consulta de dependências de roupa. O gate é de engine/dados e não declara a área visualmente completa.
- Os repositórios atuais não oferecem operações de exclusão para modelos e poses. A consulta de uso existe; não há caminho destrutivo correspondente para bloquear nesta etapa.
- Goldens usam personagem/atlas sintéticos e não são capturas do Electron, nem provam paridade com assets reais.
- Validação de janela Windows, GPU, DPI, arrasto real, acessibilidade e comparação visual com o legado permanecem pendentes para os gates de produto aplicáveis.

## Resultado

**GATE-F08 PASSOU tecnicamente**: contratos, projeção, composição de cena, persistência imutável, referências e exclusão protegida estão cobertos por testes determinísticos. As divergências acima continuam abertas e impedem declarar paridade visual ou fluxo de UI completo; não invalidam o gate técnico conforme ADR-0006.

Validação final em 2026-10-21: `TestarLocal.bat gate` — build Release, 2 avisos CS0618 preexistentes em `ThumbnailService`, 0 erros; Core 38, Architecture 8, Geometry 43, Data 56, Assets 33, Rendering 28 e Headless 49; **255 testes, 0 falhas**. `TestarLocal.bat rapido` também passou com o mesmo conjunto. `git diff --check` passou.

Commit do gate: `e3bed48` (`native: audit and compose wardrobe render layers`).
