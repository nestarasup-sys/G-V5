# Publicações e dependências de face e expressão

Este contrato registra o fluxo técnico de revisões imutáveis de cabelo, catálogo facial e presets de expressão implementado em F09.03/F09.11. Ele não declara a interface do Fabricador integrada nem paridade visual concluída.

## Cadeia de publicação

- `HairStyleDraft` já publica snapshots append-only em `hair_revisions`. Cada revisão tem ID estável, sequência por penteado, referência exata ao modelo, revisão de origem, timestamp e SHA-256. Assets de cabelo são referenciados pela publicação, além das referências do draft.
- `FaceCatalogDraft` publica para `face_revisions` depois de validar a revisão otimista, a publicação exata do modelo e a disponibilidade de todos os assets. A sequência é monotônica por catálogo. A referência de assets é copiada para o proprietário imutável da revisão.
- `FaceExpressionPresetDraft` publica para `face_expression_revisions` apenas quando o catálogo facial mais recente já está publicado e corresponde à revisão facial pinada pelo preset. A revisão publicada mantém FK `RESTRICT` para o preset e para a revisão facial.
- Repetir uma publicação sem editar o draft é idempotente para a mesma revisão do draft e a mesma revisão facial. Uma revisão nova de draft gera uma nova revisão publicada; nenhum snapshot anterior é sobrescrito.
- Tabelas de publicação têm triggers que rejeitam `UPDATE` e `DELETE`. Snapshots carregados são verificados pelo checksum e comparados aos IDs, sequência, face, face revision e modelo duplicados nas linhas relacionais.

## Proteção de assets e exclusões

- Assets de uma publicação facial continuam referenciados mesmo que uma edição futura do draft retire o componente.
- Expressões publicadas dependem da revisão facial imutável que as fundamenta. A FK também impede apagar o preset ou a coleção enquanto houver publicação.
- `IFabricatorDependencyCatalog` agora consulta usos de modelo, pose, roupa, cabelo, face, collection e preset. Revisões imutáveis são dependências bloqueantes; ausência ou corrupção de dados não equivale a autorização para remover.
- As consultas incluem drafts e publicações de face/expressão na avaliação de uso do modelo, além de publicações de cabelo.
- Repositórios de cabelo e face não expõem exclusão destrutiva nesta fase. O catálogo permite que futuros casos de uso apresentem os dependentes e neguem uma remoção segura.

## Evidência

`TestarLocal.bat rapido` em 2026-10-21 passou com build Debug e 299 testes, sem falhas. Os testes SQLite cobrem round-trip e reabertura, pinning, idempotência de publicação facial, publicação de preset somente após publicar a face, referência para o ID exato da revisão facial, revisão imutável, bloqueio de exclusão e consultas de dependências por modelo/face/collection/preset. Hair mantém sua cobertura de publicação append-only existente em `SqliteHairStyleRepositoryTests`.

## Limites desta entrega

- A UI de edição/publicação ainda precisa consumir esses contratos.
- Integração de cabelo, face, roupa e corpo ao builder unificado é F09.12.
- Captura interativa Windows, comparação visual do Electron e GPU não foram executadas nesta tarefa.
