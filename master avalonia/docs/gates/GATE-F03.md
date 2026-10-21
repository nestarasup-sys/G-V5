# GATE-F03 — AssetStore, thumbnails e cache limitado

**Data:** 2026-10-21  
**Branch:** `Master-AValonia`  
**Última tarefa da fase:** F03.11  
**Resultado:** **PASSOU** para o escopo F03.  
**Gate global G1:** continua em execução; este resultado não valida F04/F05 nem libera o Fabricador.

## Escopo e critérios

F03 estabelece ingestão e armazenamento de assets por ID/hash, referências persistentes, decode seguro de imagens, cache LRU limitado, thumbnails derivados, consultas paginadas, coleta reversível/verificada e backup/restore dos bytes. Critérios visuais de UI não se aplicam a esta fase de infraestrutura sem telas; a futura interface ainda precisa seguir `docs/ui-fidelity/` e comprovar paridade por captura.

## Evidências verificadas

| Critério | Evidência |
| --- | --- |
| Identidade e fronteiras tipadas, sem path físico no contrato Application | F03.01, contratos `IAssetStore`, `AssetId`, testes de arquitetura e invariantes |
| Ingestão limitada, hash incremental, MIME/dimensões e limpeza de staging em falhas/cancelamento | `AssetImportStagerTests`; F03.02 |
| Publicação por hash e recovery de divergência SQLite/arquivo | `SqliteAssetImportPipelineTests`; journal migration 4; F03.03 |
| Deduplicação por conteúdo e referências idempotentes persistentes após reopen | `SqliteAssetImportPipelineTests`; migration 5; F03.04 |
| Decode PNG/JPEG/WebP com alpha, orientação EXIF, limites e falha tipada | `AssetImageDecoderTests`; F03.05 |
| Cache LRU por bytes, leases, concorrência por chave e métricas | `AssetBitmapCacheTests`; `AssetBitmapCache.Metrics` inclui hit, miss, eviction, bypass, bytes, entries e leases; F03.06/F03.11 |
| Thumbnail derivado identificado por conteúdo/receita/versão, concorrência e recuperação de corrupção | `ThumbnailServiceTests`; F03.07 |
| Paginação keyset estável e consulta limitada à janela visível/prefetch | `SqliteAssetCatalogTests`, `ThumbnailServiceTests`; F03.08 |
| GC só após grace period, backup íntegro, lixeira/retention e restore sem sobrescrita | `DatabaseBackupServiceTests`, `SqliteAssetImportPipelineTests`; F03.09 |
| Cache abaixo do orçamento, dedupe, imagem inválida, estados interrompidos e reabertura | `AssetBitmapCacheTests`, `AssetImageDecoderTests`, `SqliteAssetImportPipelineTests`; F03.10 |

Os cenários de interrupção validam estados persistentes de recovery sem terminar o processo à força. Não se afirma que um hard-kill de processo ou falha física de energia tenha sido executado.

## Gate local Release

Comando executado dentro de `master avalonia/`:

```text
TestarLocal.bat gate
```

Resultado: **PASSOU**. Restore da solution e Headless; build Release com 0 erros; Core 11/11, Architecture 6/6, Data 44/44, Assets 27/27 e Headless 15/15; exit code 0.

O build emitiu dois avisos CS0618 em `src/GV5.Data/Thumbnails/ThumbnailService.cs:218`: `SKPaint.FilterQuality` e `SKFilterQuality` são obsoletos; a API recomendada é `SKSamplingOptions`. São avisos, sem falhas. A migração para a API nova fica registrada como manutenção, sem ampliar F03.

`git diff --check` também foi executado para a documentação do gate.

## Limites e pendências fora do gate

- O orçamento padrão de cache (512 MiB) ainda não foi calibrado por benchmark em hardware real.
- Não houve validação de GPU, captura visual ou execução interativa do app nesta fase.
- Nenhum dado pessoal ou app-data foi usado; os testes usam fixtures e diretórios temporários.
- G1 continua aberto até a geometria canônica e o primeiro render determinístico de F04/F05.
- A fidelidade visual do Gacha 5 segue requisito transversal; nenhuma paridade de interface é declarada por este gate.

## Decisão

Os 11 itens F03.01–F03.11 possuem implementação e/ou evidências de teste registradas no `EXECUTION_STATUS.md`. A fase **F03 está validada**. Próxima tarefa sequencial: **F04.01**.
