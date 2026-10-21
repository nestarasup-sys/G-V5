# F07.01 — Inventário de rig, juntas, anchors e sourceTransform no Gacha 5 Electron

**Estado:** inspeção estática concluída em 2026-10-21; não foi feita execução Electron, teste Windows ou compilação C# nesta revisão.  
**Propósito:** orientar a implementação nativa F07.02–F07.11 sem antecipar a GUI do Video Studio e sem copiar lógica de View para domínio.

## Fontes do Gacha 5 consultadas

- src/shared/fabricator.ts, linhas 1–52: JointLink, ModelPart e FabricatorProject.
- src/renderer/src/features/fabricator/models/rig.ts, linhas 5–173: createJoint, normalizePartAnchors, partJointAnchor, sourcePointFromCanvas, autoConnectParts, normalizeLayerOrder e reorderLayer.
- src/renderer/src/features/fabricator/FabricatorPage.tsx, linhas 655–746 e 941–969: conexão manual, fixar, arrastar, rotacionar e reposicionar anchors.
- src/renderer/src/features/fabricator/PoseWorkspace.tsx, linhas 28–111, 438–491 e 684–709: fixedPoseBranch, movimentos/rotação de pose, lista de joints e restrições.
- src/renderer/src/features/fabricator/AnimatorWorkspace.tsx: aplicação de transforms por frame, fixed children e diagnóstico de juntas.
- master avalonia/src/GV5.Geometry/RigSkeleton.cs: verificação de consistência/árvore nativa já disponível.
- master avalonia/docs/legacy-contracts/FABRICADOR_INVENTARIO.md: inventário macro anterior.

Os caminhos externos a master avalonia foram examinados **somente para leitura**, sem modificação nem acesso a dados pessoais.

## Contratos e significados

| Campo/estrutura | Comportamento real observado | Preservação no Avalonia |
| --- | --- | --- |
| JointLink.id | string gerada por crypto.randomUUID no createJoint | RigJointId tipado e persistência estável, sem depender do índice de lista |
| parentPartId / childPartId | conexão orientada pai → filho | validar endpoints existentes, sem auto-ligação, ciclo ou segundo pai |
| parentAnchor / childAnchor | posições em coordenadas do canvas montado; edgePoint sugere borda voltada para outra peça | coordenada tipada; manter consistência de referencial e pivô na edição |
| pivot? | opcional; fallback é média dos dois anchors | não destruir pivô explícito; reconstituir fallback apenas quando ausente |
| fixed? | true: arrastar peça-pai acompanha todos os descendentes ligados por juntas fixas; false: peça pode se mover isoladamente | Fixed/Loose no domínio, sem snap ao alternar estado |
| suggested? | true quando autoConnectParts escolheu conexão; false/ausente quando criada manualmente | metadado IsSuggested; editor deve permitir revisão/correção |
| ModelPart.jointAnchor? | pivô da peça em coordenadas do canvas; partJointAnchor prioriza valor explícito, depois o primeiro joint ou o centro | preservar anchors existentes e fallback sem modificar bitmap |
| ModelPart.sourceTransform? | geometria imutável da peça na folha desmontada: x, y, width, height, rotation, jointAnchor, anchorVersion | criar campo persistente separado da pose; mudanças de rig/pose não o sobrescrevem |
| project.layerOrder | render back-to-front independente do grafo de joints | jamais confundir z-order com parentesco/rotacionar hierarquia |

## Regras geométricas e de edição verificadas

1. **Criação manual:** clicar uma peça no modo conectar escolhe o pai; clicar outra escolhe o filho. createJoint escolhe jointAnchor da peça quando presente; caso contrário calcula encontro com borda pela direção entre centros, gera id e pivô médio. A página atualiza jointAnchor das peças e a lista de juntas. Na reconstrução, **não reproduzir a fragilidade** de permitir ciclos/múltiplos pais: RigSkeleton.Create já rejeita esses casos.
2. **Normalização:** normalizePartAnchors cria mapa inicialmente com pivôs declarados, usa anchors das juntas para peças ainda sem pivô e centro da peça como último fallback. Reescreve os anchors das juntas para os pivôs canônicos e recalcula pivô médio.
3. **Movimento fixo:** FabricatorPage/updatePartPosition e PoseWorkspace/fixedPoseBranch percorrem transitivamente filhos somente por arestas fixed; o gesto desloca x/y e jointAnchor das peças afetadas, mais anchors incidentes. Alterar fixed de uma junta não provoca snap nem deslocamento imediato, preservando sobreposições intencionais.
4. **Rotação de ramo no editor Modelos:** rotateBranch coleta *todos* os descendentes da junta selecionada (inclusive loose nesse fluxo), usa o pivô da junta e rotaciona centros, rotações das peças e anchors relevantes. **Na ferramenta de pose**, rotateSelected pode operar em modo só peça ou peça+conectadas: neste segundo caso segue apenas arestas fixed. Estas semânticas são diferentes por contexto, não devem ser fundidas sem verificar intenção da ferramenta.
5. **Pivô de pose:** PoseWorkspace privilegia jointAnchor da peça; fallback é o centro; cabeça e tronco não podem ser movidos pela ferramenta específica de coordenadas de pose (não equivale a proibir toda transformação nesses ossos).
6. **Reassociação de pivô à imagem importada:** sourcePointFromCanvas inverte a rotação atual em torno do centro e aplica escala por proporção entre tamanho atual/original, então a rotação da fonte e a translação ao centro de sourceTransform. Ao arrastar pivô no canvas, grava jointAnchor atual e, quando possível, sourceTransform.jointAnchor e anchorVersion=1. Verificar dimensões zero e campos ausentes no parser nativo.
7. **Heurística automática:** autoConnectParts identifica torso por nome /tronco|corpo/i ou por posição/área, cabeça por /cabeça|cabeca/i ou peça acima mais alinhada; divide outros segmentos em lados e braços/pernas por posição na folha, encadeia segmentos verticalmente e associa sobras à peça conectada mais próxima usando distância normalizada por dimensões totais. Previne usar o mesmo child duas vezes. É sugestão, não regra anatômica obrigatória.
8. **Camadas:** normalizeLayerOrder remove IDs inválidos/duplicados e completa IDs não listados. reorderedParts mantém ordem de desenho de trás para frente; reorderLayer altera só a lista, sem modificar joints.
9. **Persistência:** FabricatorProject carrega joints e peças; PoseWorkspace copia dados do modelo com sourceTransform e joints (sem mutar fonte); Animador aplica transforms por frame e trabalha com mesmas referências. IDs/revisões do novo projeto devem evitar atualizações silenciosas de dados publicados.

## Correspondência com código nativo existente

- GV5.Geometry.RigSkeleton.Create já verifica IDs não vazios, referências válidas, pais únicos, ausência de auto-parent/ciclos e modo Loose/Fixed.
- GV5.Geometry.RigSkeleton.EvaluateWorldMatrices já calcula transforms por hierarquia parent-first; não é editor de criação/remoção e **não equivale ao movimento em coordenadas absolutas do Electron**. Adaptar comandos/editor sem quebrar convenções de transform do novo motor.
- GV5.Geometry.WardrobeBinding existente não deve ser acoplado à UI de rig; roupas serão fase F08.
- F06 já tem ModelDraftContent persistido, Canvas e Undo/Redo de transform de peças. F07 deve estender o domínio/serviços, preservando revisão otimista, sourceTransform, layer order e arquitetura.

## Casos necessários nas próximas tarefas

- Criar, editar, excluir uma junta e desfazer/refazer; nenhuma alteração de fonte publicada.
- Rejeitar auto-junta, id duplicado, parent/child não encontrado, segundo pai e ciclo (incluindo A→B→C→A).
- Alternar Loose↔Fixed sem salto visual nem alteração de coordenadas.
- Mover pai fixado e verificar descendentes a vários níveis; mover pai loose e verificar filhos independentes.
- Diferenciar rotação de toda subárvore na aba Modelos e rotação de apenas filhos fixed no editor de pose.
- Arrastar jointAnchor e assegurar mapeamento para sourceTransform sem escrever imagem fonte.
- Verificar que reordenar camadas não altera parentesco; salvar/reabrir e comparar conteúdo/IDs/poses.
- Criar modelo sintético com torso, cabeça, dois braços em níveis e casos de pivô extremo.
- Verificar rejeição de NaN/Infinity, cancelamento e não gravação SQLite por mousemove.

## Pendências explicitamente não resolvidas em F07.01

- Captura visual real e interação Windows do legado/novo.
- Comparação de pixels com folha real.
- Escolha da API de edição de joints e da View Avalonia (F07.02–F07.04).
- Contratos de pose pinados ao modelo (F07.05); persistência de pose/animação e revisões (F07.07–F07.11).

**Conclusão F07.01:** contratos e diferenças de comportamento entre Modelo, Pose e Animador inventariados por leitura direta; F07.02 pode implementar criação/edição/remoção com testes sem redesign e sem gate estético pixel-perfect.
