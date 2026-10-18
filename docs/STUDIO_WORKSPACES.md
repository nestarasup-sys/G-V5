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

## Biblioteca de vídeos

**+ Vídeo** abre `VideoLibraryModal.tsx`. O modal lista uploads de todos os
roteiros, busca por arquivo/roteiro, mostra uma prévia, importa, exclui da
biblioteca e adiciona vários selecionados ao roteiro atual. Os clipes entram em
sequência a partir do playhead. Importar apenas registra o vídeo na biblioteca;
o botão **Adicionar ao roteiro** insere a seleção na timeline.

`electron/videoLibrary.ts` controla a biblioteca em
`studios/Video Studio/media-library/catalog.json` e `media-library/videos/`.
Os arquivos existentes nos roteiros são copiados para o catálogo no primeiro
acesso. A identidade do asset evita duplicar uma entrada reutilizada por vários
roteiros. A lista registra em quais roteiros cada item está salvo.

Cada roteiro continua tendo seu próprio arquivo em `studio-<id>/videos/`.
Adicionar copia o arquivo da biblioteca antes de criar o clipe. Excluir da
biblioteca remove somente seu original e registra a exclusão no catálogo para
que a migração dos roteiros antigos não o recoloque na lista. Os clipes e arquivos
dos roteiros existentes permanecem independentes. Excluir um roteiro arquiva
seus vídeos na biblioteca antes de remover sua pasta, respeitando os itens já
excluídos da biblioteca.

Operações do catálogo são serializadas; cópias são preparadas em arquivos
temporários, verificadas pelo tamanho e publicadas por rename. O catálogo também
usa gravação temporária e rename. Uma importação com duração ainda pendente fica
registrada e pode ser reconhecida novamente após reabrir o app. O protocolo
`gacha-video://library/<id>` serve apenas IDs registrados, incluindo leitura por
intervalos para a prévia; os roteiros usam `gacha-video://studio/<id>/<asset-id>`.

`node scripts/audit-video-library.mjs` cobre migração, cópia independente,
exclusão persistente, conflitos e validação de caminhos. Após compilar,
`electron scripts/audit-video-library-ui.cjs <MP4 de 20 segundos>` verifica o modal
com arquivos reais e catálogo em disco: importação, seleção múltipla, exclusão,
reabertura e preservação dos vídeos dos roteiros. Os testes usam `out/`, sem
acessar a biblioteca real do usuário.

## Composição de vídeos na prévia

Cada `VideoMediaClip` pode salvar `transform` com X/Y relativos ao centro,
largura/altura em porcentagem do enquadramento e rotação em graus. Documentos
antigos mantêm o padrão centralizado de 50% sem migração destrutiva. O validador
compartilhado também valida os limites desses dados antes de salvar no Electron.
Dividir e duplicar preservam a composição inicial, e cada trecho passa a poder
ser editado separadamente.

Clicar no vídeo abre o inspector Editor e sincroniza a seleção com a timeline.
Arrastar move; as quatro alças redimensionam mantendo o canto oposto ancorado,
inclusive com rotação. O inspector oferece X, Y, largura, altura, rotação e
restaurar enquadramento. Uma interação de arraste gera uma entrada no histórico;
os ajustes usam o salvamento automático do roteiro e respeitam o bloqueio da
faixa. O vídeo permanece atrás dos personagens e na frente do fundo.
