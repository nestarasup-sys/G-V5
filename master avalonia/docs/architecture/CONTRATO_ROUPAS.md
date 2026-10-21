# Contrato de domínio de roupas

Escopo F08.02: contrato puro de domínio, sem UI, persistência ou publicação orquestrada. A roupa referencia assets por `AssetId` e um modelo imutável por `ModelRevisionReference`; nenhuma imagem é embutida no domínio.

## Modelo

- `WardrobeSet` é o rascunho mutável por comandos: `WardrobeId` estável, referência exata da publicação do modelo, `Revision` própria e uma coleção imutável de componentes. `WithContent` cria outra instância e incrementa apenas a revisão do conjunto. O limite do domínio é 100 componentes; rascunho vazio é aceito.
- `WardrobeComponent` tem `WardrobeComponentId`, nome, `WardrobeCategory`, `ModelPartId` do osso, `AssetId`, retângulo de colocação na folha-fonte, rotação em graus e `WardrobeBinding` versionado. O asset contém os pixels; `Placement` representa a geometria autoral no espaço do modelo.
- `WardrobeBinding` registra a relação normalizada entre peça e osso na geometria de origem. Reidratação valida a versão, valores finitos, dimensões positivas e proporções positivas. O ID do osso precisa coincidir com o ID estável da peça que o componente declara.
- `WardrobeComponentEditorSession` exige a mesma publicação de modelo pinada pelo conjunto, constrói frames a partir do crop/transform imutável de cada peça e rejeita componentes/ossos inexistentes. Reassociar mantém a geometria da roupa na folha e recalcula o binding para o osso escolhido. Move, escala independente X/Y ao redor do centro e rotação absoluta geram revisão de rascunho nova e binding recalculado; os snapshots anteriores permanecem intactos.
- O histórico da sessão guarda comandos imutáveis por componente (até 50). Undo/redo restaura apenas o componente do comando; cada operação cria uma revisão nova e monotônica do rascunho, sem alterar o estado de outros componentes. Uma edição após Undo invalida o ramo de Redo; chamadas sem histórico retornam `false` sem alterar o rascunho.
- `WardrobePoseResolver` só resolve quando o conjunto, pose e modelo apontam à mesma publicação exata. Para cada componente, confere se osso e frame congelado ainda correspondem à geometria-fonte e projeta binding sobre o transform da peça na pose, incluindo escala desigual, rotação e flips. O resultado contém AssetId, categoria e placement efêmero; nem roupa nem pose são modificadas.
- Composição tem duas fases explícitas: `AttachedToBodyLayer` posiciona a peça logo após desenhar seu osso no índice da ordem de camadas publicada; `AboveHair` reserva a fase final para óculos/acessórios de cabeça que optaram por isso. Componentes comuns não podem ativar a fase sobre cabelo. A ordenação é determinística: índice do osso, sequência autoral dos componentes e, por último, sequência autoral dos head extras.
- `PublishedWardrobeRevision` é um snapshot imutável com ID próprio, sequência de publicação, revisão editável de origem, referência do modelo, data UTC, SHA-256 e cópia da coleção de componentes. Alterar o rascunho depois da publicação não modifica o snapshot.
- `IWardrobeCatalog` filtra componentes de publicações pela referência exata da revisão do modelo e categoria opcional. Pages limitadas ordenam por data de publicação, ID da revisão e ID do componente, com cursor composto estável. A janela de thumbnails usa o serviço central com prefetch limitado e streams de propriedade do chamador; não carrega imagens fora do page enviado pelo catálogo.

## Categorias

`WardrobeCategory` enum define as quinze categorias vigentes do Fabricador: shirt, jacket, upper/lower sleeve, gloves, cape, belt, glasses, head accessory, skirt, thigh/calf pants, shorts, socks e shoes. Rótulos/localização pertencem à UI. Categorias e conversões V1/V2 do Electron ficam no importador legado e no contrato [F08_ROUPAS_LEGADO.md](../legacy-contracts/F08_ROUPAS_LEGADO.md); não se converte dados antigos por enum ordinal.

## Regras de fronteira

- Revisão de roupa e revisão de modelo são independentes; cada conjunto fica preso à revisão exata do modelo que fornece seus ossos.
- `AssetId` referencia bytes geridos pelo AssetStore. F08.03 prepara um crop PNG alpha-preserving em staging, oferece uma prévia reduzida e só publica depois da confirmação; cancelamento limpa o stage. Limites de bytes/dimensões, hash e validação do decoder ficam antes da publicação.
- Publicar exige ao menos um componente, horário não negativo e hash SHA-256 hexadecimal de 64 caracteres. Sequenciamento concorrente, dependências reversas e pinning de consumidores serão responsabilidade dos serviços/repositórios nas tarefas seguintes.
- O domínio valida estrutura e vínculo ID/osso; confirmar que o osso existe na publicação exata requer carregar essa publicação no serviço. Não aceitar gravação órfã no repositório.
- Renderização em pose usa `GV5.Geometry.WardrobeBindingMath`; o Core não depende de Avalonia, Skia nem Electron.

## Arquivos e cobertura

- `src/GV5.Core/Models/WardrobeSet.cs`
- `src/GV5.Core/Models/PublishedWardrobeRevision.cs`
- `src/GV5.Core/Identity/EntityIds.cs`
- `src/GV5.Geometry/WardrobeBindingMath.cs`
- `tests/GV5.Core.Tests/WardrobeContractTests.cs`

O serviço atual consulta snapshots imutáveis fornecidos pelo limite de dados; o repositório SQLite e o fluxo de publicação ficam em F08.09. UI de seleção/edição e integração visual dos serviços com a tela ainda estão pendentes. A matriz mantém paridade de roupas pendente até completar persistência, composição de camadas e interação visual.
