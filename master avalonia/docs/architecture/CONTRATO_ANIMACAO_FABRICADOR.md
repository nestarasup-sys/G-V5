# Contrato de animação corporal do Fabricador

Estado: F07.09–F07.12 validadas tecnicamente; editor, prévia, playback básico e persistência SQLite implementados. Paridade completa do Animador legado permanece parcial conforme `docs/legacy-contracts/F07_ANIMACAO_PENDENCIAS.md`.

## Identidade e origem

- `AnimationDraft` possui ID tipado e estável, schema 1 e revisão editável monotônica.
- A animação é pinada por `ModelRevisionReference` a uma publicação imutável exata do modelo.
- A pose-base é opcional e referenciada por `PoseId`; criar uma animação a partir de `PoseDraft` copia seu conteúdo para o primeiro frame. Alterar a animação nunca altera a pose-base.
- A animação tem nome, easing, modo de loop e velocidade de reprodução.
- Até 12 slots numerados são estáveis por `ModelId`, atravessando novas revisões. Um slot aponta para um `AnimationId`; o snapshot conserva sua revisão de modelo exata. Liberar/substituir o slot nunca apaga automaticamente o rascunho anterior.
- A migration 17 associa deterministicamente os primeiros 12 rascunhos já existentes de cada modelo. Rascunhos excedentes continuam disponíveis na biblioteca sem ocupar slot.

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

## Miniaturas e personagem

- A miniatura de slot é derivada do primeiro frame pelo renderer compartilhado e pela publicação exata do modelo. É gerada sob demanda ao abrir um slot, refeita depois de salvar e guardada somente em memória; o cache elimina entradas antigas e nunca excede 12 bitmaps.
- `characterId` não faz parte de `AnimationDraft`. No legado, identifica o personagem de contexto do editor/prévia, enquanto os frames permanecem vinculados ao modelo. A restauração de personagem é adiada até existir serviço persistente/`CharacterResolver` consumível pelo Fabricador; o contrato e a fronteira estão registrados em `ADR-0007`.

## Limites e compatibilidade

Os limites observados no validador Electron foram preservados para quantidade de frames, duração e velocidade. O legado guarda transforms por ID de peça e snapshots de juntas por frame; este contrato converte essas relações para IDs tipados e prende o documento a uma publicação exata do modelo. `schemaVersion: 1`, miniaturas e `characterId` legado não são identidade do documento. Slots foram mantidos como associação própria persistida, sem copiar o manifesto JSON do Electron.

## Evidência e escopo

Referências lidas: `docs/legacy-contracts/FABRICADOR_INVENTARIO.md`, `docs/legacy-contracts/FORMATOS_E_IDS_ELECTRON.md`, `../../../src/shared/fabricator.ts` (`AnimatorFrame`/`AnimatorAnimation`), `../../../electron/main.ts` (`validateAnimatorDocument`) e `../../../src/renderer/src/features/fabricator/AnimatorWorkspace.tsx` (`interpolateFrames`). O legado foi consultado somente para leitura.

O contrato está em `GV5.Core` e depende apenas de Core/Geometry. F07.10 implementou edição, prévia, playback e persistência; F07.11 provou pose→animação→reabertura e casos geométricos extremos. Slots e miniaturas foram completados em F09.13. O gate técnico F07 passou. Contexto de personagem, validação Windows/GPU e paridade visual seguem pendentes conforme `F07_ANIMACAO_PENDENCIAS.md`; não declarar paridade completa antes desses aceites.
