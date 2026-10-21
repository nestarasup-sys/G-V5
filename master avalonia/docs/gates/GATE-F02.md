# GATE-F02 — SQLite, revisões e recuperação

- **Resultado:** PASSOU para a fase F02.
- **Data:** 2026-10-21.
- **Branch:** `Master-AValonia`.
- **HEAD validado:** `a4d6738` (inclui F02.14 e seu registro de validação).
- **Ambiente:** Windows x64; SDK/runtime portátil .NET `10.0.402` / `10.0.13`.
- **Escopo:** infraestrutura SQLite implementada até F02: migrations numeradas, repositório inicial de modelos, gravação incremental com revisão otimista, autosave/checkpoint, backup/restauração e logs de diagnóstico. Este gate não fecha G1, que ainda depende de F03–F05.

## Comandos e resultados

| Comando | Resultado |
| --- | --- |
| `cmd /c "TestarLocal.bat gate"` | PASSOU; restore da solution e do projeto Headless concluíram sem baixar/restaurar mudanças pendentes. |
| Build Release da solution | PASSOU; 0 warnings, 0 errors; todos os projetos da solution foram compilados. |
| Testes Release da solution | Core 8/8, Arquitetura 4/4, Data 27/27; 0 falhas. |
| Testes Avalonia Headless Release | 15/15; 0 erros, falhas ou skips; sem janela visível. |
| `git diff --check` | PASSOU antes dos commits da tarefa e deste gate. |

O script invoca o SDK portátil declarado em `global.json`; `dotnet test` global não é a evidência deste gate porque a instalação global do Windows não contém o runtime .NET 10 usado pela solution.

## Schema SQLite atual

O arquivo fica em `database/gv5.sqlite3`, sob a raiz resolvida por `IAppDataPaths`. As conexões usam foreign keys, WAL, `busy_timeout=5000`, `synchronous=FULL`; leitura aplica `query_only`. Escritas passam por transação imediata sob gate serializador.

| Versão | Migration | Estrutura executável |
| ---: | --- | --- |
| 1 | `initial-asset-metadata` | `assets`, `asset_derivatives`, constraints de ID/hash/tamanho/estado e índices; binários ainda não são geridos pelo AssetStore. |
| 2 | `model-draft-metadata` | `models` com ID, revisão, nome e datas, mais índice de atualização. |
| 3 | `model-draft-checkpoints` | `model_draft_checkpoints` com ID, modelo, revisão esperada, nome e data, mais índice para recuperação. |

`schema_migrations` guarda versão, nome e SHA-256 do SQL aplicado. O runner exige sequência contígua e checksum invariável, rejeita schema futuro e executa o lote sob uma única transação.

## Evidência de persistência e recuperação

- **Reabertura de migrations:** `SqliteMigrationRunnerTests.MigrateAsync_CreatesSchemaRecordsVersionAndDoesNotRepeatAfterReopen` aplica a versão inicial, grava um asset sintético, fecha o objeto de banco, reabre o mesmo arquivo e comprova versão, dado preservado, ausência de reaplicação e `integrity_check=ok`.
- **Reabertura do agregado:** `SqliteModelDraftRepositoryTests` comprova criação/atualização e leitura após novo repositório/banco, revisão monotônica, validações e conflitos entre escritores.
- **Autosave e crash recovery:** testes Headless de F02.10/F02.11 comprovam debounce, flush antes de navegação/fechamento, checkpoint write-ahead em SQLite de arquivo e restauração por novo ViewModel depois de falha injetada. Conflito conserva a revisão mais recente e o checkpoint.
- **Backup com WAL e restore:** `DatabaseBackupServiceTests.OnlineBackup_CapturesCommittedWalState_AndRestoresVerifiedDataToIsolatedRoot` mantém uma leitura antiga aberta para manter WAL, faz atualização e checkpoint, cria backup online, valida manifesto/tamanho/SHA-256/schema/integridade, restaura a nova raiz temporária, reabre o banco e verifica o nome/revisão atualizados e checkpoint pendente preservado.
- **Não sobrescrita/adulteração:** teste negativo prova que o restore recusa substituir banco existente. A verificação recusa hash adulterado e também SQLite corrompido quando manifesto é atualizado para o hash/tamanho do arquivo corrompido, chegando à checagem SQLite.
- **Falhas de armazenamento:** F02.14 cobre `SQLITE_FULL` via `max_page_count`, acesso negado controlado, cancelamento/interrupção após mutação, schema v2 frente a app v1 e integridade após rollback, tudo em fixtures temporárias.

Todos os testes usam diretórios temporários e dados sintéticos. Nenhum perfil ou banco de usuário foi aberto ou migrado.

## Limites e pendências

- **G1 geral permanece em execução.** F02 só entrega a base SQLite. AssetStore binário, geometria canônica e primeiro render determinístico estão nas fases seguintes F03–F05 e são necessários antes de liberar o Fabricador completo.
- Backup formato 1 inclui somente o arquivo SQLite; não existe AssetStore binário ainda. Quando F03 criar os arquivos de assets, manifesto, hash e restore devem incluir esses arquivos antes de considerar um backup do produto completo.
- O gate valida restore para raiz nova e não sobrescrita; não executou restore destrutivo sobre o perfil ativo.
- Não houve validação de janela nativa, GPU, permissões reais de ACL do Windows ou corte físico de energia/processo. O acesso negado e interrupção foram exercitados deterministicamente por fixtures/falhas injetadas.

## Conclusão

F02 concluiu **15/15 tarefas**. O banco versionado persiste e reabre, migra atomicamente, controla revisões e conflitos, oferece checkpoint recuperável e backup online verificável com restore isolado. O gate da fase **F02 PASSOU**. O gate global G1 continua aberto até F03–F05.
