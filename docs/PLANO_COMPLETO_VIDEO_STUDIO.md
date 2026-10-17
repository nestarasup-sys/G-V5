# Plano completo — Video Studio

## 1. Visão da área

O **Video Studio** será uma nova área acessível pela barra superior principal, ao lado das áreas existentes. Sua entrada visual e seu espaço de trabalho partirão do Studio atual: cenário, personagens, objetos, preview e painel de edição continuam familiares. A diferença é que o Video Studio terá um projeto próprio, com tempo, faixas, quadros-chave, reprodução e exportação de vídeo.

A primeira versão começa com um projeto vazio e deve permitir montar uma cena, salvar o estado inicial como primeiro quadro, avançar o indicador de tempo, alterar pose ou expressão de um personagem e gravar novos estados. As alterações feitas pelos controles aparecem na preview antes de serem gravadas. Ao reproduzir, o editor combina esses estados ao longo do tempo para formar a animação.

## 2. Princípios de estrutura

- **Projeto de vídeo independente:** criar um modelo `VideoProject` versionado; não guardar a timeline dentro de `StudioDocument` nem alterar o Studio original.
- **Projeto começa em branco:** o usuário adiciona cenário, personagens e objetos usando as funções do Studio. A cena construída pertence ao Video Studio desde o início.
- **Estado por personagem e por tempo:** a timeline deve registrar canais de animação por personagem. Um quadro de expressão não pode restaurar sem querer a pose, a roupa ou as escolhas de outro personagem.
- **Dados canônicos únicos:** faixas organizam e editam dados, mas não mantêm uma segunda cópia concorrente dos mesmos valores animados.
- **Preview e exportação coerentes:** a mesma avaliação da cena em um instante de tempo deve alimentar a preview e o render final.
- **Edição não destrutiva:** guardar os estados gravados na timeline; mudanças de controles só entram na sequência ao pressionar **Salvar frame**.
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
  frameRate: number
  durationFrames: number // inicializado para 10 minutos na taxa de quadros do projeto
  canvas: { width: number; height: number; backgroundColor: string }
  scene: VideoSceneSnapshot // cena montada no próprio Video Studio; fundo estático na primeira versão
  tracks: VideoTrack[]
  createdAt: string
  updatedAt: string
}

type VideoTrack = {
  id: string
  kind: 'character' | 'dialogue' | 'thought' | 'scene'
  targetId?: string
  name: string
  order: number
  visible: boolean
  locked: boolean
  muted?: boolean
  keyframes: VideoKeyframe[]
}

type VideoKeyframe = {
  id: string
  frame: number
  channels: Record<string, unknown>
  interpolation: 'hold' | 'linear' | 'bezier'
}
```

O tipo `channels` precisa ser substituído por tipos discriminados e validados antes de codificar. A proposta separa identidade do alvo, posição temporal e canais animáveis. Para personagens, os canais iniciais devem representar pose e preset de expressão; transformações poderão ser incluídas quando forem definidas como parte do escopo. O primeiro frame grava os valores-base de todos os personagens e o fundo. Nos frames seguintes, somente as propriedades editadas são gravadas nas faixas afetadas. O fundo é estático na primeira versão: posição, escala e demais ajustes são feitos antes de salvar o primeiro frame.

As faixas de texto de fala e pensamento seguem o modelo de faixas do Editor V4. Áudio e câmera ficam fora do escopo inicial. Não criar um canal sem suporte completo de preview, persistência e exportação.

## 5. Fluxo principal de uso

1. Abrir **Video Studio** e criar um projeto vazio.
2. Montar cenário, personagens e objetos na preview. Ajustar o fundo antes da gravação inicial.
3. A timeline abre com dez minutos disponíveis. A duração pode ser estendida posteriormente.
4. Posicionar o playhead no início e usar **Salvar frame**. Esse primeiro registro captura os valores-base dos personagens e estabelece a cena estática.
5. Avançar o playhead. Selecionar um personagem e alterar sua pose e/ou preset de expressão. Essas escolhas aparecem na preview, mas ainda não foram gravadas.
6. Usar **Salvar frame**. O editor insere um corte no playhead apenas nas faixas dos personagens cujas propriedades foram alteradas; as demais faixas não recebem mudanças.
7. Repetir em outros tempos e personagens. A faixa do personagem mostra os segmentos e cortes que determinam seus estados.
8. Usar **Play/Pause**, mover o playhead e revisar a sequência.
9. Salvar o projeto e exportar quando essa etapa for implementada.

O comando **Salvar frame** aplica um corte sincronizado no playhead nas faixas afetadas, mantendo as propriedades anteriores nos trechos anteriores ao corte. O frame salvo representa as mudanças pendentes da preview naquele instante. Se já houver um corte no mesmo instante, a operação deve atualizar esse corte e informar a substituição, sem criar duplicatas invisíveis. O mecanismo visual pode usar cortes/segmentos por faixa, embora a persistência interna possa normalizá-los como estados temporais ou keyframes.

## 6. Comportamento da timeline

### Faixas da primeira fase

- Uma faixa por personagem, nomeada e identificável visualmente, como no Editor V4.
- Faixas próprias para texto de fala e texto de pensamento.
- Sem faixa animada de fundo na primeira versão; o fundo é definido antes de **Salvar frame** inicial e permanece estático.

Cada faixa de personagem contém estados/cortes nos tempos em que suas propriedades mudam. A gravação é independente por faixa: ao salvar uma pose e expressão novas para um personagem, não inserir cortes redundantes nas faixas dos demais. A interface deve permitir selecionar, mover, copiar/colar, apagar e duplicar cortes/estados, respeitando o personagem e o tempo.

### Régua e navegação

- Régua temporal com playhead, começando com dez minutos de duração visível/disponível; definir unidade e FPS na etapa técnica.
- Playhead arrastável, zoom horizontal e rolagem.
- Snap configurável para quadros-chave e limites relevantes.
- Seleção múltipla e comandos de teclado devem ser considerados no desenho da interação.
- Faixas podem ser recolhidas, ocultadas e bloqueadas sem alterar o conteúdo salvo.

### Troca entre estados

Pose e expressão são aplicadas como mudanças praticamente instantâneas junto ao corte: a transição deve durar **0 ou 20 ms**, sem interpolação longa. O padrão recomendado para a primeira versão é corte instantâneo (0 ms), para não introduzir uma animação intermediária que o usuário não gravou. Uma futura opção de 20 ms pode suavizar apenas a troca visual se isso for necessário. Não aplicar interpolação contínua a poses ou expressões discretas.

## 7. Reuso dos sistemas existentes

### Studio atual

Inspecionar e reaproveitar a renderização da cena, catálogo e referências de assets, composição de personagens, cenário, seleção e transformação. O Video Studio deve receber uma cena snapshot e seu próprio estado de edição, em vez de editar o documento ativo do Studio diretamente.

### Animador Dev e Animador Rosto Dev

Reaproveitar os conceitos e, após análise dos formatos, adaptadores para pose, rig corporal, expressão, transformações do rosto e efeitos faciais. A timeline de vídeo será a autoridade temporal do projeto. Não embutir um animador inteiro por keyframe nem reaproveitar um componente que grava dados globais de Fabricador ou Customizador.

Nesta fase, o usuário cria a animação gravando frames manualmente. Os presets de pose e expressão dos animadores servem como valores aplicáveis à preview; somente **Salvar frame** persiste a escolha na faixa. Inserção de animações prontas como blocos fica para depois.

### Editor V4

Estudar a timeline existente em `C:\TRABALHO 2\EDITOR V4\EDITOR V4`, principalmente os documentos `docs/TIMELINE_TRACKS_V1.md`, `docs/VISUAL_TIMELINE_V2.md` e a implementação do editor. Reaproveitar ideias comprovadas de faixas canônicas, ruler, playhead, zoom, seleção, drag/resize, undo/redo e persistência versionada. Não copiar a timeline inteira sem separar o domínio do Editor V4 do domínio de animação de personagens do Video Studio.

## 8. Persistência e segurança dos dados

- Salvar cada projeto de vídeo em estrutura própria e versionada, sem sobrescrever `StudioDocument`, Customizador, Fabricador ou dados de presets.
- Autosave com estado visível, gravação atômica e recuperação de rascunho após fechamento inesperado.
- Desfazer/refazer deve cobrir alterações de cena, keyframes e operações da timeline.
- O projeto começa sem cena importada. Personagens, objetos e fundo adicionados passam a pertencer ao projeto de vídeo.
- Referências de assets devem ser validadas ao abrir. Assets ausentes devem aparecer como faltantes sem apagar keyframes ou dados do projeto.
- Criar migrações explícitas para versões do schema e validar arquivos antes de aceitar gravação.
- Separar preferências de interface (altura da timeline, zoom e faixas recolhidas) do conteúdo criativo do projeto.

## 9. Reprodução e exportação

### Reprodução na preview

Uma função determinística `evaluateVideoProject(project, frame)` deve resolver o estado da cena para o quadro pedido. O loop de reprodução avança pelo relógio de tempo, respeitando o frame rate, e solicita a avaliação daquele instante. Se a renderização atrasar, a preview pode descartar quadros atrasados para acompanhar o tempo; a exportação não pode descartar quadros.

### Exportação

Exportação não é requisito para a primeira entrega, mas a arquitetura deve preparar um caminho rápido de renderização. Deve oferecer resolução, FPS, intervalo, progresso, cancelamento e mensagens compreensíveis de erro. A saída desejada é MP4; se a codificação direta não for a opção mais rápida ou confiável, exportar por um formato intermediário rápido e converter para MP4. Antes de definir o codec, verificar suporte real no Electron e nas dependências do projeto. O render deve processar os quadros de forma determinística e manter sincronismo.

## 10. Plano de implementação por fases

### Fase 0 — Mapeamento técnico

- Mapear a navegação principal, composição/renderização do Studio e tipos de `StudioDocument`.
- Mapear a serialização atual de poses e expressões nos dois animadores.
- Auditar a timeline do Editor V4: modelo de dados, comandos, persistência, playback e exportação.
- Definir quais tipos de pose/expressão podem ser avaliados sem efeitos colaterais nos dados do Fabricador/Customizador.
- Fechar o schema inicial do `VideoProject` e os limites da primeira entrega.

### Fase 1 — Casca independente

- Criar rota/área **Video Studio** na barra superior.
- Reusar a base visual e preview do Studio por componentes compartilhados onde for seguro.
- Criar projeto, carregar cena por snapshot, salvar e reabrir sem alterar a origem.

### Fase 2 — Modelo temporal e timeline

- Implementar projeto versionado, faixas por personagem e keyframes tipados.
- Construir ruler, playhead, zoom, seleção e edição básica de keyframes.
- Implementar desfazer/refazer e persistência/autosave.

### Fase 3 — Edição de animação

- Adicionar canais de transformação.
- Integrar pose corporal por adaptador ao Animador Dev.
- Integrar expressão, pupilas, sobrancelhas, boca, blush e shadow por adaptador ao Animador Rosto Dev.
- Adicionar interpolação apropriada por canal e gravação de keyframes via painel/preview.

### Fase 4 — Playback confiável

- Implementar avaliação determinística por quadro e loop de playback.
- Sincronizar preview, playhead, seleção e controles de reprodução.
- Ajustar desempenho com cenas de vários personagens e timelines longas.

### Fase 5 — Exportação e acabamento

- Renderizar sequência com configurações explícitas, progresso e cancelamento.
- Validar áudio/câmera antes de incluí-los como canais exportáveis.
- Fechar recuperação, acessibilidade de controles, atalhos e mensagens de falha.

## 11. Critérios de aceite

- Video Studio aparece na barra principal e abre uma área independente.
- Criar vídeo de uma cena copia seu estado; editar vídeo não modifica a cena original.
- Primeiro keyframe captura o estado inicial e persiste após fechar/reabrir o app.
- Alterar pose de um personagem em outro quadro não altera os outros personagens.
- Alterar apenas a expressão não redefine pose, transformações, aparência ou efeitos faciais já customizados.
- Playhead e preview representam o mesmo quadro; voltar e avançar produzem o mesmo resultado para o mesmo frame.
- Undo/redo, autosave e reabertura preservam a cena e os keyframes.
- Interpolação contínua não é aplicada a canais que representam escolhas discretas.
- Exportação, quando incluída, produz a sequência completa no FPS e intervalo escolhidos, com cancelamento e erro reportado corretamente.
- Projeto de vídeo não grava alterações em dados globais de fornecedor de assets, Fabricador, Customizador ou presets de expressão.

## 12. Riscos e decisões para a etapa de projeto técnico

1. **Assets usados pelo projeto:** definir se o projeto deve manter referências aos assets atuais do app ou copiar os arquivos usados para uma pasta própria. A preferência do usuário ainda está em aberto.
2. **Formato de exportação:** escolher o caminho MP4 ou intermediário após auditar codecs e desempenho disponíveis no Electron.
3. **Duração:** definir como ampliar a timeline além dos dez minutos iniciais e se ela aumenta automaticamente ao salvar um frame depois do limite.
4. **Troca de estado:** padrão instantâneo; validar se a opção de 20 ms deve existir como configuração.
5. **Texto de fala e pensamento:** definir se essas faixas são somente texto ou se terão estilo/animação já no primeiro escopo.

## 13. Escopo inicial recomendado

A primeira versão utilizável deve cobrir: projeto vazio e independente, cena montada no Video Studio, fundo estático ajustado antes do primeiro frame, timeline inicial de dez minutos, uma faixa por personagem, faixas de fala e pensamento, gravação manual de pose e preset de expressão por **Salvar frame**, cortes locais às faixas afetadas, preview determinística, play/pause, persistência e desfazer/refazer. Exportação não precisa estar pronta, mas o desenho técnico deve permitir render rápido e conversão para MP4. Animações prontas em bloco, áudio e câmera ficam para fases seguintes.

Esse recorte mantém a ideia central — montar a cena, gravar mudanças ao longo do tempo e assistir — enquanto evita que a primeira entrega misture edição, composição, áudio e codecs antes da estrutura temporal estar estável.
