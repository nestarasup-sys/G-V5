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
