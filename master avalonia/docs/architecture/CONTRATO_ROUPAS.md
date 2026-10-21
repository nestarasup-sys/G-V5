# Contrato de domínio de roupas

Escopo F08.02: contrato puro de domínio, sem UI, persistência ou publicação orquestrada. A roupa referencia assets por `AssetId` e um modelo imutável por `ModelRevisionReference`; nenhuma imagem é embutida no domínio.

## Modelo

- `WardrobeSet` é o rascunho mutável por comandos: `WardrobeId` estável, referência exata da publicação do modelo, `Revision` própria e uma coleção imutável de componentes. `WithContent` cria outra instância e incrementa apenas a revisão do conjunto. O limite do domínio é 100 componentes; rascunho vazio é aceito.
- `WardrobeComponent` tem `WardrobeComponentId`, nome, `WardrobeCategory`, `ModelPartId` do osso, `AssetId`, retângulo de colocação na folha-fonte, rotação em graus e `WardrobeBinding` versionado. O asset contém os pixels; `Placement` representa a geometria autoral no espaço do modelo.
- `WardrobeBinding` registra a relação normalizada entre peça e osso na geometria de origem. Reidratação valida a versão, valores finitos, dimensões positivas e proporções positivas. O ID do osso precisa coincidir com o ID estável da peça que o componente declara.
- `PublishedWardrobeRevision` é um snapshot imutável com ID próprio, sequência de publicação, revisão editável de origem, referência do modelo, data UTC, SHA-256 e cópia da coleção de componentes. Alterar o rascunho depois da publicação não modifica o snapshot.

## Categorias

`WardrobeCategory` enum define as quinze categorias vigentes do Fabricador: shirt, jacket, upper/lower sleeve, gloves, cape, belt, glasses, head accessory, skirt, thigh/calf pants, shorts, socks e shoes. Rótulos/localização pertencem à UI. Categorias e conversões V1/V2 do Electron ficam no importador legado e no contrato [F08_ROUPAS_LEGADO.md](../legacy-contracts/F08_ROUPAS_LEGADO.md); não se converte dados antigos por enum ordinal.

## Regras de fronteira

- Revisão de roupa e revisão de modelo são independentes; cada conjunto fica preso à revisão exata do modelo que fornece seus ossos.
- `AssetId` referencia bytes geridos pelo AssetStore. Recorte/transparência, hash de conteúdo, thumbnail e validação do decoder são responsabilidade da importação F08.03.
- Publicar exige ao menos um componente, horário não negativo e hash SHA-256 hexadecimal de 64 caracteres. Sequenciamento concorrente, dependências reversas e pinning de consumidores serão responsabilidade dos serviços/repositórios nas tarefas seguintes.
- O domínio valida estrutura e vínculo ID/osso; confirmar que o osso existe na publicação exata requer carregar essa publicação no serviço. Não aceitar gravação órfã no repositório.
- Renderização em pose usa `GV5.Geometry.WardrobeBindingMath`; o Core não depende de Avalonia, Skia nem Electron.

## Arquivos e cobertura

- `src/GV5.Core/Models/WardrobeSet.cs`
- `src/GV5.Core/Models/PublishedWardrobeRevision.cs`
- `src/GV5.Core/Identity/EntityIds.cs`
- `src/GV5.Geometry/WardrobeBindingMath.cs`
- `tests/GV5.Core.Tests/WardrobeContractTests.cs`

Persistência SQLite, integração com AssetStore, resolução de binding contra uma publicação carregada e UI ainda não fazem parte de F08.02.
