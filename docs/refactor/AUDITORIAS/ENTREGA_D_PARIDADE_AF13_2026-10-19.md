# Entrega D — paridade AF-13 com autoria real da interface

Data: 2026-10-19  
Branch: `master-desenvolvimento`  
SHA-base da execução: `3624c9b068b931185f9b615d0cb1eda265187fe9`  
Run: `2026-10-19T07-53-27-359Z-cf8b026a-11a6-4165-bc0f-1ae520404c58`  
Reexecução completa: `2026-10-19T07-58-23-245Z-96124ae5-3020-4e77-a8e9-70cd01a1abca`  
Relatório local: `out/dev-ai/runs/2026-10-19T07-53-27-359Z-cf8b026a-11a6-4165-bc0f-1ae520404c58/report.json`  
Evidências AF-13: `out/dev-ai/runs/2026-10-19T07-53-27-359Z-cf8b026a-11a6-4165-bc0f-1ae520404c58/studio-ipc-real-artifacts/af13-authored/`

## O que foi exercitado

O caso AF-13 agora encadeia a autoria anterior da Entrega B ao fluxo real de consumo. Modelo, duas poses, conjunto de roupas e os personagens A/B foram criados e salvos pela interface automatizada do Fabricador/Customizador; a etapa AF-13 lê esses registros pelo preload e IPC de produção. Não usa uma fixture preparada diretamente no formato final do conjunto.

O conjunto contém nove componentes: camisa no tronco, coxas e canelas dos dois lados, sapatos associados às canelas e luvas associadas aos antebraços. São verificadas as referências válidas de `partId`, as imagens/cores dos componentes e a geometria projetada de coxa/canela nos joelhos.

Foram capturados e comparados seis estados nos três consumidores:

| Estado | Pose | Variação |
| --- | --- | --- |
| A — original | 1 | Encaixe padrão publicado pelo Fabricador |
| A — original | 2 | Segunda pose UI-autorizada |
| A — deslocado | 1 | Camisa deslocada por override individual |
| A — deslocado | 2 | Mesmo override na segunda pose |
| B — próprio | 1 | Coxa esquerda com override independente de B |
| B — próprio | 2 | Override de B na segunda pose |

Cada estado passa pela captura de camadas do Customizador, abertura do mesmo personagem no Studio normal e no Video Studio pela interface, e captura das imagens renderizadas nos palcos reais. A comparação de personagem remove apenas margens totalmente transparentes; não redimensiona os PNGs. O limite original permanece `channelTolerance: 3` e `maxChangedPixelRatio: 0.001`.

## Resultado

- As seis comparações Customizador↔Studio e Customizador↔Video Studio registraram **0 pixels alterados**; Studio↔Video Studio também registrou 0.
- Geometria dos nove componentes foi medida por cor única da fixture e comparada pixel a pixel nas três áreas para cada cenário.
- O overlap vertical projetado no joelho foi registrado nos dois lados; mínimo observado: 3 px. É interseção de bounding boxes da fixture, não prova de cobertura alfa para arte corporal arbitrária.
- O override próprio de B muda a geometria da coxa esquerda em relação ao A na mesma pose. As demais transformações de A não contaminam B.
- O SHA-256 do manifesto de personagens e da árvore do Fabricador permaneceu igual durante o consumo pelas duas áreas.
- Os documentos das seis cenas e os hashes binários de seus snapshots foram verificados após iniciar um novo processo Electron.
- Foram reabertas no Electron as cenas finais de A e B, tanto no Studio normal quanto no Video Studio. A imagem renderizada foi comparada com o snapshot persistido com tolerância de canal 0 e proporção máxima de pixels alterados 0; houve **0 pixels divergentes** nos quatro casos.
- Capturas completas de tela, PNGs do personagem, diffs e métricas ficam no diretório de evidências do run acima. Os arquivos de saída são sintéticos e locais, fora do Git.

## Ajustes feitos no harness

- A seleção do personagem no modal de elenco agora aguarda o estado selecionado pelo React antes de salvar. Isso evita produzir uma cena vazia por uma corrida entre clique e atualização de estado.
- A espera de raster do Customizador exige pose e modelo esperados, ausência do indicador de carregamento e estabilidade do `img.src`; corrige leitura de uma camada antiga durante transição de pose.
- A comparação após reinício usa pixels decodificados, não apenas SHA binário do PNG. Isso permite distinguir recodificação sem perda de mudança visual.
- A reinicialização confere o hash salvo de todos os snapshots, mas reabre visualmente o último estado de cada personagem. Os cenários anteriores reutilizam A e alteram pose/roupa; o Video Studio atualiza cenas antigas quando detecta mudança posterior no personagem. Reabri-las como se o estado de origem ainda fosse o mesmo produziu uma comparação temporal inválida, corrigida no teste sem reduzir os critérios de imagem.
- O override próprio de B foi reduzido para deslocamento horizontal mantendo cobertura de joelho. O deslocamento maior ficou isolado no cenário A. A afirmação de independência continua verificada por diferença real da geometria de B e hashes do personagem.

## Validações executadas

`npm run audit:ipc` e a reexecução completa `npm run audit:all` — passaram no Windows. `audit:all` passou em typecheck, build, oito auditorias de domínio, isolamento Studio↔Video Studio e IPC de produção com captura da interface e novo processo Electron. `npm test` passou com 26 testes aprovados, zero falhas e 2 pulados por limitações locais de symlink; `npm run audit:boundaries:gate` passou sem regressões; `node --check` nos dois scripts alterados e `git diff --check` passaram.

As execuções exploratórias anteriores encontraram e ajudaram a corrigir: seleção de elenco salva antes do React aplicar a escolha; imagem antiga lida durante troca de pose; um bounding box de joelho inválido para o override maior de B; e comparação após reinício que tentava comparar cenas antigas com uma versão posterior do personagem. Essas falhas não foram ocultadas por tolerâncias mais amplas.

## Limites e status

- Modelo/poses/roupas A/B são sintéticos, publicados pela interface, mas as peças têm cores sólidas e partes retangulares. O caso prova as rotas e transformações cobertas, não fidelidade de formas e máscaras de roupas reais.
- Cabelo e acessórios de cabeça não fazem parte da autoria UI atual desta fixture e não são declarados como aprovados.
- A medição de joelho é uma interseção projetada das caixas de componentes, não uma análise de pele visível nas junções de assets reais.
- O pós-reinício valida o estado final salvo de cada personagem. Não avalia toda ordem possível de edições históricas concorrentes.
- Nenhum perfil ou biblioteca privada foi aberto, modificado ou usado na CI. Não houve sincronização ou publicação remota.

**AF-13 permanece parcial e aberto.** Esta entrega comprova paridade raster e geométrica do cenário sintético integrado, persistência de snapshots e isolamento A/B dentro do escopo acima. Não satisfaz a prova de cobertura de joelhos em arte real nem amplia evidência a cabelo/acessórios, então não fecha todos os critérios documentados.

## Preparação para a validação final do Prompt 5

1. Abrir manualmente um personagem real existente no Customizador e nos dois Studios com pose, roupa e acessórios equivalentes.
2. Conferir visualmente joelhos/camadas, ajustes individuais, cabelo e acessórios suportados pelo personagem.
3. Salvar, fechar completamente o app, reabrir e repetir a comparação.
4. Registrar para cada diferença a pose, categoria/peça, estado do ajuste e ambiente; não substituir evidência real por esta fixture sintética.

