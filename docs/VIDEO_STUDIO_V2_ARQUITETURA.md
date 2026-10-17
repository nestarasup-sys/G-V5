# G-V5 — Video Studio V2: arquitetura operacional e plano de implementação

> **Status em 17/10/2026:** fundação implementada na branch `oai/video-studio-foundation`. Este documento complementa e **substitui as decisões técnicas conflitantes** de `docs/PLANO_COMPLETO_VIDEO_STUDIO.md`. O documento original continua preservado como fonte dos requisitos criativos e funcionais.

## 1. Missão

O Video Studio é um domínio novo dentro de Gacha Nymi, acessível na barra superior em **Video Studio**. Ao entrar, primeiro aparece uma **biblioteca própria de projetos**: criar projeto vazio, abrir, duplicar e excluir. Só após escolher um projeto entra no editor. Nunca abrir um editor já conectado automaticamente a um Studio normal.

O aplicativo atual usa Electron 44, React 19, TypeScript, electron-vite, renderer isolado de Node e IPC tipado por preload. A composição do Studio normal já possui `StudioDocument`, `StudioElement`, assets de fundo/objeto/personagem, pose, expressão, e os modos `Idle`, `Blink` e `Talk`. O animador Dev e o animador facial são **protótipos**, não contratos de engine imutáveis.

## 2. Regra estrutural que não pode ser quebrada

```
Studio normal + Fabricador + Customizador (fontes SOMENTE LEITURA)
        ↓ snapshots/adaptadores
VideoProject independente e versionado
        ├── scene (composição base e imagens próprias)
        ├── characterTracks (autoridade temporal da atuação)
        ├── textTracks (fala e pensamento)
        └── saveMarkers (cortes explícitos)
        ↓ avaliador de estado único
    Preview / futura exportação
```

Não escrever nos presets, desenhos, poses, olhos, boca, Studio normal, Customizador, Fabricador, ou animadores originais quando o usuário editar um Video Studio. Nunca depender de uma pasta externa que possa mudar depois que o projeto for salvo.

## 3. Modelo canônico inicial

Arquivo: `src/shared/videoStudio.ts`.

- `VideoProject.schemaVersion: 1`.
- `id` UUID, nome, timestamps, `frameRate` inicial 60 FPS, `durationFrames` inicial 36000 (10 minutos).
- `scene`: cópia independente de `StudioDocument` para aproveitar o formato de composição (não o arquivo original). No futuro poderemos substituí-la por um `VideoSceneSnapshot` menor sem misturar domínios.
- `characterTracks`: uma faixa por elemento-personagem, `segments` com `id/startFrame/endFrameExclusive/state/transitionInMs`.
- `VideoActorState`: `poseSlot`, `expressionPresetId`, `faceMode: idle|blink|talk`.
- `textTracks`: `dialogue` e `thought`; cada bloco guarda ID, início, fim e texto.
- `saveMarkers`: `frame` e IDs das faixas realmente gravadas.

**Invariantes**: frames inteiros, intervalos `[início, fim)`, mínimo de 1 quadro, segmentos contíguos e sem sobreposição, cobertura até `durationFrames`, IDs estáveis, edição em faixas bloqueadas impedida, e preservação das faixas não afetadas.

A interface mantém valores temporários de edição fora do documento. **Salvar frame** torna esses valores canônicos no quadro solicitado. Alterar o seletor de rosto ou pose sem gravar não muda a timeline armazenada. Gravar no frame zero altera o estado-base; gravar no interior de um segmento o divide e aplica o novo estado apenas à direita. A marca vertical é global, mas as alterações de estado são locais.

O formato v1 admite `transitionInMs:20`, porém esta é uma **especificação de composição futura**. Não declarar transição visual acabada enquanto o compositor de pose/rosto ainda não executar a fusão.

## 4. Idle / Blink / Talk

Os três modos existem como **estado facial discreto** no snapshot do personagem. Eles não são três motores concorrentes. A implementação final deve separar:

1. **Definição facial**: catálogo de olhos/boca/presets específicos do modelo; pareamento determinístico, IDs resolvidos por personagem e fallback validado.
2. **Estado autoral**: modo manual salvo na faixa; expressão/preset e pose.
3. **Modificadores automáticos**, numa fase posterior: timers de blink e atividade de fala capazes de selecionar o papel facial sem regravar pose/expressão.
4. **Composição**: resolver base + papel facial + transforms em um mesmo `SceneSnapshot` consumido por Preview e Export.

Não assumir IDs iguais em modelos diferentes. A boca aberta mantém ancoragem/rotação da boca fechada, preservando proporção própria. FallBack nunca regrava dados do catálogo de origem. Na primeira fase disponível, a timeline registra `faceMode` corretamente, mas **a imagem mostrada ainda é o bitmap já composto de origem**.

## 5. Persistência de projetos e assets

Arquivos: `electron/videoStudioPersistence.ts`, `electron/preload.ts`.

- Cada projeto é salvo em `app.getPath('userData')/video-studios/video-<uuid>/`.
- `project.json` é manifesto independente; imagens importadas ou copiadas do Studio são convertidas em arquivos na subpasta `assets/` de acordo com seu SHA-256 e extensão segura.
- O manifesto guarda `hash` em vez de `dataUrl`. O carregamento reidrata o `dataUrl` para o compositor existente, validando o hash dos bytes.
- Gravação do manifesto usa arquivo temporário e renomeação. Uma fila serializa salvar/excluir, e o quit aguarda as gravações.
- IPC só aceita IDs UUID e passa pela validação de origem do processo principal. Não há endpoint que aceite caminho arbitrário vindo do renderer.
- Não apagar os assets originais do Studio/Fabricador. Assets não usados remanescentes numa pasta de projeto podem ser limpos por coleta futura, nunca antecipadamente sem validação transacional.
- Auto-save com debounce e botão explícito de salvar na UI. Erros não podem ser escondidos.

## 6. UI implementada agora

`src/renderer/src/features/videoStudio/VideoStudioPage.tsx`:

- Landing/library antes da área de trabalho (novo, abrir, duplicar, excluir).
- Workspace independente com importar um snapshot do Studio normal, adicionar fundo e objeto/imagem, cor de fundo e manipulação numérica de elementos.
- Preview de composição base, com seleção de personagem/objeto e sobreposições de fala/pensamento.
- Seletor de pose, ID de expressão e modo facial em rascunho; gravar ou descartar alterações.
- Timeline: faixa por personagem, fala/pensamento, régua, playhead, zoom separado da duração, quadro anterior/próximo, play/pause, markers e alças compartilhadas dos segmentos.
- Undo/redo e salvamento. Biblioteca e persistência não reutilizam diretórios nem dados do Studio normal.

## 7. O que NÃO está pronto nesta rodada

Não confundir navegação/casca funcional e modelo temporal com engine de animação concluída:

- O renderer atual ainda exibe bitmaps compostos no Studio original. Alterar pose/expressão/faceMode grava corretamente o dado canônico, mas não recompõe automaticamente a figura na Preview.
- Adicionar personagens diretamente do catálogo do Customizador (sem importar composição existente) ainda exige um adaptador de composição.
- A nova engine facial precisa resolver olhos/Blink, bocas/Talk, efeitos de expressão, transformações e múltiplas peças por personagem sem alterar o fornecedor.
- Fusão de 20 ms, idle temporal automático, keyframes contínuos de corpo, animar câmera, áudio, exportação FFmpeg, testes reais de pixel-parity e performance do projeto longo ficam para fases próprias.
- Prévia por bitmap é deliberada até o compositor derivado do Studio estar desacoplado de seus efeitos colaterais.
- Integração com assets externos complexos e regeneração de sprites não foi presumida.

## 8. Próximas fases obrigatórias

### Fase A — adaptador de cena sem efeitos colaterais

Extrair do Studio normal a composição/renderização de personagem numa função ou componente independente: entrada = snapshot de personagem + pose + expressão + `faceMode`, saída = raster/camada. Nada deve salvar no Fabricador. Criar matrizes visuais para diferentes modelos, boca aberta, olho fechado, dimensões de boca e sprites duplicados. Guardar no projeto um snapshot efetivamente reprodutível.

### Fase B — avaliação temporal/render

Implementar `evaluateVideoScene(project,time)`: elemento estático + estado canônico no frame + transição de 20 ms + efeitos/blink/talk. Compartilhar **exatamente esse compositor** entre Preview e futura exportação; sem segundo algoritmo de pose/expressão. Validar `t=frame/fps`, 1-frame states, A→B→A intencional, seek/scrub, corte e limites compartilhados.

### Fase C — autoria completa

Criar elenco diretamente do Customizador, snapshots de pose/expressão do catálogo, efeitos faciais, edição contextual visual, bloqueio/visibilidade por faixa, reorganização, text blocks com resize/drag, atalhos, autosave/recovery, histórico longo e redução protegida de duração.

### Fase D — exportação

Só iniciar após paridade visual: aproveitar fundamentos V4 (offscreen Chromium, clock exato, render plan, captura sincronizada, FFmpeg e diagnóstico) por módulo adaptado; nunca transportar cegamente código de Turbo nem usar dois compositores. Benchmark de 10 segundos, 90 segundos do meio e caso longo com 60 FPS em hardware do usuário.

## 9. Aceite imediato da fundação

- Navegação na topbar mostra Video Studio e abre biblioteca, não timeline automaticamente.
- Criar/abrir/duplicar/excluir funcionam sem afetar Studios normais.
- Criar projeto vazio gera exatamente 10 minutos / 60 FPS.
- Importar snapshot de Studio preserva composição e copia mídia para assets do novo projeto.
- `Salvar frame` registra somente personagens cujo draft difere do estado canônico. 1 frame continua válido; bloqueio impede escrita.
- Playback/seek avaliam a mesma faixa por quadro.
- Manifesto salva e reabre sem dependência de caminhos do Studio de origem.
- **Critérios de aceitação de render/animação ainda ficam pendentes até a Fase A/B.**

## 10. Check de integração

No clone de G-V5, branch `oai/video-studio-foundation`:

```bash
npm ci
npm run typecheck
npm run build
npm run dev
```

Validar manualmente: entrada na biblioteca, projeto vazio, importar Studio, timeline 60 FPS, `Salvar frame`, persistência após reabrir, assets imutáveis, excluir/duplicar, e verificar se o Studio normal permanece idêntico. Registrar falhas reais antes de promover o trabalho a `master`.

## 11. Fontes consultadas

- Markdown fornecido pelo usuário: `PLANO_COMPLETO_VIDEO_STUDIO.md` (requisitos originais, modos faciais e plano).
- G-V5: `src/shared/studio.ts`, `src/renderer/src/features/studio/StudioPage.tsx`, `electron/main.ts`, `electron/preload.ts`, `src/renderer/src/ui/App.tsx`, `TopBar.tsx`.
- Editor V4, branch `oai/aggressive-export-v5`: `docs/VISUAL_TIMELINE_V2.md`, `characterTrackState.ts`, `canonicalCharacterTracks.ts`, `timelineTracks.ts`, `resolveScene.ts`, `SceneSurface.tsx`.

### Princípio permanente

**Não sacrificar o Studio original, os assets de origem ou a identidade temporal dos segmentos em nome de atalhos de UI.** Primeiro correção/paridade, depois velocidade.
