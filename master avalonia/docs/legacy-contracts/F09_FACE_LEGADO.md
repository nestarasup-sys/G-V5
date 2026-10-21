# Contrato legado — face, olhos e extras de cabeça do Fabricador

Inspeção: 2026-10-21  
Escopo: F09.04 — folhas, peças, olhos/pupilas/sobrancelhas/nariz/boca, detalhes e extras de cabeça.  
Limite: leitura estática do código Electron no repositório; nenhum `app-data`, projeto pessoal ou arquivo de mídia do usuário foi aberto. Nenhuma interface Electron foi executada nesta tarefa.

Este documento descreve os contratos e caminhos encontrados no código. Não declara paridade do Avalonia, funcionamento em runtime do legado nem qualidade visual comparada por captura.

## Áreas e navegação

`FabricatorPage.tsx` encaminha para áreas distintas de **Olhos**, **Rosto** e **Cabeças extras**. Olhos e Rosto reutilizam `FaceComponentsWorkspace` com `mode="eyes"` ou `mode="face"`; Cabeças extras usa `HeadExtrasWorkspace`. As três áreas selecionam um dos dez slots de modelo e dependem de uma peça reconhecida como cabeça para permitir importação e prévia.

O editor de Olhos e Rosto segue a composição visual biblioteca à esquerda, canvas de cabeça no centro e controles à direita. O canvas mostra as peças selecionadas e guias. Importar abre um modal de formatos por modo; excluir abre outro modal com seleção em lote e confirma antes de apagar assets não legados.

## Tipos, categorias e formatos

Os contratos relevantes estão em `src/shared/fabricator.ts`:

| Tipo | Valores / dados | Uso |
| --- | --- | --- |
| `FaceSheetKind` | `eyes`, `eyebrows`, `nose`, `mouth-closed`, `mouth-open` | Categorias das folhas e dos catálogos antigos |
| `FaceElementKind` | olhos esquerdo/direito, sobrancelhas esquerda/direita, nariz, boca | Transform por elemento de um `FaceSet` |
| `FaceComponentKind` | `eye`, `pupil`, `eye-closed`, `eyebrow` | Assets independentes que podem ser escolhidos por lado |
| `FaceDetailKind` | `eye-highlight-left`, `eye-highlight-right`, `blush`, `facial-shadow` | Camadas de detalhe facial independentes |
| `FaceAssetKind` | tipos de componente + detalhes + `head-extra` | Tipo de asset da biblioteca por modelo |
| `FaceTransform` | `x`, `y`, `scaleX`, `scaleY`, `rotation`, `flipX?` | Encaixe individual; `flipX` permite espelhar o lado direito |
| `FaceCatalogItem` | categoria, folha, recortes, transforms, links, variantes e data | Catálogo de folhas/categorias, usado pelo editor de nariz e boca e pela compatibilidade legada |
| `FaceComponentAsset` | ID, slot de modelo, tipo, nome, dimensões, transform padrão, lado/pair opcional, data e pixels | Biblioteca de componentes e extras independentes |

O formato antigo `FaceSet` agrega folhas, peças, transformações, links de olho/sobrancelha e índices selecionados. `FaceSetSave` omite os Data URLs e mantém as referências às imagens separadas. O catálogo de itens também tem forma Save sem bytes embutidos. São estruturas distintas do asset independente `FaceComponentAsset`; a migração legada expõe itens de catálogos antigos na biblioteca atual.

## Folhas e processamento raster

### Olho, pupila e olho fechado

O modal de Olhos oferece uma folha vertical de três peças: **olho aberto**, **pupila** e **olho fechado**. `splitEyeSheet.ts` limita a imagem a 32 milhões de pixels, detecta um possível fundo uniforme pelos quatro cantos e remove somente a cor conectada às bordas. Em seguida procura dois intervalos vazios entre linhas ocupadas, corta cada uma das três bandas pelo alpha visível e preserva RGB/alpha dos pixels recortados. Se não encontrar separadores ou uma das bandas estiver vazia, retorna erro explícito.

Cada peça produz dois assets, esquerdo e direito. A importação registra `pairId` para manter o par da mesma origem, configura transform inicial em relação ao tamanho da cabeça e espelha X/rotação para o lado direito. Se houver calibração “Auto fixar”, as medidas de olho/pupila/olho fechado importadas são ajustadas aos anchors previamente capturados do modelo. O olho fechado pode ajustar sua largura/posição para acompanhar o olho aberto; a importação rejeita escala que ultrapasse o limite 20. Se uma das gravações parciais falhar, os assets já gravados nessa importação são removidos por compensação.

`faceProcessor.worker.ts` oferece outra segmentação de folhas: amostra o fundo, remove a máscara candidata apenas quando conectada à borda, aplica despill e recorta as regiões. Para `eyes`, procura três bandas verticais e divide cada uma em esquerdo/direito; para `eyebrows`, processa uma região e divide em dois lados. Para `nose`, aceita um nariz, seis em grade 3×2 ou detecção automática dessa grade. `mouth-closed` e `mouth-open` dividem a folha em 21 células, grade 7×3. Os recortes escolhidos podem ser fornecidos por ID para reaproveitar limites manuais.

**Lacuna observada no código da interface atual:** a biblioteca possui a categoria `eyebrow`, o tipo de folha antigo também a define e o worker sabe dividir sobrancelhas, mas o modal de importação atual do modo Olhos só mostra o importador de três peças de olho. Não há no `FaceComponentsWorkspace.tsx` um input de arquivo que invoque o caminho `eyebrows` do worker. Sobrancelhas podem continuar disponíveis via assets existentes/migração, mas um caminho novo de importação precisa ser confirmado e reconstruído sem presumir que o tipo do backend é um botão disponível.

### Nariz e boca

O modo Rosto oferece:

- Nariz único ou seis narizes em grade 3×2.
- Boca fechada ou boca aberta, cada folha com 21 variantes em grade 7×3.
- Seleção de variante do catálogo, encaixe próprio e, no nariz, opacidade de 0 a 1.

O worker remove o fundo conectado à borda e despilla antes dos recortes. A folha original é mantida como PNG separado do manifesto. Cada variante guarda índice, crop, dimensões e um transform associado ao elemento (`nose` ou `mouth`). Os transforms iniciais dependem da largura/altura da cabeça e da categoria. A prévia da boca aberta escala proporcionalmente ao transform de referência da boca fechada para manter o alinhamento.

### Sobrancelha verde

Para uma sobrancelha existente, o controle “Remover fundo verde da sobrancelha salva” estima o verde em amostras da borda, remove apenas pixels candidatos conectados à borda, reduz spill e pode preservar as dimensões originais da peça para manter a posição/escala. A rotina alternativa de trim recorta o alpha restante. Ela não é o importador de sobrancelha nem substitui o chroma geral das folhas.

### Detalhes faciais

O catálogo independente possui dois destaques de olho (`eye-highlight-left/right`), `blush` e `facial-shadow`. São imagens PNG independentes, com transform inicial por categoria, dimensões medidas e seleção por slot de modelo. A prévia compõe os detalhes selecionados em conjunto e permite arrastar o detalhe da categoria ativa; o transform atualizado é salvo no asset. Seus efeitos parametrizados de expressão são outro contrato: F09.09 já implementa os valores/defaults, interpolação e rasterização CPU; presets, collections e persistência ficam em F09.10+.

## Edição e preview

- Olhos, pupilas, olhos fechados e sobrancelhas têm seleção por lado. A opção “Espelhar imagem da esquerda” liga/desliga o par; selecionar um lado sem asset cria uma cópia espelhada da peça oposta quando possível.
- “Mover junto” expõe controles pareados de posição e largura/altura; para olhos também existe distância horizontal entre os dois olhos. Com o modo desligado, o lado ativo recebe ajustes individuais.
- A prévia responde a drag no canvas, com guias para eixo vertical inclinado e duas referências horizontais. Há nudges/setas, sliders para posição, escala por eixo e rotação entre −180° e 180°; nariz também tem transparência. Reset restaura o transform inicial.
- A calibração “Auto fixar” captura dimensões e transforms dos pares existentes para ajustar importações futuras de olho, pupila e olho fechado daquele slot.
- Máscara de interior do olho (`eyeInteriorMask.ts`) deriva alfa da luminância, mantendo contorno escuro fora da máscara e interior claro dentro; cache em memória limitado a 48 imagens.
- Extras de cabeça mostram uma peça `head-extra` sobre o asset reconhecido como `head`/`cabeça`. O arraste altera centro X/Y; sliders ajustam horizontal, vertical, largura, altura e rotação; reset restaura o encaixe inicial. O transform é normalizado aos limites do canvas e a no máximo duas vezes a dimensão da cabeça.
- O worker de extras estima a cor verde nas bordas, remove matiz verde com feather e despill, encontra bounds alpha com padding e recorta. Imagem acima de 32 milhões de pixels ou completamente removida falha sem gravar um asset vazio.

## Persistência e limites do backend legado

O processo principal valida IDs, modelo/slot, dimensões, nome e transforms antes de gravar. As regras encontradas incluem:

- Slots de modelo de 1 a 10; imagens com dimensões positivas e até 32 milhões de pixels.
- `FaceSet` limitado a 60 peças; índice de nariz 0–5 e índice de expressão 0–20.
- IDs de catálogos faciais até 120 caracteres; componentes e assets de rosto até 80 caracteres no padrão aceito, nome do componente até 120 caracteres.
- Transforms finitos com escalas positivas; componentes limitam cada escala a 20 e aceitam `flipX` booleano.
- `FaceSet` e `FaceCatalogItem` exigem transforms dos elementos requeridos para sua categoria e consistência entre `sheet.kind` e categoria.
- Gravação de conjuntos e itens escreve PNGs separados antes do manifesto temporário e faz rename do manifesto. `FaceComponentAsset` grava `asset.png` e depois `asset.json.tmp` → `asset.json`. A listagem carrega resumos; abrir carrega a imagem completa.
- Remoção do catálogo protege itens com prefixo `legacy_` no modal. A importação de pares compensa exclusão dos assets já gravados se uma etapa falhar.
- Assets ficam por slot de modelo: `fabricator/faces/model-{n}/set-{id}`, `catalog/item-{id}`, e `fabricator/face-components/model-{n}/item-{id}`. Os PNGs não fazem parte dos JSONs de metadados.
- Guias têm perfil `eyes` ou `face`, validação compartilhada e arquivo em `fabricator/guides-{profile}.json`; o leitor do perfil `face` incorpora valores antigos do perfil de olhos.
- Seleções por componente, detalhes, anchors de importação e alguns guias também são espelhados em `localStorage` por slot. Essas preferências locais não são o manifesto dos assets; a nova aplicação deve manter a fonte canônica no DataPlatform e migrá-las de forma delimitada.

## Regras de reconstrução para Avalonia

1. Manter separados catálogo de folha e biblioteca de assets independentes; não converter tudo silenciosamente para uma classe única.
2. Preservar os lados, IDs de par, seleção linked/move-together, âncoras de calibração e transform por componente.
3. Tratar olho aberto, pupila e olho fechado como três tipos de saída; o corte de uma fonte vertical não significa que a fonte tinha uma grade fixa de alturas.
4. Preservar queixas de importação: falta de separador, área vazia, limite de pixels, PNG inválido e falha no meio não podem deixar assets parciais visíveis.
5. Reconstruir o importador de sobrancelha como função real e testada. O contrato de domínio existente não prova que a interface legada tem um botão atual para essa operação.
6. Detalhes, nariz e bocas precisam de transform independente; nariz retém opacidade e boca aberta/fechada precisa manter calibração visual conjunta.
7. Head extras têm asset próprio e transform no espaço da cabeça; não devem se misturar a cabelos nem a pixels do modelo-base.
8. Não copiar Data URLs, `localStorage` ou gravação JSON como arquitetura nova; usar IDs estáveis, AssetStore, referências, SQLite e snapshots previstos no plano.

## Fontes consultadas (estáticas)

- `src/shared/fabricator.ts` — contratos FaceSet, FaceCatalogItem, FaceComponentAsset, FaceExpression e limites/IDs compartilhados.
- `src/renderer/src/features/fabricator/face/FaceComponentsWorkspace.tsx` — categorias, seleção, import/export, controles, previews e limpeza de sobrancelha.
- `src/renderer/src/features/fabricator/face/faceProcessor.worker.ts` — chroma, bandas e splitting das folhas.
- `src/renderer/src/features/fabricator/face/splitEyeSheet.ts` — detecção das três bandas e recorte olho/pupila/olho fechado.
- `src/renderer/src/features/fabricator/face/faceImportAlignment.ts` — anchors, lado direito e alinhamento do olho fechado.
- `src/renderer/src/features/fabricator/face/eyeInteriorMask.ts` e `removeEyebrowGreen.ts` — máscara do interior do olho e chroma da sobrancelha.
- `src/renderer/src/features/fabricator/face/HeadExtrasWorkspace.tsx` e `headExtraChroma.worker.ts` — catálogo, encaixe e chroma de extras.
- `electron/main.ts` — validators, migração/listagem, escrita dos assets separados, guias e canais Desktop API de face.
