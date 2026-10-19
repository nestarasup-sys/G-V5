# Dados, migração segura, exportação e recuperação

**Status:** política proposta; nenhum dado real foi migrado. **Dono do plano operacional:** R-04/R-07–R-09/R-15–R-17 em [ROADMAP_EXECUTAVEL.md](ROADMAP_EXECUTAVEL.md). Origem e formatos observados em [INVENTARIO_E_EVIDENCIAS.md](INVENTARIO_E_EVIDENCIAS.md).

## 1. Princípios não negociáveis

1. **Pasta movível, mas gravável:** em desenvolvimento, `<repo>/app-data/` **ignorado pelo Git** somente depois do guard da etapa B; em distribuição portátil, `<workspace>/app-data/` junto aos arquivos do produto **quando o local for gravável**. Se instalado sob `Program Files`/permissões restritas, exigir escolha de workspace gravável fora da pasta de instalação em vez de falhar silenciosamente. A pasta de instalação não é raiz de dados. Salvar o último workspace como ponteiro no perfil de bootstrap pode ser inevitável; seu conteúdo de usuário permanece no workspace. Registrar esse compromisso em ADR antes do release.
2. **Projeto de dados vs workspace:** um workspace pode conter vários projetos e bibliotecas, cada um com ID; código/assets de build são imutáveis; dados de usuário não são versionados. `app.asar` nunca recebe saves. Caminhos persistidos são **relativos** a uma raiz validada e IDs estáveis.
3. **Um único resolver:** `DataRoot` no processo principal é injetável e resolvido antes de abrir repositórios. Renderer só envia IDs/commands tipados; preload não expõe filesystem arbitrário.
4. **Sem destruição implícita:** importação copia bytes para staging, valida conteúdo/tamanho/hash, publica manifest e só depois faz referência; arquivamento/lixeira antecede exclusão permanente. Backup e rollback existem **antes** da migração.
5. **Proteções reais:** IDs/capabilities validados no main, `realpath`/symlink/traversal/paths Windows UNC e normalização Unicode verificados em todos os destinos, arquivos externos são não confiáveis, quota e limites explícitos, lock por workspace, estratégias de conflito determinísticas. Não considerar extensão prova de MIME.
6. **Duas dimensões de compatibilidade:** `schemaVersion` do conteúdo e `rootLayoutVersion` do layout de pasta; leitura de versões antigas é testada, gravação para versões desconhecidas é bloqueada com instruções seguras.

## 2. Layout proposto, sujeito a piloto em fixtures

```text
<workspace>/
  app-data/
    workspace.json             # ID, layoutVersion, appVersion, hashes de índice
    projects/
      <project-id>/
        project.json           # schema, referências relativas, ownership, timestamps
        characters/ ...        # tipo/coleções de conteúdo, quando propriedade do projeto
        studios/
          normal/<document-id>/{studio.json,assets,prints}
          video/<document-id>/{studio.json,assets,frames,videos,prints}
        drafts/
        trash/                 # lixeira com retentativa/restore
    libraries/                 # assets intencionalmente globais ao workspace
      characters/ models/ wardrobe/ faces/ hair/ poses/ animations/
      video/ backgrounds/
    settings/                  # preferências do workspace, não só do Chromium
    logs/                      # operacional + atividade; redigidos, limitados
    backups/                   # manifest de backup, snapshots imutáveis, hashes
    migrations/                # journal e inventário, nunca texto de usuário
    dev-ai/                    # DEV AI dev-only: runs **sintéticos e separados**
```

**Decisão ainda aberta:** personagens e Fabricador podem ser globais à biblioteca do workspace ou propriedade de um projeto; observar fluxos reais e definir owners/refcounts antes de migrar. O layout ilustrativo **não autoriza** mover dados até fechar essa decisão. Media library e background library atuais pertencem ao namespace de Video Studio; separar biblioteca global requer prova de comportamento de anexos e de export portátil.

## 3. Tabela inicial de mapeamento (não executar ainda)

| Fonte atual resolvida pelo Electron | Destino pretendido | Política inicial |
| --- | --- | --- |
| `userData/customizer/characters/` | `libraries/characters/` ou `projects/<id>/characters/` | decidir ownership, preservar IDs, arquivos e `characters.json` |
| `userData/fabricator/models|poses|animations|wardrobe|faces|expression-presets|face-components|hair` | `libraries/<domínio>/` | preservar estrutura de modelos, slots, guias, histories e drafts; schema por tipo |
| `userData/fabricator/guides-*.json` | `settings/fabricator/` | resolver duplicatas com guias de `localStorage` por versão/timestamp e escolha explícita |
| `userData/studios/Studio Principal/studio-<id>/` | `projects/<id-projeto>/studios/normal/<id-documento>/` | copiar tree como unidade, reescrever **apenas** referências validadas |
| `userData/studios/Video Studio/studio-<id>/` | `projects/<id-projeto>/studios/video/<id-documento>/` | incluir vídeo, frames, prints e referências da timeline |
| `userData/studios/Video Studio/media-library|background-library` | `libraries/video|backgrounds/` com ownership explícito | preservar catálogo, deleted/tombstones e anexos por roteiro |
| `localStorage` chave `gacha-nymi-studio-catalog-v1` | migração legado somente após conciliação | Studio atual remove chave após importar; guardar snapshot primeiro |
| `localStorage` customizer/design/face/expression | `settings/` e/ou `drafts/` conforme criticidade | migrar todas as chaves classificadas, sem descartar rascunhos silenciosamente |

## 4. Protocolo de migração (estado de máquina)

`DISCOVERED → INVENTORIED → BACKED_UP → STAGED → VERIFIED → COMMITTED → OBSERVED → CLEANUP_ELIGIBLE`

- **DISCOVERED:** fechar instâncias ou lock exclusivo; identificar `app.getPath('userData')` real, perfil Chromium e root escolhido. Verificar espaço (pelo menos snapshot + cópia + margem de segurança), permissões, caminhos canônicos, links/symlinks, bytes de dados e contagem. Não usar estimativa fixa de `AppData`.
- **INVENTORIED:** manifest local de caminhos relativos, tamanho, mtime, hash SHA-256 streaming, schema/versão e relações; hashes e paths de projeto **não** são enviados para fora. Excluir caches regeneráveis só se comprovados.
- **BACKED_UP:** snapshot **imutável** de origem em destino separado da pasta migrada; SHA-256 independente, índice de recuperação e teste de restore em raiz temporária. Se não for possível fazer backup verificável, **abortar sem alteração**.
- **STAGED:** copiar para `.staging/<operationId>` na mesma unidade de destino; impedir overwrite de nomes iguais e divergentes, não seguir symlink, validar extensão e magic bytes, impedir zip-bomb e arquivos gigantes. Fonte permanece intocada.
- **VERIFIED:** comparar tamanho e hash fonte→staging de **cada arquivo**, schemas completos, refs relativas, IDs únicos, catálogos, thumbnails e amostras abríveis com fixtures. Qualquer mismatch vai para `quarantine/` ou report, sem reparar silenciosamente.
- **COMMITTED:** gravar journal e manifest temporário, `fsync` onde suportado, renomear de modo coerente no mesmo FS, atualizar apontador de root apenas após `verify`; report com contagens, conflitos, versões, estado e checksum da migração. Não suportar partial commit invisível.
- **OBSERVED:** abrir documentos e personagens em modo de validação, fechar/reabrir, conferir thumbnails/arquivos e hash, fazer export/restore round-trip, comparar serialização e operação. Nesta fase o root velho fica preservado e preferencialmente somente leitura; se houver edits em paralelo, bloquear switch/capturar conflitos.
- **CLEANUP_ELIGIBLE:** só depois de janela de compatibilidade, backup recuperável, aprovação explícita e método de retorno. Limpeza não faz parte da migração inicial.

**Repetibilidade:** journal com `migrationId`, `sourceRootFingerprint`, `destinationWorkspaceId`, `schemaFrom/To`, `operationId`, `state`, `hashMap`, `errors`. Reexecução do mesmo ID prossegue após conferir hashes; duas fontes distintas nunca sobrescrevem destino. Versionamento de layout permite rollback de leitura; se novo app gravar schema incompatível, fallback antigo exige export/transform compatível, não simplesmente trocar o ponteiro.

## 5. Salvamento transacional por projeto

Para `saveStudio`, Fabricador, personagens e bibliotecas: validação → resolver path canônico → lock por entidade → escrever assets novos em staging (hash de conteúdo) → escrever manifest versionado no staging → verificar refs → registrar journal `PREPARED` → trocar manifest/index via operação atômica onde possível → confirmar `COMMITTED` → limpar apenas staging órfão comprovado. Não remover assets antigos referenciados por snapshots ou autosave anterior. Em falha, preservar último manifest consistente e expor código `STORAGE_WRITE_FAILED`/retry seguro; não mostrar 'salvo' enquanto só arquivos secundários foram gravados.

**Limitação:** `rename` isolado de um JSON não dá atomicidade ao grupo de PNG/frames/vídeos; consistência precisa de referências por hash, versão de manifesto, journal e GC pós-commit. Crash injection deve ocorrer após cada checkpoint e depois de `rename`.

## 6. Ciclo de vida obrigatório por tipo

`create`/import (`validated`) → `draft` → `active` ↔ `archived` → `trash` → `purged` (explícito). `duplicate` cria novo ID e declara compartilhamento/cópia de mídia; `export` contém schema, lista de arquivos e checksums; `restore` resolve conflitos com `rename` lógico/novo ID e mapa de referências. Todas as operações têm `operationId`, auditoria com metadados mínimos, idempotência e resultado por entidade.

**Exclusão:** não permitir remover uma biblioteca compartilhada sem análise de dependências; tombstone e retenção limitada são necessários antes de purge. Se Windows mantiver vídeo aberto, marcar `pending-deletion` e tentar depois, sem enganar a UI.

## 7. Exportação portátil

Pacote `gacha-workspace-v1` com índice, manifest de documentos, mídia selecionada, hashes e versão. Por padrão, nenhum cache/log privado ou relatório DEV AI entra no pacote. Export incremental somente após prova de snapshot consistente. Na importação: validar índice antes de extrair, limitar bytes/arquivos/razão de compressão, bloquear absoluto/`..`/symlink/hardlink, conflito, checksum errado, mídias executáveis e schema futuro; sugerir `dry-run` e destino novo. Criptografia de backup é uma opção posterior com key management estudado, jamais senha em log.

## 8. Matriz de fault injection e recuperação

- [ ] Disco cheio após staging e após manifest; a cópia antiga permanece abrível.
- [ ] App morto durante cópia de vídeo de vários GB; resume ou limpa staging seguro.
- [ ] Interrupção depois de escrita de imagem e antes do `studio.json`; sem assets órfãos perigosos nem refs quebradas.
- [ ] Dois processos gravando mesmo projeto; lock/erro explícito e nenhuma perda.
- [ ] Diretório read-only, path UNC, espaço insuficiente, diretório de instalação bloqueado; escolha de workspace informada.
- [ ] JSON truncado, checksum inválido, versão futura, arquivos ausentes, duplicatas e symlinks maliciosos; quarantine sem ocultar erro.
- [ ] Instância reiniciada após migração parcialmente concluída; journal idempotente, 0 sobrescritas conflitantes.
- [ ] Export → excluir original sintético → import em raiz diferente; 100% hashes de conteúdo, IDs e refs preservados.
- [ ] `localStorage` com chaves legado e dados contraditórios; política de prioridade explícita e rollback da chave.
- [ ] Recuperação de arquivo em `trash` com nome/ID ocupado e referências cruzadas.

**Aceite para dados reais:** backup verificado restaurando em raiz separada + inventário aprovado + dry-run sem falhas + bloqueio de processos concorrentes + confirmação explícita para comutação da raiz. Sem evidência, a migração real permanece aberta.
