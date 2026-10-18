# Independência entre Studio e Video Studio

Os editores têm componentes de página, estado de edição, layout e estilos próprios.
Uma alteração visual ou de interação solicitada para um deles deve ser feita nos
arquivos daquele editor.

| Área | Entrada | Editor | Estilos | Persistência |
| --- | --- | --- | --- | --- |
| Studio | `/estudio` | `features/studio/StudioPage.tsx` | seletores `.studio-*` em `ui/styles.css` | API `*Studio`, canal `studio:*`, pasta `studios/Studio Principal` |
| Video Studio | `/video-studio` | `features/videoStudio/VideoStudioEditor.tsx` via `VideoStudioPage.tsx` | `features/videoStudio/VideoStudioEditor.css`, seletores `.video-studio-*` e `.video-*` | API `*VideoStudio`, canal `video-studio:*`, pasta `studios/Video Studio` |

As pastas de dados ficam dentro de `app.getPath('userData')`. Os personagens e os
assets do Fabricador/Customizador continuam sendo fornecedores comuns aos dois
editores. Funções de composição facial, tipos de documentos, ícones e retratos
podem ser reutilizados; o componente de edição e os seletores de layout não.

O Studio normal mantém o layout anterior à criação do Video Studio: ferramentas
à esquerda, elenco à direita e inspector sobre a prévia. O Video Studio mantém
seu inspector fixo à esquerda, elenco no modal e timeline abaixo da prévia.

O layout normal foi recuperado da referência `d4b44b8`, mantendo a correção de
persistência imediata das imagens importadas. Isso foi uma restauração de código
de interface, sem reset do repositório ou migração dos projetos salvos.

Ao mudar qualquer editor, conferir os dois caminhos e a troca entre eles: estilos
carregados por uma rota continuam carregados ao navegar para a outra.

A auditoria `electron scripts/audit-studio-isolation.cjs`, executada após
`npm run build`, abre o renderer compilado com documentos em memória. Ela confere
as posições dos painéis e a navegação Studio → Video Studio → Studio, sem acessar
a biblioteca real, e salva capturas e o resultado em `out/audit-studio-isolation`.

## Vídeos na composição

O vídeo ocupa inicialmente uma área central de 50% da prévia, conservando sua
proporção. A composição reserva a camada 0 para o fundo, 1 para vídeos e 2 em
diante para personagens e demais elementos. A ordem das linhas da timeline não
altera essa regra de composição.

Os clipes de vídeo suportam mover, recortar pelas pontas, dividir, duplicar,
excluir somente o selecionado, desfazer/refazer e os controles da linha em
Faixas (nome, visibilidade, bloqueio e recolhimento). Recortar atualiza tanto o
intervalo na timeline quanto o trecho correspondente do arquivo original;
mover mantém o trecho original. As pontas não ultrapassam a mídia disponível.
`shared/videoMedia.ts` centraliza essas operações e a validação usada ao salvar.

`node scripts/audit-video-media.mjs` verifica as operações e a continuidade da
mídia. Após compilar, `electron scripts/audit-video-timeline.cjs <arquivo.mp4>`
confere a composição e os gestos reais usando um MP4 de teste de 20 segundos e
documentos em memória. As capturas ficam em `out/audit-video-timeline`.

## Áudio dos vídeos

O player nativo de cada vídeo reproduz imagem e som com o mesmo relógio. O áudio
não é extraído nem copiado novamente: acompanha o arquivo em `videos/`. O projeto
salva o volume geral em `videoTimeline.videoAudio`, e cada clipe salva seu volume
e silêncio em `clip.audio`. Campos ausentes em projetos antigos significam volume
100% e som ativado. Divisão, duplicação e recorte preservam esses ajustes.

O botão **Áudio** na timeline abre controles flutuantes para o projeto e o vídeo
selecionado. O volume efetivo é o volume geral multiplicado pelo volume do clipe;
silenciar qualquer um interrompe o som, mantendo a imagem. Clipes sobrepostos
tocam seus áudios juntos. A faixa bloqueada impede alterar o áudio de seus clipes.
O ajuste de volume em um gesto corresponde a uma operação de desfazer.

`shared/videoAudio.ts` define os padrões, validação e ganho. O controlador
`videoMediaPlayback.ts` aplica esse ganho ao mesmo elemento de vídeo e acompanha
o playhead, corrigindo desvios sem solicitar Play a cada frame. Pausa, busca com a
timeline parada, saída do editor e ocultação da janela interrompem o som. Falhas
de reprodução são exibidas e só são tentadas novamente com uma nova ação Play.

`node scripts/audit-video-audio.mjs` cobre sincronização, volume, silêncio e as
corridas entre Play/Pause. Com um MP4 de teste contendo áudio, adicionar `--audio`
à auditoria do Electron também verifica saída audível, controles, herança dos
ajustes, limpeza ao sair e reabertura, usando apenas documentos de teste.
