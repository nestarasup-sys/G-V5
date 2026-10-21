# Contrato legado — Cabelos do Fabricador e Customizador

Inspeção: 2026-10-21  
Escopo: F09.01, inventário estático de categorias, paletas, máscaras/processamento, edição e persistência.  
Limite: consultar apenas código; nenhum `app-data`, projeto pessoal ou imagem do usuário foi aberto.

Este documento registra o comportamento expresso no código Electron. Não afirma que os fluxos foram testados em execução nem define paridade visual Avalonia.

## Categorias e partes

O contrato de personagem tem cinco `HairPartId` independentes:

| ID | Nome exibido no Fabricador | Slot interno de imagem | Uso/composição |
| --- | --- | --- | --- |
| `backHair` | Cabelo traseiro | `back` | Camada de cabelo atrás do personagem |
| `rearHair` | Cabelo posterior | `front` | Parte posterior/coroa usada sobre a cabeça |
| `ponytail` | Rabo de cavalo | `back` | Variante selecionável no mesmo slot `back` |
| `frontHair` | Franja frontal | `fringe` | Camada frontal |
| `ahoge` | Ahoge | `fringe` | Variante selecionável no mesmo slot `fringe` |

O nome legado `front` significa slot da peça “Cabelo posterior” (`rearHair`); não deve ser renomeado por inferência para `frontHair`. Uma folha importada divide a metade superior em `front`/`rearHair` e a inferior em `back`/`backHair`. A franja é importada separadamente.

`HairWorkspace` armazena três slots (`front`, `back`, `fringe`), cada qual com uma transformação e uma categoria opcional em `categoryBySide`. Assim, `ponytail` compartilha o único slot `back` com `backHair`, e `ahoge` compartilha `fringe` com `frontHair`; o workspace não guarda simultaneamente duas variantes no mesmo slot. Um `HairStyle` leva uma categoria singular. Estilos antigos sem categoria continuam compatíveis pela regra padrão por slot: `front`→`rearHair`, `back`→`backHair`, `fringe`→`frontHair`.

`hairStyleSupportsCategory` exige que o slot da categoria tenha asset e, quando há categoria explícita, que ela corresponda. A biblioteca por modelo filtra cada categoria e mostra apenas o slot associado. A seleção no Customizador também pode sobrescrever cada `HairPartId` de forma independente.

## Importação, separação e remoção de fundo

- Folha: PNG/JPEG/WebP. A importação converte para PNG, preserva a folha original para reaplicações e envia o processamento a um Web Worker com `OffscreenCanvas`.
- A folha é dividida horizontalmente em duas metades: superior (`floor(height/2)`) e inferior (o restante). Limite verificado pelo worker: 32 milhões de pixels. Cada metade precisa conter pelo menos um pixel não transparente após o chroma; o crop final remove margens transparentes.
- Modos: `auto`, `green` e `checker`; tolerância entre 0–100. O auto estima cor verde nas bordas por mediana; se não houver evidência suficiente, detecta dois tons neutros de quadriculado. A máscara candidata só apaga pixels conectados às bordas, preservando regiões internas da mesma cor.
- O worker ignora alpha menor que 12 ao estimar amostras e usa pixels elegíveis/alpha existente ao segmentar. No modo verde, aplica despill suave nos pixels verdes restantes. Com tolerância zero, não remove cor de fundo.
- A ação “Aplicar chroma” sempre parte da imagem original salva, evitando degradar a peça em reaplicações. Ajusta o encaixe pelo fator entre dimensões antigas e novas para preservar a escala visual.
- Peça única: PNG/WebP transparente, carregada no slot/categoria atual sem chroma. A folha e cada asset são separados do manifesto no disco.
- O crop da folha é retangular pelo alpha restante; o código não cria máscaras semânticas persistidas para cabelo, rosto ou mechas.

## Encaixe, edição e borracha

`HairTransform` contém `x`, `y`, `scaleX`, `scaleY`, `rotation` e `flipX` opcional. A escala X/Y é independente; o preview permite arrastar, rotação ±180°, espelhamento horizontal, reset e zoom de 50% a 300%.

Encaixe inicial em relação à peça `head` do modelo:

- Franja: largura de 105% e altura de 55% da cabeça, centrada em X, Y a 29% da altura.
- Posterior/traseiro: largura de 112% e altura de 92%, centrados em X e Y a 49% da altura.
- A escala persistida é convertida dessas dimensões desejadas pelos pixels do asset.

O apagador trabalha no canvas do asset selecionado. Reverte rotação, flip horizontal e escala do preview para mapear o ponteiro aos pixels originais, apaga com `destination-out`, e mantém até dez traços locais de desfazer. Cancelar o gesto restaura o bitmap no início do traço; salvar persiste os pixels editados.

Validação do backend exige dimensões positivas até 32 milhões de pixels; X/Y finitos com magnitude máxima 100.000; escala positiva até 20; rotação finita; e `flipX` booleano. Slot vazio normaliza para transformação identidade. Não há `flipY` no contrato legado.

## Paletas e máscaras de cor

O Customizador oferece cinco roles para recoloração: `base`, `fade`, `outline`, `highlight` e `accent`. Defaults: base `#9b563e`, fade `#633b37`, outline `#392b33`, highlight `#e5ad83`, accent `#cf6391`.

As paletas predefinidas em código são: Castanho, Loiro, Preto, Fantasia, Chocolate, Cobre, Ruivo, Mel, Platinado, Branco, Cinza, Azul noite, Céu, Menta, Rosa, Vinho, Lilás, Pêssego, Verde musgo e Turquesa. Os cinco overrides podem ser globais ao cabelo do personagem ou específicos por `HairPartId`; ficam em `CharacterCustomization`, não alteram assets publicados do Fabricador.

O código não guarda uma mask bitmap persistente por role. O Customizador deriva um perfil da imagem em memória: usa pixels com alpha ≥160, percentis de luminância 1%/98%, histograma de 24 faixas de hue e identifica accent quando há mais de 3% de pixels cromáticos. Pixels recebem role por saturação, distância de hue e faixas relativas de luminância. O recolor preserva a razão de brilho dentro de 0,48–1,52. O helper compartilhado aceita uma opção genérica para preservar near-white e liberar roles manuais, mas as chamadas atuais de preview de cabelo não passam esses parâmetros; não existe lista manual de roles por cabelo no contrato.

As cores/roles são metadados persistidos por personagem; a máscara de classificação é recalculada na prévia e armazenada num cache limitado a 40 imagens tintadas. Uma falha ao carregar o asset usa o fluxo de erro de imagem; não se modifica a imagem-fonte do catálogo.

## Catálogo, gravação e remoção

- O workspace editável é isolado por slot de modelo e salvo manualmente. Manifesto `hair.json`; PNGs da folha e slots em `images/`. O manifesto usa escrita temporária e rename; imagens são escritas antes dele e não se embutem em base64 como identidade no armazenamento.
- Estilos publicados ficam em `styles/style-{id}/hair-style.json` mais imagens separadas. IDs por modelo, nome até 80 caracteres, schema 1, data de criação/atualização, categoria opcional, assets e transforms. Publicar um estilo salva também o workspace primeiro.
- A listagem primeiro carrega resumos e depois cada estilo/asset para compor a biblioteca. Abrir um estilo substitui o slot/categoria atual em memória; se há alterações pendentes, pede confirmação. Salvar em outra categoria cria uma cópia; atualizar só mantém o ID ativo quando categoria coincide.
- Excluir estilo pede confirmação e remove do catálogo do modelo. O aviso legado diz que personagens que usam o estilo deixarão de encontrá-lo; não há bloqueio por dependentes nem soft delete nesse caminho.
- Migração lazy converte workspace antigo para o estilo `legacy-workspace`; estilos antigos sem categoria usam a regra de fallback já descrita.

## Diferenças a manter visíveis durante a reconstrução

1. O modelo de dados chama uma parte de `rearHair`, que a UI apresenta como “Cabelo posterior”; o slot é `front`. Manter a distinção entre ID semântico e nome do slot.
2. `ponytail`/`backHair` e `ahoge`/`frontHair` compartilham slots, portanto não são simultaneamente selecionáveis no mesmo workspace/estilo. Se isso for expandido, tratar como melhoria funcional explícita em vez de migrar silenciosamente IDs.
3. Chroma de borda e classificação de roles são operações diferentes: a primeira remove pixels conectados ao contorno da folha; a segunda calcula roles de cor transientes para recoloração.
4. Borracha altera pixels raster do estilo aberto, com desfazer limitado à sessão; transforms são dados separados.
5. A exclusão atual é destrutiva e só avisa sobre personagens consumidores. A reconstrução deve usar IDs/referências e proteção de dependências da arquitetura nova, sem copiar essa fragilidade.

## Referências estáticas

- `src/shared/customizer.ts`: `HairPartId`, `HairColorRole`, `hairAppearance` e overrides por peça.
- `src/shared/fabricator.ts`: `HairWorkspace`, `HairStyle`, transforms e contratos de Desktop API.
- `src/shared/hairCategories.ts` e `src/shared/hairPersistence.ts`.
- `src/renderer/src/features/fabricator/HairWorkspace.tsx`, `HairPiecePreview.tsx`, `hairEraser.ts` e `hairProcessor.worker.ts`.
- `src/renderer/src/features/customizer/CustomizerPage.tsx`: paletas, perfil/roles de pixels e recoloração.
- `electron/main.ts`: validação, leitura/escrita e migração do workspace/catálogo de cabelo.
