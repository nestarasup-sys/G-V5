# Contrato de animação corporal do Fabricador

Estado: F07.09–F07.12 validadas tecnicamente; editor, prévia, playback básico e persistência SQLite implementados. Paridade completa do Animador legado permanece parcial conforme `docs/legacy-contracts/F07_ANIMACAO_PENDENCIAS.md`.

## Identidade e origem

- `AnimationDraft` possui ID tipado e estável, schema 1 e revisão editável monotônica.
- A animação é pinada por `ModelRevisionReference` a uma publicação imutável exata do modelo.
- A pose-base é opcional e referenciada por `PoseId`; criar uma animação a partir de `PoseDraft` copia seu conteúdo para o primeiro frame. Alterar a animação nunca altera a pose-base.
- A animação tem nome, easing, modo de loop e velocidade de reprodução.

## Frames e keys

- Uma animação contém de 1 a 300 frames ordenados.
- Cada frame tem um `AnimationFrameId` estável e duração própria entre 40 ms e 10.000 ms; a duração total é a soma dos frames.
- Cada frame tem exatamente uma `AnimationPartKey` para cada peça animada. A key guarda `ModelPartId`, `Transform2D` e visibilidade.
- A animação mantém uma ordem de camadas completa e estável, herdada da pose-base ao iniciar por uma pose.
- Keys de transform exigem identidade válida, valores finitos e escala positiva.
- Cada frame guarda o snapshot do rig com IDs, relações pai/filho, anchors e modo das juntas. IDs e ligações do rig permanecem constantes na animação; anchors e modos podem variar ao longo dos frames.
- O grafo de cada frame é validado pelo `RigSkeleton` canônico. Juntas órfãs, duplicadas, cíclicas ou com múltiplos pais são recusadas.

## Interpolação e reprodução

- `AnimationEasing`: `Step`, `Linear` ou `Smooth`. `Smooth` corresponde à suavização smoothstep que o Animador legado usa para a interpolação suave; `Step` corresponde ao modo em etapas do legado.
- `AnimationLoopMode`: `Once`, `Loop` ou `PingPong`, cobrindo os três modos existentes no legado.
- A velocidade é finita e limitada a 0,1–4,0×, conforme o validador legado.
- Rotação, avaliação temporal e playback são responsabilidades da engine de animação da aplicação, fora de Avalonia. `AnimationEvaluator` implementa interpolação de transforms/anchors e os modos Once/Loop/PingPong; a view Avalonia expõe reprodução/pausa sem mover essas regras para a UI.

## Limites e compatibilidade

Os limites observados no validador Electron foram preservados para quantidade de frames, duração e velocidade. O legado guarda transforms por ID de peça e snapshots de juntas por frame; este contrato converte essas relações para IDs tipados e prende o documento a uma publicação exata do modelo. `schemaVersion: 1`, slot numérico, miniaturas e `characterId` legado não são identidade nem dependências do domínio novo. A persistência SQLite/asset store será definida e testada nas tarefas de animação correspondentes, sem copiar o manifesto JSON do Electron.

## Evidência e escopo

Referências lidas: `docs/legacy-contracts/FABRICADOR_INVENTARIO.md`, `docs/legacy-contracts/FORMATOS_E_IDS_ELECTRON.md`, `../../../src/shared/fabricator.ts` (`AnimatorFrame`/`AnimatorAnimation`), `../../../electron/main.ts` (`validateAnimatorDocument`) e `../../../src/renderer/src/features/fabricator/AnimatorWorkspace.tsx` (`interpolateFrames`). O legado foi consultado somente para leitura.

O contrato está em `GV5.Core` e depende apenas de Core/Geometry. F07.10 implementou edição, prévia, playback e persistência; F07.11 provou pose→animação→reabertura e casos geométricos extremos. O gate técnico F07 passou. Slots nomeados do legado, miniaturas, `characterId` e demais diferenças de workflow seguem abertas para F09.13/G2; consultar o inventário de pendências antes de declarar paridade funcional completa.
