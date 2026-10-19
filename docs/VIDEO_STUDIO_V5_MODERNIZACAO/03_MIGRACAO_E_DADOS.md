# MIGRAÇÃO SEGURA — Vídeos, assets, cache, compatibilidade e rollback
Planejamento independente para G-V5 Video Studio · 2026-10-19 · **sem alterações atuais nos dados ou schemas**.

## 1. Situação atual comprovada

`electron/videoLibrary.ts` define a biblioteca global em `media-library/videos/<id>.<ext>` e associa ao Studio por `projectMediaPath(studioId, asset)` em `studio-<id>/videos/<id>.<ext>`. `attach()` chama `copyVerified()` e, portanto, **cria uma cópia física do arquivo por projeto**, salvo arquivo destino já existente. `ensureProjectAssets()` repara a cópia desde a biblioteca ou outro projeto. `delete()` usa tombstones na biblioteca.

O código faz validação de tamanho de arquivo, mas o `copyVerified()` valida **tamanho**, não SHA-256 do conteúdo. Este desenho é pragmático para portabilidade/isolamento; não declarar que é bug funcional, nem remover cópias existentes à força.

`electron/main.ts` carrega `@video-frame:<sha256>` dos PNGs de quadros de personagem no Studio. Esse mecanismo prova que há **endereçamento por conteúdo** em uma parte do pipeline visual, mas não que vídeos globais sejam CAS compartilhado.

**Riscos para escalar:** espaço físico cresce com projetos duplicados, longos vídeos podem multiplicar bytes; proxies e caches podem causar crescimento adicional; exclusões e backups dependem da semântica atual de cada cópia.

## 2. Decisão: migrar dados somente depois de medições e rollback

Hipótese preferida para futuro: **Content-Addressed Store (CAS) para originais compartilhados**, com referências por projeto em manifesto independente (ou metadados derivados) e cópia/export portable sob demanda.

Nunca:
- trocar o significado do `VideoStudioAsset.id` sem migração;
- sobrescrever/remover `studio-<id>/videos` num upgrade automático sem backups/testes;
- usar `hardlink` como premissa entre volumes; hardlinks têm limitações de filesystem e operações de exclusão/alteração;
- usar symlinks/junctions sem política forte de segurança de paths;
- abrir arquivos de outro projeto porque nome/id coincide;
- confiar em path ou filename como chave de cache ou prova de identidade.

## 3. Plano de migração por estágios

### D0 — Observabilidade
- [ ] Mapear por fixture sintética: bytes de originais, número de projetos, duplicação por SHA, tempo de `attach`, espaço de proxies e backups.
- [ ] Confirmar cenário de projeto movido/copiado para novo PC e arquivo ausente; inspecionar import de média antiga, portabilidade e tombstones.
- [ ] Levantar contrato dos métodos `list/import/attach/ensureProjectAssets/resolveMedia/delete` e chamadas no preview/salvamento.
**Gate:** gráfico/relatório apenas com métricas locais agregadas, sem nomes ou caminhos privados.

### D1 — CAS paralelo em shadow mode
- [ ] Introduzir `media-object/<sha256>` para bytes originais **derivados e validados**; manter cópias do projeto intactas.
- [ ] Criar índice `assetId -> digest -> storage candidate` e validação completa de SHA para novos objetos.
- [ ] Ler preferencialmente o legado enquanto testa CAS em shadow, sem modificar comportamento user-facing.
- [ ] Esquema de journal para cópias interrompidas e dedup após sucesso; reabrir todos os projetos sintéticos.
**Gate:** zero alterações em dados legados; hashes iguais e todos os projetos abrem.

### D2 — Resolver por prioridade/fallback
- [ ] `MediaResolver` escolhe sob regras explícitas: snapshot pinned → projeto legado válido → CAS global válido → original anexado/verificado → erro recuperável.
- [ ] Cache/proxy deriva de bytes do original + presetVersion + FFmpegBuild + timebase/fps/size/color config.
- [ ] Proxy não pode substituir original na export sem política explícita; regenerar quando checksum divergir.
- [ ] Consumo de disco limitado (quota em bytes), coleta só de derived caches, nunca de originais.
**Gate:** projeto online/offline, original ausente/corrupto, CAS ausente, mídia duplicada por id diferente, tolerância 0 para leitura do arquivo errado.

### D3 — Adoção opcional por projeto
- [ ] Se CAS provar seguro e benefícios suficientes, novos projetos podem usar referência com fallback; antigos continuam funcionando.
- [ ] Duplicar projeto cria referência em vez de cópia *somente* quando backup/export portable estiver definido.
- [ ] Export portable, backup/restauração e projeto importado com mídia incluída devem materializar cópias autossuficientes quando solicitado.
- [ ] Tombstones/refcount/liveness devem considerar projetos existentes, jobs em andamento e backups; manutenção GC de originais **opt-in** e conservadora.
**Gate:** delete de um projeto não perde mídia de outro; job snapshot não sofre invalidação por exclusão durante render.

### D4 — Limpeza/aposentadoria legacy (futuro, condicional)
- [ ] Após versões de observabilidade e recuperação testadas, oferecer diagnóstico/migração explícita, nunca remoção silenciosa de cópias antigas.
- [ ] Somente GC de arquivos **derivados ou migrados com prova de referências e backup**.
- [ ] Rollback documentado que permite voltar à versão anterior e abrir Studio antigo.

## 4. Transação de exportação e privacidade

Unidades independentes:
- documentos Studio continuam dados autorais no local atual;
- `export-jobs/<uuid>` guarda snapshot/arte pinned/manifest/checkpoints próprios;
- `EXPORT/<studioId>/<output>` é o catálogo final;
- `cache/<engineVersion>/<digest>` é derivado, descartável;
- `proxies/<mediaDigest>/<presetDigest>` é derivado, descartável.

Regras:
1. Nunca salvar `playing`/playhead mutável como dependência de frame.
2. Export lê bytes pinned; mudança da biblioteca não se propaga no meio do job.
3. Segurança: canonicalize `realpath`, validar roots e owner, não seguir symlink arbitrário; checar atomicidade e cross-volume.
4. Escrever job.tmp → fsync ou mecanismo apropriado → rename dentro do mesmo volume → validação FFprobe/decode → publish; sidecar gravado depois da saída confirmada; em erro, não substituir vídeo anterior.
5. Recuperação após crash detecta órfãos e oferece retry; limpar só diretórios que pertencem ao job válido.
6. Nunca logar names, paths, thumbnails, personagens ou texto privado por padrão. CI usa PNGs/vídeos/tokens sintéticos.

## 5. Compatibilidade visual e preview

Não trocar todos os personagens por sprites externos sem reproduzir:
- `VideoCharacterState` com imagem PNG por key; `characterBases` e transformações globais;
- `faceRenderGeometry`, asset crop, flip, width/height scales;
- boca falante (6 variações) e blink baseados em timeline;
- transições de 250 ms/15 frames e layers com gaps;
- balão e texto CSS; versão de fonte e screen geometry;
- `VideoClipTransform` e overlay real de clipe de vídeo.

**Migração segura:** compositor novo em modo sombra compara frames escolhidos e registra erros agregados em fixtures, sem substituir a preview por padrão. O print atual é renderer alternativo Canvas 2D; unificação precisa teste de regressão de tipografia/posição.

## 6. Modelo de erros amigáveis e resilientes

| Falha | Produto deve fazer | Não deve fazer |
| --- | --- | --- |
| Original ausente | mostrar qual asset lógico falta + opção relink segura | usar mídia de outro ID com nome parecido |
| Source VFR/PTS inválido | preflight falha com diagnóstico ou proxy validado | frame errado silencioso |
| Asset facial indisponível | fail/recovery explícito e preview/export alinhados | frame anterior congelado sem aviso |
| Cache corrompido | invalidar cache derivado e recalcular | apagar original |
| Encoder GPU falha | fallback CPU disponível/sondado | gerar parcial "concluído" |
| Disco cheio | preservar export anterior e documento | remover outros temporários/projetos |
| Cancelado | interromper apenas processos do job e liberar lease | matar renders/editor de outro job |
| Upgrade renderer | invalidar digests pertinentes | misturar PNG de versões diferentes |
| Duas exportações do mesmo projeto | isolamento por jobId e snapshot | compartilhar pasta temporária não protegida |

## 7. Testes de migração obrigatórios

- **M01:** importar mesmo arquivo em biblioteca duas vezes (IDs diferentes, conteúdo igual), reabrir, comparar bytes.
- **M02:** anexar um vídeo a 3 projetos, copiar/remover projetos; nenhuma referência quebrada.
- **M03:** mover pasta `app-data` para outro caminho e reabrir sem vazamento de caminho absoluto.
- **M04:** modificar arquivo original sintético após import, detectar digest e não usar cache antigo.
- **M05:** interromper durante CAS shadow copy, retomar sem objeto parcial reconhecido.
- **M06:** arquivo re-link em volume diferente, sem hardlink obrigatório e sem symlink inseguro.
- **M07:** export job longo pinna versão antiga enquanto editor altera asset; saída não mistura.
- **M08:** apagar library item mantendo projeto legado; sem corrupção por limpeza.
- **M09:** quota de proxy + limpeza sem deletar media originais.
- **M10:** upgrade/downgrade do app em backups sintéticos de schemas atuais.

## 8. Decisão de adoção

CAS e proxies só entram na linha padrão quando os testes anteriores passarem, **e** redução de disco e/ou latência forem demonstradas. Se o ganho não pagar a complexidade, manter biblioteca com cópias por projeto e otimizar import via políticas seguras. **Não** converter um risco hipotético em refactor invasivo antes de necessidade medida.

## 9. Evidências de código e fontes

- `electron/videoLibrary.ts`: `mediaPath`, `projectMediaPath`, `copyVerified`, `attach`, `ensureProjectAssets`.
- `src/shared/studio.ts`: `VideoStudioAsset`, `VideoTimelineDocument`, `VideoCharacterState`.
- `electron/main.ts`: externalização de `@video-frame:<sha256>`.
- `electron/videoExports.ts`: output `EXPORT`, sidecar, rename e lista.
- `electron/videoExportJobs.ts`: manifest v1 e recuperação de prefixo.
- `src/shared/videoMedia.ts`: contratos de split/trim [start,end).
- Sem benchmark atual de CAS no G-V5; tudo além da implementação atual é **proposta**.
