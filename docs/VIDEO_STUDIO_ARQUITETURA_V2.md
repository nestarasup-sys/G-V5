# Video Studio V2 — arquitetura executável do Gacha Nymi V5

> **Fonte de decisão**: [PLANO_COMPLETO_VIDEO_STUDIO.md](./PLANO_COMPLETO_VIDEO_STUDIO.md).
> Este documento atualiza a implementação e a separação dos sistemas. As decisões de produto do plano original continuam vigentes quando não contrariadas expressamente aqui.

## 1. Contexto e contrato

O Studio normal, Fabricador, Customizador e os animadores anteriores **não são** a nova engine. Os animadores antigos de pose/rosto foram protótipos; não devem ser copiados como mecanismo temporal definitivo.

O Video Studio é uma nova área em `/video-studio`, com **biblioteca inicial de projetos** antes do editor, independente do Studio convencional. Um projeto inicia vazio, com dez minutos, 60 FPS, fundo sólido e faixas de texto. Seu diretório pertence apenas ao Video Studio, em `app.getPath('userData')/video-studios/video-<uuid>`.

A implementação inicial não deve alterar o JSON de um Studio normal ou dados de fornecedor do Fabricador/Customizador. Assets copiados por hash ao projeto são snapshots imutáveis de origem. Nenhum arquivo original deve ser sobrescrito.

## 2. Uma engine única, com canais separados

```text
FONTES DO G-V5
  ├── composição do Fabricador (futura ponte read-only/snapshot)
  ├── poses e parâmetros corporais (adapter versionado)
  ├── expressões e parâmetros faciais (adapter versionado)
  └── idle / blink / talk (modos / subestados faciais)
              │
         snapshot próprio
              ▼
VideoProject v1
  ├── canvas + scene: composição estática inicial
  ├── assets: cópias com hash sob o projeto
  ├── characterTracks: única autoridade temporal de personagem
  ├── textTracks: falas / pensamentos (texto sem visual state)
  └── saveMarkers: cortes globais de referência
              │
    evaluateVideoProject(project, frame/time)
       ├── PREVIEW
       └── EXPORT (quando implementado)
```

Idle/Blink/Talk **não** serão três engines ou três projetos de expressão concorrentes. São escolhas do canal facial junto de corpo/rosto. Um futuro playback automático de blink/talk deve operar como modificador de papel/temporização sobre o estado base, sem regravar expressões ou segmentos. O plano original contempla gravação manual desses modos por **Salvar frame**. Nessa primeira fase não se deve prometer blink/talk automático sem sprites/presets compatíveis efetivamente fornecidos.

**Não interpolar IDs** de pose/preset/modo como números. A duração de transição configurada inicialmente em 20 ms é metadado para o compositor oferecer crossfade de sprites estáveis; transições discretas não ganham morph falso. Canais numéricos futuros poderão ter interpolação por chave.

## 3. Contrato canônico V1

Arquivo: `src/shared/videoStudio.ts`. Campos:

- `schemaVersion: 1`; `frameRate: 60` por padrão.
- `durationFrames: 36000` (10 minutos a 60 FPS).
- `canvas`: pixels 1920x1080, cor e asset de fundo; geometria opcional de fundo importado de um Studio normal. `elements`: composição inicial independente, com coordenadas de tela em porcentagem (origem no centro).
- `assets`: cópias de PNG/JPG/WebP com deduplicação SHA-256, fora do JSON persistido.
- `characterTracks[].segments`: `id`, `startFrame`, `endFrameExclusive`, `state` e `transitionInMs`.
- `state`: `poseId`, `expressionId`, `faceMode` em `idle | blink | talk`.
- `textTracks`: faixas de `dialogue` e `thought`; início/fim por quadros, texto e referência opcional ao falante.
- `saveMarkers`: quadro e lista de tracks efetivamente alterados.

O estado visual vigente em cada quadro é o do segmento que contém o quadro. Um segmento sempre dura ao menos 1 frame; `endFrameExclusive` é exclusivo. Track de personagem inicia em zero e deve cobrir a duração total sem gaps/overlaps. Reordenar ou colapsar faixa não modifica o estado.

Para antecipar o adaptador G-V5, `poseId` e `expressionId` identificam snapshots versionados específicos do personagem, não caminhos globais que serão modificados posteriormente. O estado de personagem **não** deve ser confundido com um evento de fala.

## 4. Salvar frame / rascunho

1. O usuário pode alterar a preview de um personagem sem alterar seus segmentos.
2. O playback consulta somente a versão confirmada, não o rascunho.
3. **Salvar frame**, no quadro escolhido, compara rascunhos com o estado canônico.
4. Para cada personagem alterado: se o quadro está no meio do segmento, corta o segmento; a esquerda preserva o estado anterior; o da direita recebe o novo. Se o quadro coincide com um limite, atualiza aquele segmento.
5. Os outros personagens permanecem intocados.
6. Uma marca vertical global pode ser inserida mesmo que só um personagem seja alterado; registrar os IDs afetados.
7. Ao salvar de novo no mesmo quadro, atualizar o segmento/marker, sem criar boundary duplicado.
8. Undo/redo abrange gravação, ajustes, duração e textos.

O V4 usa o conceito de **edição de segmento inteiro** e divisão explícita. O Video Studio usa outro gesto deliberado: **gravação de um novo estado por Salvar frame**. Não misturar seus comportamentos automaticamente.

## 5. Controles de timeline

Régua + playhead frame-alinhado, zoom independente da duração, faixa por personagem, fala, pensamento, limite compartilhado redimensionável, locks e snaps. Duração de projeto controlada à parte e não pode truncar dados silenciosamente. Playback usa relógio `performance.now()`; amostragem export sempre `frame/FPS`, sem pular frame. A primeira implantação prioriza biblioteca + projeto/persistência + preview + tracks básicos; a timeline avançada vem em incrementos sem deslocar o modelo de dados.

## 6. Limites de responsabilidade e risco

- `electron/videoStudioStore.ts`: valida IPC, diretórios, escrita de assets e atomicidade do manifesto. Salvar em fila; não tocar em `studios/Studio Principal`.
- `src/shared/videoStudio.ts`: contrato serializável, tipos, versão e defaults.
- `src/renderer/src/features/videoStudio`: runtime e interface.
- `electron/preload.ts`: APIs estreitas, sem Node no renderer.
- `src/renderer/src/ui/App.tsx` e `TopBar.tsx`: única integração inicial com shell existente.
- Futuro adapter para personagens reais deve ler estados/poses/expressões do Fabricador, transformar em snapshot imutável no VideoProject e usar compositor unificado. Não importar diretamente componentes beta com mutações globais.

## 7. Status e fases

- [x] Arquitetura e modelo independente, nova persistência de projeto/asset.
- [x] Biblioteca navegável de projetos: criar, duplicar, abrir e excluir.
- [x] Preview inicial com importação de imagens de fundo, personagens PNG e objetos, seleção/arrasto/camada/inversão.
- [x] Importação **por cópia** de uma cena do Studio normal, incluindo geometria do fundo; personagens e assets passam a pertencer ao projeto de vídeo.
- [x] Timeline por frame com faixa por personagem, fala, pensamento, duração separada do zoom, playback/seek e fronteiras arrastáveis.
- [x] Gravação por **Salvar frame**, com rascunho separado, undo/redo e salvamento automático.
- [x] Crossfade de **20 ms entre sprites faciais discretos** na Preview quando há assets para os estados envolvidos (implementação inicial; falta validação visual de campo).
- [x] Testes determinísticos do runtime, typecheck e build em GitHub Actions na branch isolada.
- [ ] Adaptadores do renderer nativo do Fabricador: pose/preset facial como snapshots editáveis por personagem. Os IDs atuais são placeholders, sem aplicação visual.
- [ ] Blink/talk automáticos por fala/temporização (dependem de assets e regras definidas). Nesta fase os modos são escolhidos manualmente.
- [x] Movimentação e ajuste de início/fim de blocos de texto na timeline por gestos com snap em frames inteiros, respeitando locks e Undo.
- [ ] Smoke real no Windows dos gestos de blocos de texto, incluindo scroll/zoom em projetos longos.
- [ ] Smoke real de Electron no Windows com cenas pesadas, integração de presets e testes visuais.
- [ ] Export MP4 usando o MESMO avaliador de estado da Preview, com parity comprovada antes de otimizar.

**Regra de honestidade:** fases marcadas como pendentes não devem ser tratadas como implementadas só porque o schema reserva campos. Um modo facial sem asset compatível não representa animação funcional.

## 8. Validação obrigatória

`npm run typecheck` + `npm run build`, testes para resolução frame 0/último, corte e regravação no mesmo quadro, 1 frame, locks, undo/redo, projeto CRUD e segurança de asset. Smoke real de Electron é necessário para validar IPC e estado de biblioteca. Mais tarde: testes preview/export com pixel/paridade frame a frame e benchmarks reais. Não adotar cache/performance experimental do Editor V4 sem medição.

## 9. Registro de decisões

- O plano original é preservado como especificação e registro histórico: `PLANO_COMPLETO_VIDEO_STUDIO.md`.
- **Nunca** escrever em arquivos do Studio normal nem em presets fornecedores.
- **Nunca** usar dois resolvers visuais separados em preview/export.
- **Nunca** atribuir talk/blink automático a uma cena que não possui as variantes.
- **Nunca** apagar uma faixa ou cortar duração por efeito colateral de mudar zoom.
- **Nunca** duplicar um estado por personagem em metadados de faixa.

## 10. Implementação inicial consolidada (outubro/2026)

**Branch de trabalho exclusiva:** `oai/video-studio-v2` em `nestarasup-sys/G-V5`. A `master` recebeu avanços paralelos, mas esta branch é a linha isolada para novas alterações; não reescrever outras branches.

Arquivos implementados:
- `src/shared/videoStudio.ts`: tipos versionados, criador de projetos, modos faciais.
- `src/renderer/src/features/videoStudio/videoRuntime.ts`: avaliador determinístico, gravação, fronteiras, extensão/redução segura de duração.
- `src/renderer/src/features/videoStudio/VideoStudioPage.tsx`: biblioteca antes do editor, Preview, transporte, tracks, Inspector, importação read-only do Studio normal.
- `src/renderer/src/features/videoStudio/videoStudio.css`: layout independente do Studio normal.
- `electron/videoStudioStore.ts`: diretório nativo exclusivo, validação, manifesto atômico, imagens por hash, economia de regravação.
- `electron/main.ts` e `electron/preload.ts`: IPC seguro de lista/salva/remove/importa assets.
- `src/renderer/src/ui/App.tsx` e `TopBar.tsx`: rota lazy `/video-studio` e navegação.
- `scripts/test-video-studio.cjs`: testes regressivos sem nova dependência.
- `.github/workflows/video-studio-check.yml`: `typecheck`, testes e bundle Electron.

**Observação arquitetural:** o fluxo de importação do Studio normal cria cópias de imagens e estados base; não traz controle paramétrico de membros/rosto do Fabricador. Apenas elementos visuais suportados (personagem/imagem) passam à cena inicial. Elementos narrativos do Studio normal ainda aguardam adaptador e são informados ao usuário.

**Conferência:** o gate GitHub Actions dos commits `a5b36c0` e `64ce64f` foi concluído com sucesso (typecheck + testes + build). Isso não substitui smoke de UI/Electron real no Windows.

### Próxima prioridade técnica

1. Definir snapshots serializáveis de pose e expressão a partir do Fabricador e implementar adaptadores de leitura, sem reescrever catálogos originais.
2. Unificar imagem composta de personagem, variantes Idle/Blink/Talk e pose/expressão em um único compositor, com cache baseado em estado explícito e invalidação.
3. Testar gravação em segmentos sucessivos no projeto real; duração de 1 frame, boundary e crossfade são contratos inegociáveis.
4. Apenas depois construir export com captura frame a frame e paridade com a Preview. Benchmarks somente depois de corretude funcional.
