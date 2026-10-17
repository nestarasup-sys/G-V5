# Plano completo — Video Studio

## 1. Visão da área

O **Video Studio** será uma nova área acessível pela barra superior principal, ao lado das áreas existentes. Sua entrada visual e seu espaço de trabalho partirão do Studio atual: cenário, personagens, objetos, preview e painel de edição continuam familiares. A diferença é que o Video Studio terá um projeto próprio, com tempo, faixas, quadros-chave, reprodução e exportação de vídeo.

A primeira versão deve permitir montar uma cena, salvar o estado inicial como primeiro quadro, avançar o indicador de tempo, alterar pose ou expressão de um personagem e gravar novos estados. Ao reproduzir, o editor combina esses estados ao longo do tempo para formar a animação.

## 2. Princípios de estrutura

- **Projeto de vídeo independente:** criar um modelo `VideoProject` versionado; não guardar a timeline dentro de `StudioDocument` nem alterar o Studio original.
- **Cena inicial por cópia:** criar um vídeo a partir de uma cena existente copiando cenário, personagens, objetos, ordem visual e transformações para um snapshot próprio. Alterar o vídeo não modifica a cena de origem.
- **Estado por personagem e por tempo:** a timeline deve registrar canais de animação por personagem. Um quadro de expressão não pode restaurar sem querer a pose, a roupa ou as escolhas de outro personagem.
- **Dados canônicos únicos:** faixas organizam e editam dados, mas não mantêm uma segunda cópia concorrente dos mesmos valores animados.
- **Preview e exportação coerentes:** a mesma avaliação da cena em um instante de tempo deve alimentar a preview e o render final.
- **Edição não destrutiva:** guardar keyframes e interpolação; não gerar um vídeo intermediário a cada alteração.
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
  durationFrames: number
  canvas: { width: number; height: number; backgroundColor: string }
  scene: VideoSceneSnapshot
  tracks: VideoTrack[]
  createdAt: string
  updatedAt: string
}

type VideoTrack = {
  id: string
  kind: 'character' | 'scene' | 'camera' | 'audio'
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

O tipo `channels` precisa ser substituído por tipos discriminados e validados antes de codificar. A proposta separa identidade do alvo, posição temporal e canais animáveis. Para personagens, os canais devem poder representar posição, escala, rotação, pose/rig, aparência facial, expressão e ordem visual conforme as capacidades reais do Studio. O snapshot inicial guarda os elementos e referências de asset necessários para reabrir o projeto sem depender de uma cena que pode ser alterada depois.

Áudio e câmera aparecem no formato como extensões planejadas; não precisam entrar na primeira entrega se ainda não houver fluxo correspondente. Não criar um canal sem suporte de preview, persistência e exportação.

## 5. Fluxo principal de uso

1. Abrir **Video Studio** e criar um projeto vazio ou iniciar a partir de uma cena do Studio.
2. Montar cenário, personagens e objetos na preview. A origem é copiada para o projeto de vídeo.
3. Definir formato de tela e taxa de quadros. A duração pode crescer conforme a edição.
4. Posicionar o playhead no quadro inicial e usar **Salvar quadro-chave**. Esse primeiro registro deve capturar o estado-base da cena.
5. Avançar o playhead. Selecionar um personagem e alterar sua pose, expressão, aparência ou transformação.
6. Salvar outro quadro-chave apenas nos canais alterados daquele personagem. Os outros personagens mantêm seus estados.
7. Repetir em outros tempos e alvos; cada faixa deixa claro o que foi alterado e onde.
8. Usar **Play/Pause**, mover o playhead, ajustar a velocidade da preview e revisar a transição.
9. Salvar o projeto e exportar o intervalo desejado quando a exportação estiver implementada.

O comando de salvar quadro-chave deve atualizar o keyframe existente no mesmo quadro e canal quando apropriado, com indicação clara de sobrescrita; criar duplicatas invisíveis no mesmo instante deve ser evitado.

## 6. Comportamento da timeline

### Faixas da primeira fase

- Uma faixa por personagem, nomeada e identificável visualmente.
- Faixa de cena para fundo e propriedades globais animáveis que forem suportadas.
- Futuras faixas de câmera e áudio, ativadas apenas quando houver comportamento completo.

Dentro da faixa do personagem, os keyframes podem ser agrupados por canal — transformação, pose, expressão e aparência — para que uma mudança facial não pareça substituir o corpo inteiro. A interface deve mostrar keyframes e permitir selecionar, mover, copiar/colar, apagar e duplicar, respeitando a faixa e o alvo.

### Régua e navegação

- Régua em quadros e timecode, alinhados à taxa de quadros do projeto.
- Playhead arrastável, zoom horizontal e rolagem.
- Snap configurável para quadros-chave e limites relevantes.
- Seleção múltipla e comandos de teclado devem ser considerados no desenho da interação.
- Faixas podem ser recolhidas, ocultadas e bloqueadas sem alterar o conteúdo salvo.

### Interpolação

- **Hold:** mantém o valor até o próximo keyframe; útil para escolhas discretas de pose, asset e expressão.
- **Linear:** transição constante para transformações contínuas.
- **Bezier:** transição ajustável para movimento com aceleração e desaceleração.

Assets discretos não devem receber interpolação visual inválida. A regra deve ser definida por canal e indicada na interface.

## 7. Reuso dos sistemas existentes

### Studio atual

Inspecionar e reaproveitar a renderização da cena, catálogo e referências de assets, composição de personagens, cenário, seleção e transformação. O Video Studio deve receber uma cena snapshot e seu próprio estado de edição, em vez de editar o documento ativo do Studio diretamente.

### Animador Dev e Animador Rosto Dev

Reaproveitar os conceitos e, após análise dos formatos, adaptadores para pose, rig corporal, expressão, transformações do rosto e efeitos faciais. A timeline de vídeo será a autoridade temporal do projeto. Não embutir um animador inteiro por keyframe nem reaproveitar um componente que grava dados globais de Fabricador ou Customizador.

As animações prontas dos animadores podem futuramente ser inseridas como blocos/clipes ou convertidas em keyframes do projeto. Essa conversão deve preservar valores, duração e easing e oferecer uma prévia antes de aplicar.

### Editor V4

Estudar a timeline existente em `C:\TRABALHO 2\EDITOR V4\EDITOR V4`, principalmente os documentos `docs/TIMELINE_TRACKS_V1.md`, `docs/VISUAL_TIMELINE_V2.md` e a implementação do editor. Reaproveitar ideias comprovadas de faixas canônicas, ruler, playhead, zoom, seleção, drag/resize, undo/redo e persistência versionada. Não copiar a timeline inteira sem separar o domínio do Editor V4 do domínio de animação de personagens do Video Studio.

## 8. Persistência e segurança dos dados

- Salvar cada projeto de vídeo em estrutura própria e versionada, sem sobrescrever `StudioDocument`, Customizador, Fabricador ou dados de presets.
- Autosave com estado visível, gravação atômica e recuperação de rascunho após fechamento inesperado.
- Desfazer/refazer deve cobrir alterações de cena, keyframes e operações da timeline.
- Ao duplicar uma cena para vídeo, registrar a origem para referência, mantendo o snapshot independente.
- Referências de assets devem ser validadas ao abrir. Assets ausentes devem aparecer como faltantes sem apagar keyframes ou dados do projeto.
- Criar migrações explícitas para versões do schema e validar arquivos antes de aceitar gravação.
- Separar preferências de interface (altura da timeline, zoom e faixas recolhidas) do conteúdo criativo do projeto.

## 9. Reprodução e exportação

### Reprodução na preview

Uma função determinística `evaluateVideoProject(project, frame)` deve resolver o estado da cena para o quadro pedido. O loop de reprodução avança pelo relógio de tempo, respeitando o frame rate, e solicita a avaliação daquele instante. Se a renderização atrasar, a preview pode descartar quadros atrasados para acompanhar o tempo; a exportação não pode descartar quadros.

### Exportação

Exportação é uma etapa própria, posterior à edição e à reprodução. Deve oferecer resolução, FPS, intervalo, formato disponível no ambiente, progresso, cancelamento e mensagens compreensíveis de erro. Antes de prometer MP4 ou qualquer codec, verificar suporte real no Electron e nas dependências do projeto. O render deve processar os quadros de forma determinística, manter sincronismo e não depender de screenshots da UI em tamanhos variáveis.

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

1. **Snapshot ou vínculo vivo com a cena:** a proposta inicial é snapshot independente para garantir que atualizações futuras da cena não mudem vídeos existentes.
2. **Salvar quadro completo ou somente canais alterados:** a proposta é gravar por personagem/canal, com estado inicial explícito, para evitar que uma edição apague mudanças feitas em outro instante.
3. **Assets alterados ou removidos:** definir política de snapshot/embutimento de assets versus referência a arquivos compartilhados. O projeto precisa continuar recuperável quando uma referência falhar.
4. **Formato de exportação:** escolher somente depois de auditar os codecs e o caminho de renderização disponíveis no Electron atual.
5. **Áudio e câmera:** manter fora do primeiro marco funcional, mas reservar compatibilidade no desenho se isso não criar complexidade prematura.
6. **Interpolação de pose e expressão:** confirmar quais valores são interpoláveis e quais devem trocar em um instante definido.

## 13. Escopo inicial recomendado

A primeira versão utilizável deve cobrir: projeto independente, snapshot de cena, uma faixa por personagem, keyframes de transformação/pose/expressão, edição e remoção de keyframes, preview determinística, play/pause, persistência e desfazer/refazer. Timeline de áudio, câmera avançada, clipes de animação prontos e exportação final podem entrar nas fases seguintes após validar o núcleo e os formatos de dados.

Esse recorte mantém a ideia central — montar a cena, gravar mudanças ao longo do tempo e assistir — enquanto evita que a primeira entrega misture edição, composição, áudio e codecs antes da estrutura temporal estar estável.
