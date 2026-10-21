# ADR-0005 — Contrato de modelo e conteúdo versionado do Fabricador

- **Estado:** aceito para F06.01
- **Data:** 2026-10-21
- **Escopo:** `GV5.Core` e `GV5.Geometry`; não implementa UI nem persistência do conteúdo

## Contexto

O Fabricador Electron representa modelos em dez slots numéricos, partes por IDs de string, ordem de desenho opcional e `sourceTransform` opcional. Os PNGs são arquivos separados dos manifests. A reconstrução precisa de identidade tipada, revisão estável e ordem explícita sem adotar os caminhos ou IDs físicos do Electron como formato interno.

O G-V5 já possui `ModelDraft` para metadados e concorrência otimista. CRUD de drafts e persistência do conteúdo de peças continuam nas tarefas F06.02 e F06.05; esta decisão define os contratos que essas tarefas deverão salvar.

## Decisão

- `ModelSlot` é um valor tipado de 1 a 10 e não é identidade do modelo. `ModelId` identifica o draft; `ModelPartId` identifica a peça; `AssetId` referencia bytes no AssetStore.
- `ModelDraftContent` é um snapshot imutável, com `SchemaVersion` distinto de `Revision`. A revisão identifica a sequência de edições do mesmo draft; a versão de schema identifica o formato serializado.
- Source asset ID e dimensões são um conjunto opcional indivisível. Um conteúdo com peças deve manter o source asset. Dimensões, IDs e slot inválidos são rejeitados antes da persistência.
- Cada `ModelPart` mantém um `AssetId`, crop, transform editável e `ModelPartSourceTransform` imutável para restauração. `Transform2D` usa as unidades e o sentido definidos em ADR-0001; conversores de dados Electron devem normalizar graus e campos opcionais antes de criar a entidade.
- `LayerOrder` é back-to-front e enumera cada ID de parte exatamente uma vez. Seleção e outros estados transitórios de editor não pertencem ao snapshot persistente.
- O Core pode consumir valores geométricos puros de `GV5.Geometry`; Geometry não depende de Core. Nenhum dos dois depende de Avalonia.
- O schema inicial é 1. Versões desconhecidas são rejeitadas explicitamente. Migrações/serialização e gravação atômica serão definidas nas tarefas de persistência, sem alterar a identidade ou apagar revisões anteriores.

## Consequências e evidência

Slots 1–10 preservam compatibilidade sem tornar a posição da lista uma chave. Snapshots imutáveis permitem undo e revisão sem mutar a origem. Uma ordenação canônica e referências tipadas facilitam renderização, reabertura e validação de integridade.

`ModelDraftContentTests` cobre limites de slot, IDs, versão e revisão, origem/asset, transform imutável, ordem, crops fora da folha e valores inconsistentes. `TestarLocal.bat rapido` cobre também build da solution, testes arquiteturais, suites de módulos e Avalonia Headless. A aprovação desta tarefa não afirma persistência de peças, importação, UI ou paridade visual; esses pontos permanecem para as tarefas/gates correspondentes.

F06.02 acrescenta listagem e duplicação transacional dos metadados de `ModelDraft`; como a persistência do snapshot de peças ainda pertence a F06.05, duplicar nesta etapa cria um novo draft vazio com nome e timestamps próprios. A duplicação deverá passar a copiar o snapshot validado quando o armazenamento de conteúdo for integrado.

## Referências de produto

- `docs/legacy-contracts/FABRICADOR_INVENTARIO.md`
- `docs/legacy-contracts/FORMATOS_E_IDS_ELECTRON.md`
- `PLANO_MESTRE_EXECUCAO_CODEX.md`, gate F06 e tarefa F06.01
