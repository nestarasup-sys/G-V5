# Plano completo — Video Studio

> **Implementação iniciada — 17/10/2026:** o plano operacional atualizado está em [VIDEO_STUDIO_V2_ARQUITETURA.md](./VIDEO_STUDIO_V2_ARQUITETURA.md). Este documento é preservado como referência dos requisitos originais. Em conflitos de implementação, o documento V2 prevalece, e itens ainda pendentes não devem ser anunciados como implementados.

## 1. Visão da área

O **Video Studio** será uma nova área acessível pela barra superior principal, ao lado das áreas existentes. Sua entrada visual e seu espaço de trabalho partirão do Studio atual: cenário, personagens, objetos, preview e painel de edição continuam familiares. A diferença é que o Video Studio terá um projeto próprio, com tempo, faixas, cortes de estado, reprodução e exportação de vídeo. Um projeto novo abre com dez minutos de duração, ajustáveis pelos controles de duração da timeline.

A primeira versão começa com um projeto vazio e deve permitir montar uma cena, salvar o estado inicial como primeiro quadro, avançar o indicador de tempo, alterar pose ou expressão de um personagem e gravar novos estados. As alterações feitas pelos controles aparecem na preview antes de serem gravadas. Ao reproduzir, o editor combina esses estados ao longo do tempo para formar a animação.

### Decisões já confirmadas

- Novo projeto começa **em branco** e usa as funções de composição do Studio.
- A duração inicial é **10 minutos**. Cada faixa de personagem cobre esse período; o alcance temporal tem controles próprios para aumentar/diminuir.
- Pose e preset de expressão só são gravados ao clicar em **Salvar frame**. Antes disso, são alterações de preview.
- Salvar frame mostra um corte vertical sincronizado em todas as faixas; só grava um novo segmento nas faixas realmente alteradas.
- A transição de um estado para outro dura **20 ms** (por exemplo, Normal → Surpreso).
- As faixas de fala e pensamento guardam **somente texto**.
- Os assets necessários são **copiados para a pasta do projeto**.
- A animação será criada manualmente gravando frames. Exportação não é requisito inicial, mas deve ter arquitetura pronta para render rápido e saída MP4 (direta ou por conversão).
- Os canais animáveis iniciais são **pose e preset de expressão**; o restante da composição fica definido no primeiro frame.

## 2. Princípios de estrutura

- **Projeto de vídeo independente:** criar um modelo `VideoProject` versionado; não guardar a timeline dentro de `StudioDocument` nem alterar o Studio original.
- **Projeto começa em branco:** o usuário adiciona cenário, personagens e objetos usando as funções do Studio. A cena construída pertence ao Video Studio desde o início.
- **Estado por personagem e por tempo:** cada personagem tem uma faixa visual contínua dividida em segmentos de estado. Salvar uma mudança cria um corte no instante atual; só os personagens alterados recebem um novo estado.
- **Dados canônicos únicos:** faixas organizam e editam dados, mas não mantêm uma segunda cópia concorrente dos mesmos valores animados.
- **Preview e exportação coerentes:** a mesma avaliação da cena em um instante de tempo deve alimentar a preview e o render final.
- **Edição não destrutiva:** mudanças de pose e preset de expressão aparecem na preview, mas só entram na sequência ao pressionar **Salvar frame**.
- **Assets empacotados no projeto:** copiar para a pasta do projeto os arquivos necessários para renderizar cenário, personagens, poses e presets usados; não depender de caminhos soltos no computador.
- **Compatibilidade por adaptadores:** reaproveitar componentes e regras existentes sem fazer o Video Studio depender dos formatos internos de tela dos animadores.

## 3. Layout inicial

### Barra superior principal

Adicionar a entrada **Video Studio** junto às demais áreas. Ela abre o espaço de trabalho do editor e mantém a navegação principal existente.

### Área de trabalho

- **Topo:** nome do projeto, salvar/estado de salvamento, desfazer/refazer, controles de reprodução e ações de exportação.
- **Centro:** preview da cena, com seleção de personagem/objeto e edição contextual familiar ao Studio.
- **Painel lateral:** propriedades do item selecionado. Em personagens, incluir controles já oferecidos pelo Studio e acesso a pose e expressão.
- **Abaixo da preview:** timeline completa, redimensionável verticalmente, com régua, playhead, controles de zoom e faixas.
- **Adaptação de janela:** permitir recolher/redimensionar painéis e timeline sem deixar a preview inutilizável em telas menores.

## 4. Modelo de projeto proposto

Formato conceitual inicial (campos sujeitos ao modelo real do Studio e à revisão técnica antes da implementação):

```ts
type VideoProject = {
  schemaVersion: number
  id: string
  name: string
  frameRate: number // padrão inicial: 60 FPS
  durationFrames: number // começa em 10 minutos e muda pelos controles de duração
  canvas: { width: number; height: number; backgroundColor: string }
  scene: VideoSceneSnapshot // composição montada no Video Studio; fundo estático na primeira versão
  assets: VideoProjectAsset[] // arquivos copiados para a pasta do projeto
  characterTracks: CharacterVisualTrack[]
  textTracks: TextTrack[] // fala e pensamento, somente texto
  saveMarkers: FrameSaveMarker[] // cortes verticais sincronizados desenhados sobre as faixas
  createdAt: string
  updatedAt: string
}

type TrackMetadata = {
  id: string
  name: string
  order: number
  visible: boolean
  locked: boolean
  collapsed: boolean
}

type CharacterVisualTrack = TrackMetadata & {
  kind: 'character'
  characterId: string
  segments: CharacterStateSegment[]
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type SerializablePoseState = { [key: string]: JsonValue }
type SerializableExpressionPreset = { [key: string]: JsonValue }

type CharacterStateSegment = {
  id: string
  startFrame: number
  endFrameExclusive: number
  state: {
    pose: { sourceId: string; snapshot: SerializablePoseState }
    expression: { sourceId: string; snapshot: SerializableExpressionPreset }
    faceMode: 'idle' | 'blink' | 'talk'
  }
  transitionInMs: 20
}

type TextTrack = TrackMetadata & {
  kind: 'dialogue' | 'thought'
  clips: TextClip[]
}

type TextClip = {
  id: string
  startFrame: number
  endFrameExclusive: number
  text: string
}

type FrameSaveMarker = {
  frame: number
  affectedTrackIds: string[]
}

type VideoProjectAsset = {
  id: string
  sourceHash: string
  projectRelativePath: string
  mediaType: string
}
```

O modelo segue a separação comprovada do V4: metadados da faixa são distintos do conteúdo animado, e uma faixa de personagem é a fonte canônica de seus estados ao longo do tempo. Cada personagem começa com um segmento-base que cobre a duração atual do projeto; um personagem adicionado recebe uma faixa que cobre todo o alcance, inicialmente dez minutos. Os intervalos usam quadros inteiros e fim exclusivo, alinhados ao FPS. `transitionInMs` descreve os 20 ms de chegada ao estado do segmento; o runtime precisa preservar a duração em milissegundos e amostrar o resultado no relógio contínuo da preview e na grade de frames da exportação.

O estado animável inicial contém pose e preset de expressão. A composição e o fundo são montados antes do primeiro frame e permanecem estáticos nesta primeira etapa. Fala e pensamento usam faixas próprias com blocos contendo somente texto e duração. Áudio e câmera ficam fora do escopo inicial.

## 5. Fluxo principal de uso

1. Abrir **Video Studio** e criar um projeto vazio.
2. Montar cenário, personagens e objetos na preview. Ajustar o fundo antes da gravação inicial.
3. A timeline abre com dez minutos. Os controles dedicados de duração aumentam ou diminuem o alcance do projeto; o zoom horizontal tem controles separados.
4. Posicionar o playhead no início e usar **Salvar frame**. Esse primeiro registro captura os valores-base dos personagens e estabelece a cena estática.
5. Avançar o playhead. Selecionar um personagem e alterar sua pose e/ou preset de expressão. Essas escolhas aparecem na preview, mas ainda não foram gravadas.
6. Usar **Salvar frame**. O editor desenha uma marca de corte vertical alinhada ao playhead em todas as faixas e cria segmentos/estados novos apenas nas faixas de personagens alteradas. Faixas sem mudança continuam com o mesmo estado e não ganham cópias redundantes.
7. Repetir em outros tempos e personagens. A faixa do personagem mostra os segmentos e cortes que determinam seus estados.
8. Usar **Play/Pause**, mover o playhead e revisar a sequência.
9. Salvar o projeto e exportar quando essa etapa for implementada.

O comando **Salvar frame** funciona como uma operação explícita de corte/gravação. A linha do corte atravessa visualmente todas as faixas para dar uma referência temporal comum. Nas faixas dos personagens alterados, o segmento atual termina no quadro do playhead e um novo começa ali com a pose e expressão visíveis na preview; os outros personagens mantêm segmentos contínuos e seus estados. Um novo personagem recebe uma faixa cobrindo a duração atual do projeto. Se já existe uma mudança no mesmo quadro, salvar novamente atualiza o estado daquele quadro em vez de criar um segmento duplicado. O marcador registra quais faixas foram gravadas naquele instante para seleção, undo/redo e indicação visual.

## 6. Comportamento da timeline

### Faixas da primeira fase

- Uma faixa por personagem, nomeada e identificável visualmente, como no Editor V4.
- Faixas próprias para texto de fala e texto de pensamento.
- Sem faixa animada de fundo na primeira versão; o fundo é definido antes de **Salvar frame** inicial e permanece estático.

As faixas de personagem são blocos de estado contínuos. Um divisor compartilhado entre estados adjacentes pode ser arrastado para aumentar um segmento e diminuir o outro, respeitando o mínimo de um quadro. Selecionar um segmento move o playhead para dentro dele e seleciona o personagem correspondente. O botão **Salvar frame** é a ação explícita de criar o novo limite de estado; não dividir automaticamente ao mexer nos controles da preview.

Os blocos de fala e pensamento têm alças nas bordas para alterar duração e podem ser arrastados no tempo. Seus dados contêm apenas texto, início e fim. Os controles relevantes de faixa incluem nome, ordem, visibilidade, bloqueio e recolhimento; faixas bloqueadas não aceitam edição. O projeto mantém uma faixa única por personagem, sem duplicar o estado do personagem em metadados da faixa.

O limite total de dez minutos é independente do zoom. Os controles de duração alteram `durationFrames` em passos definidos na implementação. Aumentar o alcance prolonga o último segmento de cada personagem mantendo seu estado. Diminuir não pode apagar dados silenciosamente: se houver conteúdo além do novo limite, impedir a redução ou pedir uma decisão explícita antes de cortar.

### Régua e navegação

- Régua e indicador de reprodução com leitura de tempo/quadros, começando em dez minutos; o projeto usa uma grade canônica de quadros no FPS escolhido.
- Controles separados de **duração total** e **zoom horizontal**. Aumentar o zoom mostra menos tempo; aumentar a duração do projeto estende a faixa temporal.
- Botões `− / +`, slider e **Fit** para zoom horizontal; o zoom não muda duração nem desloca keyframes. Scroll horizontal e snap facilitam navegar e posicionar cortes.
- Alças de segmento para deslocar o limite compartilhado entre dois estados; alças de bloco para redimensionar a duração dos textos.
- Selecionar um segmento ou bloco destaca seu alvo e posiciona o playhead no instante clicado.
- Faixas podem ser reordenadas, recolhidas, ocultadas e bloqueadas sem apagar seu conteúdo.
- Salvar frame desenha uma linha/corte global no playhead, embora grave estados apenas nas faixas afetadas.

### Troca entre estados

Cada alteração salva tem uma transição de **20 ms** entre o estado anterior e o novo — por exemplo, de Normal para Surpreso. A avaliação pode usar subquadros durante a preview para executar essa transição curta; a exportação amostra nos quadros inteiros do FPS e pode representar 20 ms com um ou poucos quadros, conforme o FPS e o alinhamento do corte. Para troca de sprites/estados discretos, usar uma fusão visual curta entre os dois estados em vez de afirmar que as imagens foram morfadas; valores realmente contínuos podem interpolar diretamente. Essa duração é fixa em 20 ms na primeira versão, sem seletor 0/20 ms.

## 7. Pesquisa de campo — Editor V4

A pesquisa foi feita no checkout indicado pelo usuário: `C:\TRABALHO 2\EDITOR V4\EDITOR V4`, branch local observada `oai/aggressive-export-v5`. A timeline atual separa três coisas que a interface pode mostrar lado a lado, mas que não devem virar cópias concorrentes dos mesmos dados:

1. **Conteúdo temporal** (`timeline[]`): eventos de fala, pensamento, mídia e outros conteúdos com início e duração.
2. **Aparência canônica dos personagens** (`character_tracks`): segmentos contínuos por personagem, com pose, expressão, variante, visibilidade e transformação.
3. **Metadados visuais das faixas** (`timeline_tracks`): nome, ordem, visibilidade, bloqueio e recolhimento. Essa camada organiza as faixas e não guarda a aparência animada.

### Modelo de faixa visual

No V4, `CharacterTrackSegment` guarda `id`, `start_frame`, `end_frame` e `state`; o começo é inclusivo e o fim é exclusivo. O projeto declara a versão canônica (`character_tracks_version: 1`) e a preview/export leem dessa mesma autoridade. `normalizeCharacterTracks` fecha lacunas e corrige sobreposições mantendo continuidade. O compilador estende o último segmento até o final do conteúdo temporal ou do próprio track.

Ao dividir, o V4 copia o estado para os dois lados do limite: não há salto visual até o usuário editar o trecho novo. A borda compartilhada entre segmentos pode ser arrastada, aumentando um lado e encurtando o outro, com mínimo de um frame. Clicar em um segmento seleciona o personagem, o estado e o playhead naquele ponto. A mudança de pose/expressão no Inspector edita o segmento selecionado; divisão é uma ação explícita, não ocorre automaticamente a cada alteração.

### Faixas de conteúdo e ferramentas

- `timeline[]` contém eventos; associação às lanes é inferida pelo tipo (fala, pensamento etc.), com `track_id` explícito para faixas personalizadas. Fala e pensamento são lanes próprias.
- Os blocos de evento podem ser movidos e redimensionados pelas bordas. O menu contextual oferece ações como duplicar, dividir e excluir.
- A toolbar oferece criação rápida de fala, corte e pausa; o Video Studio deve reaproveitar somente os comandos que correspondem ao seu modelo de animação.
- Um menu de faixas permite adicionar faixa de conteúdo, renomear, reordenar, mostrar/ocultar, recolher/expandir, bloquear/desbloquear e remover faixas personalizadas. Visibilidade e bloqueio são distintos: ocultar não apaga o dado; bloquear impede edição.
- O projeto persiste metadados de faixas com `timeline_tracks_version: 1`; faixas canônicas de personagem são geradas a partir dos personagens do projeto e guardam apenas metadados.

### Duração, zoom e navegação

O V4 não tem um botão `+ / −` para alterar a duração total do projeto. O que existe na toolbar são `− / +`, slider e **Fit** para alterar zoom horizontal (pixels por segundo); a duração resolvida vem do maior fim de evento/comentário e do alcance das faixas visuais, com uma extensão mínima para exibição. Isso é diferente de redimensionar um bloco de fala ou mover um divisor entre estados.

Também existem régua clicável/arrastável para mover o playhead, edição direta do timecode, snap configurável, zoom ancorado no cursor, rolagem horizontal, seguimento automático do playhead e controles para reduzir a altura da timeline. Atalhos incluem espaço para play/pause, Home/End para início/fim, setas para avançar quadro e `+ / −` para zoom. Preferências de zoom, snap, densidade e layout são guardadas localmente; conteúdo de timeline pertence ao arquivo do projeto.

### Reprodução, edição e salvamento

- Playback deriva o tempo de `performance.now()` e da taxa de reprodução; não acumula erro somando um delta a cada atualização de tela.
- A preview consulta a cena no playhead. O export usa a mesma resolução visual e amostra cada frame na grade `frame / FPS`, aguardando a cena e mídia estarem prontas antes da captura.
- Edições passam pelo store de projeto, com undo/redo e coalescência de arrastos/controles repetidos. O autosave de projeto é separado das ações de split/gravação visual.
- A timeline trabalha com FPS e quadros inteiros para segmentos; os eventos de fala/pensamento guardam início/duração temporal e são ajustados à grade quando editados.

### Adaptação para Video Studio

O Video Studio seguirá a estrutura canônica de estado contínuo do V4, adaptada ao fluxo de gravação manual:

- Cada personagem começa com um segmento-base que cobre a duração atual do projeto.
- **Salvar frame** cria um limite no playhead nas faixas visuais de personagens modificadas desde a última gravação. Exibe uma linha de corte atravessando todas as lanes, mas não cria segmentos idênticos redundantes nos personagens sem alteração.
- Pose e preset de expressão mudam na preview em modo de rascunho; salvar confirma o novo estado no segmento à direita do corte. O estado à esquerda permanece intacto.
- Segmentos podem ser selecionados e seus limites arrastados para ajustar quanto tempo cada estado dura. A gravação não deve criar uma divisão ao mero movimento de controles.
- Faixas de fala e pensamento seguem o modelo temporal de eventos do V4, mas armazenam só o texto e a duração.
- Adotar zoom `− / +`, slider e **Fit** do V4 como navegação. Os controles de duração inicial de dez minutos são um recurso próprio do Video Studio, não algo que o V4 atual já oferece.
- Copiar para a pasta do projeto apenas os assets necessários ao cenário e aos personagens/presets efetivamente usados; manter referências relativas, hash para deduplicação e aviso recuperável para arquivo ausente.

### Arquivos do Editor V4 consultados

- `docs/VISUAL_TIMELINE_V2.md` — autoridade e responsabilidades entre eventos e tracks canônicos.
- `docs/TIMELINE_TRACKS_V1.md` — metadados persistidos e contratos de visibilidade/bloqueio/recolhimento.
- `docs/ARCHITECTURE.md` — fluxo único JSON → runtime → cena → preview/export e relógio de playback.
- `src/components/TimelinePanel.tsx` — régua, zoom, snap, faixas, seleção, split, gestos de mover/redimensionar e menu.
- `src/core/scene/characterTrackState.ts` e `src/core/scene/canonicalCharacterTracks.ts` — normalização, segmentação, patch e movimento de limite.
- `src/core/scene/characterVisualTrack.ts` — compilação do estado canônico para consumo da preview/export.
- `src/core/project/timelineTracks.ts` — configuração/normalização dos metadados das faixas.
- `src/store/editorStore.ts` — ações da timeline, bloqueio, histórico e persistência do projeto.
- `src/app/App.tsx` — playback global, atalhos, autosave e redimensionamento vertical da timeline.

## 8. Reuso dos sistemas existentes

### Studio atual

Reaproveitar a renderização da cena, catálogo e referências de assets, composição de personagens, cenário, seleção e transformação. O Video Studio monta sua própria cena e mantém estado e arquivo de projeto independentes; não edita o documento ativo do Studio.

#### Modos faciais do Studio

O Studio atual oferece os modos **Idle**, **Blink** e **Talk**. O Video Studio deve conseguir gravar e reproduzir os três como parte do estado facial discreto de cada personagem, junto com o preset de expressão. `Idle` mostra os assets faciais normais; `Blink` resolve o olho fechado correspondente ao catálogo/modelo daquela personagem; `Talk` resolve a boca aberta correspondente ao modelo. Não presumir que duas personagens usam os mesmos nomes, IDs ou pareamento de assets.

O pareamento precisa ser determinístico e por personagem/modelo. Nomes inconsistentes ou assets duplicados não podem fazer Blink escolher uma peça errada. Se o personagem ainda não tiver um vínculo explícito de boca aberta, usar o asset aberto padrão do catálogo do modelo, sem gravar esse fallback nos dados globais do personagem.

Na boca, a peça aberta deve acompanhar a posição e rotação da boca fechada. Largura e altura devem preservar a calibração e proporção naturais da arte aberta, usando a boca fechada como referência de encaixe; não aplicar a largura/altura da boca fechada de forma que achate ou estique a boca aberta. Ao copiar os assets para o projeto, guardar a variante resolvida e os dados de transformação necessários para que o resultado permaneça igual mesmo que o catálogo de origem mude depois.

Esses modos e transformações pertencem ao snapshot do frame no Video Studio. Aplicá-los na preview ou salvá-los na timeline não pode alterar os assets fornecedores de Olhos Dev/Rosto Dev, o Customizador, nem os dados faciais persistidos da personagem. Quando o modo mudar, a gravação deve registrar apenas a faixa daquela personagem.

### Animador Dev e Animador Rosto Dev

Usar o Animador Dev como catálogo de poses e o Animador Rosto Dev como catálogo de presets de expressão. Adaptar seus formatos para snapshots serializáveis que pertencem ao projeto de vídeo; a timeline é a autoridade temporal. Efeitos incluídos no preset de expressão viajam dentro do snapshot do preset. Não criar faixas independentes para pupila, blush, sombra ou outros controles faciais na primeira fase, nem reaproveitar componentes que gravam dados globais do Fabricador ou Customizador.

Nesta fase, o usuário cria a animação gravando frames manualmente. Os presets dos animadores servem como valores aplicáveis à preview; somente **Salvar frame** persiste a escolha na faixa. O projeto guarda um snapshot serializável da pose e do preset de expressão usados, além dos IDs de origem para rastreabilidade, para que alterações posteriores no Fabricador não modifiquem vídeos já salvos. Cada mudança gravada tem transição de 20 ms. Inserção de animações prontas como blocos fica para depois. Não criar faixas independentes para controles faciais individuais neste escopo.

### Editor V4

Usar a pesquisa de campo da seção anterior como referência de implementação. Reaproveitar os contratos de faixa, operações de segmento, ruler, playhead, zoom, snap, seleção, drag/resize, undo/redo e persistência versionada. Adaptar o modelo de fala/pensamento para texto simples e trocar a ação explícita `Dividir` pelo fluxo de gravação **Salvar frame**, sem misturar a timeline narrativa do Editor V4 com o domínio de composição/animação do Video Studio.

## 9. Persistência e segurança dos dados

- Salvar cada projeto de vídeo em estrutura própria e versionada, sem sobrescrever `StudioDocument`, Customizador, Fabricador ou dados de presets.
- Criar uma pasta por projeto, com o documento do projeto e uma pasta `assets/`; copiar os arquivos ao adicionar/referenciar elementos e manter no documento caminhos relativos ao projeto.
- Calcular hash dos arquivos para deduplicar conteúdo idêntico dentro do projeto. Copiar os arquivos necessários para renderizar cenário e poses/expressões usados, não somente a imagem visível no quadro atual.
- A cópia deve ser transacional: só confirmar a referência no projeto depois que o arquivo tiver sido copiado e validado. Nunca editar ou mover o asset original.
- Autosave com estado visível, gravação atômica e recuperação de rascunho após fechamento inesperado.
- Desfazer/refazer deve cobrir alterações de cena, segmentos, marcadores de **Salvar frame** e operações de timeline.
- O projeto começa sem cena importada. Personagens, objetos e fundo adicionados passam a pertencer ao projeto de vídeo.
- Ao abrir, validar os arquivos empacotados. Assets ausentes devem aparecer como faltantes sem apagar segmentos, textos ou dados do projeto.
- Criar migrações explícitas para versões do schema e validar arquivos antes de aceitar gravação.
- Separar preferências de interface (altura da timeline, zoom e faixas recolhidas) do conteúdo criativo do projeto.

## 10. Reprodução e exportação

### Reprodução na preview

Uma função determinística `evaluateVideoProject(project, time)` deve resolver o estado da cena para o instante pedido. Ela consulta o segmento de cada personagem e aplica a transição de 20 ms para segmentos que acabaram de começar. O relógio de playback deriva o tempo de `performance.now()` e da velocidade escolhida, como no V4; se a renderização atrasar, a preview descarta atualizações atrasadas para acompanhar o relógio. O export amostra cada quadro em `frame / FPS`, sem descartar quadros. Preview e export devem consumir o mesmo avaliador e a mesma composição.

### Exportação

Exportação não é requisito para a primeira entrega, mas a arquitetura deve preparar um caminho rápido de renderização. O V4 fornece uma referência local de pipeline: resolver o mesmo estado da preview, apresentar e aguardar o frame, capturar o bitmap e enviá-lo ao encoder FFmpeg, com progresso e cancelamento no processo principal. O Video Studio deve validar quais partes desse pipeline são reaproveitáveis no Electron do NYMI V5. Deve oferecer resolução, FPS, intervalo, progresso, cancelamento e erros claros quando implementado. A saída desejada é MP4; se a codificação direta não for a opção mais rápida ou confiável, produzir em formato intermediário rápido e converter para MP4.

## 11. Plano de implementação por fases

### Fase 0 — Mapeamento técnico

- Mapear a navegação principal, composição/renderização do Studio e tipos de `StudioDocument`.
- Mapear a serialização atual de poses e expressões nos dois animadores.
- Auditar a timeline do Editor V4: modelo de dados, comandos, persistência, playback e exportação. Pesquisa de campo inicial já documentada na seção 7; validar os adaptadores específicos do NYMI V5 antes de implementar.
- Definir quais tipos de pose/expressão podem ser avaliados sem efeitos colaterais nos dados do Fabricador/Customizador.
- Definir cópia, hash e resolução de caminhos relativos dos assets dentro da pasta do projeto.
- Fechar o schema inicial do `VideoProject` e o tamanho dos passos de duração; usar 60 FPS como padrão inicial.

### Fase 1 — Casca independente

- Criar rota/área **Video Studio** na barra superior.
- Reusar a base visual e preview do Studio por componentes compartilhados onde for seguro.
- Criar projeto vazio, montar a cena, copiar assets usados para sua pasta, salvar e reabrir.

### Fase 2 — Modelo temporal e timeline

- Implementar projeto versionado, faixas canônicas por personagem, segmentos e faixas de texto de fala/pensamento.
- Construir ruler, playhead, duração de dez minutos com controles de extensão, zoom independente, seleção e edição de segmentos/blocos.
- Implementar desfazer/refazer e persistência/autosave.

### Fase 3 — Edição de animação

- Integrar pose corporal por adaptador ao Animador Dev.
- Integrar preset de expressão por adaptador ao Animador Rosto Dev.
- Implementar edição de preview pendente, **Salvar frame**, marcador/corte global, gravação apenas nas faixas afetadas e transição de 20 ms.

### Fase 4 — Playback confiável

- Implementar avaliação determinística por quadro e loop de playback.
- Sincronizar preview, playhead, seleção e controles de reprodução.
- Ajustar desempenho com cenas de vários personagens e timelines longas.

### Fase 5 — Exportação e acabamento

- Renderizar sequência com configurações explícitas, progresso e cancelamento.
- Validar desempenho do pipeline de render e conversão para MP4.
- Fechar recuperação, acessibilidade de controles, atalhos e mensagens de falha.

## 12. Critérios de aceite

- Video Studio aparece na barra principal e abre uma área independente.
- Projeto novo começa vazio e salva cenário/personagens/assets em pasta própria.
- A timeline começa com dez minutos; cada personagem tem uma faixa cobrindo o alcance atual e a duração pode ser alterada sem confundir esses controles com zoom.
- Primeiro **Salvar frame** grava a base de todos os personagens; gravações posteriores mostram um corte global e só adicionam estado nas faixas alteradas.
- Assets copiados permanecem disponíveis e com os mesmos pixels independentemente de mudanças nos arquivos originais.
- Alterar pose ou expressão de um personagem e salvar não altera o estado de outro personagem.
- Gravar e reproduzir Idle, Blink e Talk preserva o pareamento facial correto por personagem, incluindo a boca aberta alinhada à boca fechada; isso não altera dados globais de fornecedores ou da personagem.
- Ajustar pose/preset na preview sem salvar não muda a sequência reproduzida.
- Cada mudança salva aplica uma transição de 20 ms, com amostragem determinística adequada ao FPS.
- Redimensionar um limite aumenta um segmento e encurta o adjacente; bloquear a faixa impede mudanças e undo/redo restaura limites/estados.
- Faixas de fala e pensamento guardam apenas texto e podem ser movidas e redimensionadas.
- Playhead e preview representam o mesmo quadro; voltar e avançar produzem o mesmo resultado para o mesmo frame.
- Undo/redo, autosave e reabertura preservam a cena, os segmentos e os marcadores de gravação.
- Interpolação contínua não é aplicada a canais que representam escolhas discretas.
- Exportação, quando incluída, produz a sequência completa no FPS e intervalo escolhidos, com cancelamento e erro reportado corretamente.
- Projeto de vídeo não grava alterações em dados globais de fornecedor de assets, Fabricador, Customizador ou presets de expressão.

## 13. Decisões técnicas ainda abertas

1. **FPS e custo:** usar 60 FPS como padrão inicial para dar mais fluidez e representar melhor transições curtas. Isso gera aproximadamente o dobro de quadros e custo de renderização em comparação com 30 FPS no mesmo intervalo.
2. **Transição de sprites:** 20 ms cobre cerca de 1,2 quadros a 60 FPS (~16,7 ms por quadro), então a transição pode aparecer em um ou dois quadros, conforme o alinhamento do corte. O runtime calcula em tempo contínuo e o export amostra na grade do FPS escolhido.
3. **Controles de duração:** definir o tamanho de cada passo dos controles de duração (+/−); os controles de zoom horizontal permanecem separados.

## 14. Escopo inicial recomendado

A primeira versão utilizável deve cobrir: projeto vazio e independente, assets copiados para pasta própria, cena estática montada antes da gravação inicial, timeline de dez minutos extensível/encolhível, uma faixa visual contínua por personagem, faixas de texto para fala e pensamento, gravação manual de pose, preset de expressão e modo facial (Idle/Blink/Talk) por **Salvar frame**, corte global visível com estado alterado apenas nas faixas afetadas, segmentos redimensionáveis, transição de 20 ms, preview determinística, play/pause, persistência e desfazer/refazer. Exportação não precisa estar pronta, mas o desenho técnico deve permitir render rápido e conversão para MP4. Animações prontas em bloco, áudio e câmera ficam para fases seguintes.

Esse recorte mantém a ideia central — montar a cena, gravar mudanças ao longo do tempo e assistir — enquanto evita que a primeira entrega misture edição, composição, áudio e codecs antes da estrutura temporal estar estável.

## 15. Handoff para a IA que implementará o Video Studio

Este documento é a especificação de produto e o registro das decisões já confirmadas pelo dono do Gacha NYMI V5. Antes de implementar, leia o plano inteiro e inspecione o repositório do app, com atenção à navegação principal, Studio, modelos persistidos, renderizador e limites entre dados locais do projeto e catálogos fornecedores. O repositório do app é `https://github.com/nestarasup-sys/G-V5`.

O Editor V4 é um projeto separado e a referência principal para o comportamento de timeline. A cópia local indicada pelo usuário é `C:\TRABALHO 2\EDITOR V4\EDITOR V4`. Inspecione o código e os documentos dessa cópia antes de decidir como adaptar faixas, cortes, redimensionamento de segmentos, seleção, playhead, zoom, undo/redo e persistência. A seção 7 registra os arquivos e conceitos que já foram pesquisados; confira a implementação atual no checkout antes de reutilizar contratos ou assumir que o estado do plano está atualizado.

Trate as regras deste plano como requisitos, e não como instruções para modificar os sistemas de origem. O Video Studio precisa de projeto, snapshots e persistência próprios. Não escreva nos dados de Olhos Dev, Rosto Dev, Animador Dev, Animador Rosto Dev, Customizador ou Studio normal ao aplicar poses, presets, Idle, Blink ou Talk. Resolva referências por personagem/modelo e empacote os assets usados no próprio projeto.

Antes da primeira alteração de código, devolva uma leitura técnica breve contendo: arquitetura existente do Studio V5; comportamento concreto de timeline encontrado no Editor V4; mapeamento dos arquivos e adaptadores propostos; formato versionado de projeto; riscos de colisão ou escrita nos dados globais; e plano de validação. Preserve o escopo por fases e os critérios de aceite deste documento. Não substitua o Studio atual por uma implementação paralela nem comece pela exportação antes de validar gravação, reprodução, persistência e recuperação dos frames.
