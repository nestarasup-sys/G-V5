# Validação local de continuação — 2026-10-19

**Branch:** `codex/finalizar-dev-ai-local`  
**Base de código antes desta etapa:** `2b1bbcf` (continuação de `9ba244e`).  
**SHA validado pela suíte completa:** `5b82b5a9c4f5b9dda402d30e290517e00f51d2e5` (árvore limpa).
**Ambiente:** Windows, Node/Electron do checkout local.  
**Escopo:** reexecução dos gates DEV AI, fluxo sintético Fabricador → Customizador, isolamento entre Studios e renderização dos personagens Ayla/Chloe em cópias privadas. Evidências privadas continuam fora do repositório; o código e a documentação desta branch serão publicados sob autorização explícita posterior do usuário.

## Resultado dos comandos

| Comando | Resultado observado |
| --- | --- |
| `npm test` | passou: 24 testes, 0 falhas, 2 ignorados por limitações do Windows (`out/` existente e criação de symlink impedida pelo SO) |
| `npm run typecheck` | passou |
| `npm run build` | passou |
| `npm run audit:list` | passou; listou 15 auditorias registradas e suas restrições de dados |
| `npm run audit:boundaries` | executou; scanner regex relatou 10 arestas cruzadas e 1 import de asset não resolvido (`?inline`) |
| `npm run audit:boundaries:ast` | executou; 75 arquivos, 227 imports, 22 arestas runtime cruzadas, 0 não resolvidas |
| `npm run audit:boundaries:gate` | passou; 10 relações legadas permitidas, nenhuma regressão nova |
| `npm run audit:fast` | passou: 9/9 auditorias com fixtures sintéticas |
| `npm run audit:all` | passou: 13/13 casos, incluindo typecheck, build, suíte rápida, isolamento Studio e IPC Electron real |
| `node --check` dos dois runners alterados e `git diff --check` | passaram |

Execução completa DEV AI: `2026-10-19T02-11-56-675Z-73ebea84-608b-4ef1-a350-447e71f1942e`; o `report.json` registra o mesmo SHA `5b82b5a9c4f5b9dda402d30e290517e00f51d2e5`. Artefatos sintéticos locais: `out/dev-ai/runs/<run-id>/`. Duração medida por caso: typecheck 17,7 s, build 6,4 s, isolamento 12,0 s e IPC real 32,6 s. São tempos deste runner nesta máquina, **não** benchmarks de desempenho do produto.

## Ayla e Chloe — teste privado local

- Backup privado de `customizer` e `fabricator`: 567 arquivos verificados por SHA-256; cópia de restauração conferida.
- Duas cópias de trabalho independentes foram usadas. Só a cópia reset recebeu normalização dos três grupos de roupa com transforms não neutros; os dados originais e a cópia base permaneceram intocados.
- A janela Electron real abriu o Customizador com os dados clonados; capturas canônicas incluíram modelo, roupas, rosto, cabelos e acessórios acima do cabelo quando aplicável. A comparação foi feita no Chromium da própria janela.
- Resultado: status `passed`; Ayla teve 2 grupos transformados antes e 0 depois, com 0,7047% de pixels alterados; Chloe teve 1 e 0, com 0,6505% de pixels alterados. A biblioteca Fabricador teve hashes iguais nas duas cópias; os manifests de personagem permaneceram sem escrita durante a captura/comparação.
- Relatórios e PNGs permanecem somente em `%LOCALAPPDATA%\GachaV5PrivateValidation\...\evidence\`, fora do repositório. Não registrar IDs, nomes de arquivo privados, hashes de conteúdo pessoal nem imagens no Git.
- O runner privado está em `scripts/dev-ai/private-character-review.cjs`; requer explicitamente `--baseline` e `--reset` sob a pasta privada, confere marcador de cópia/backup e rejeita symlinks. O modo privado de `electron/main.ts` só ativa com `GACHA_DEV_AI_TEST=1` e `GACHA_DEV_AI_PRIVATE_TEST=1`.

Isso comprova que os ajustes de roupa salvos nesses dois personagens afetam o render do Customizador e que a captura não alterou os manifests nem a biblioteca Fabricador. **Não** comprova o round-trip de salvamento após edição, equivalência do mesmo personagem em Studio/Video Studio ou cobertura de todas as categorias e transformações.

## Cobertura e pendências

- **AF-01–AF-20:** matriz integral continua aberta. `audit:all` testa contratos sintéticos selecionados e não cobre todos os casos, duas DPIs, 100 alternâncias, falhas/crash, upgrade de assets ou equivalência visual nas quatro áreas.
- **ISO-01–ISO-15:** matriz integral continua aberta. A suíte passou os cenários implementados de navegação/layout e persistência IPC, não prova todos os cenários de recursos, CSS, lifecycle, falhas e interferência.
- **DEV AI:** runner, guardas, isolamento de IPC, suites e relatórios locais tiveram testes verdes nesta execução; painel visual DEV AI independente, cobertura de rede/firewall no SO, memória/leak, logs redigidos completos e crash injection continuam abertos.
- Não foram executados benchmark de produto, validação Linux, teste de migração/restore de produção, `npm ci` limpo nem GitHub Actions para o SHA desta continuação.
- Na primeira entrega local, push, PR, merge e execução remota estavam pendentes da autorização do usuário. Depois, o usuário autorizou explicitamente o push da branch de continuação; isso não autoriza merge e não afirma que a CI remota foi executada/aprovada.

### Matriz AF-01–AF-20

`Parcial` significa que há um teste correlato, mas falta pelo menos parte do oráculo definido na matriz normativa. Nenhum caso é fechado por esta execução.

| Caso | Estado nesta rodada | Caso | Estado nesta rodada |
| --- | --- | --- | --- |
| AF-01 | Não demonstrado | AF-11 | Parcial: captura de acessório acima do cabelo em personagem real; faltam poses/transformações e paridade completa |
| AF-02 | Parcial: fixtures pose1/pose2 e oracle geométrico | AF-12 | Parcial: camadas de face/corpo capturadas; sem variações completas de expressões/chroma |
| AF-03 | Parcial: contratos sintéticos de roupas | AF-13 | Não demonstrado entre Customizador, Studio e Video Studio |
| AF-04 | Parcial: compatibilidade de folhas 2.0 | AF-14 | Não demonstrado versionamento/refresh de biblioteca |
| AF-05 | Parcial: sapato sintético e bounding box | AF-15 | Parcial: testes do runner/fechamento; não cobre crash em cada save de asset/personagem |
| AF-06 | Parcial: validações negativas de binding; sem fluxo legado completo de migração | AF-16 | Parcial: rejeições sintéticas; falta UI e cobertura de arquivos ausentes/schema antigo |
| AF-07 | Não demonstrado com personagem recém-criado | AF-17 | Parcial: navegação de Studios, sem lifecycle das cinco áreas |
| AF-08 | Parcial: Ayla/Chloe renderizaram diferenças individuais; sem edição UI, save/restart ou prova de personagem B inalterado após editar A | AF-18 | Não demonstrado |
| AF-09 | Não demonstrado ciclo de 100 alternâncias | AF-19 | Parcial: contratos sintéticos de mídia/transição; sem prova de frame cross-Studio |
| AF-10 | Parcial: composição sintética e cabelo em captura real; sem redimensionamento/rotação sistemáticos | AF-20 | Parcial: diff de ator real; sem pilha completa e duas DPIs |

### Matriz ISO-01–ISO-15

| Caso | Estado | Caso | Estado | Caso | Estado |
| --- | --- | --- | --- | --- | --- |
| ISO-01 Shell | Parcial: suíte de navegação; não 100 ciclos completos | ISO-06 IPC | Parcial: IPC real com namespace e sandbox, sem fuzz/payloads grandes completos | ISO-11 Async race | Não demonstrado |
| ISO-02 CSS | Parcial: smoke visual, sem perturbação e inventário completo de computed styles | ISO-07 Storage | Parcial: namespaces e hashes de sandbox, sem todos os diretórios e cenários de exclusão | ISO-12 Fullscreen | Não demonstrado |
| ISO-03 State | Parcial: escopo de persistência por workspace | ISO-08 Crash/recovery | Parcial: encerramento pendente, sem kill em cada ponto de staging | ISO-13 Long run | Não demonstrado |
| ISO-04 Keyboard | Não demonstrado | ISO-09 Shared capability | Parcial: sem teste completo de atualização e independência de playhead/documentos | ISO-14 UI regression | Parcial: Customizador real privado, sem Fabricador/Opções completos após mudança de shell |
| ISO-05 Lifecycle | Parcial: criação/fechamento no smoke IPC; workers/RAF não instrumentados | ISO-10 CSS perturbation | Não demonstrado | ISO-15 Media | Parcial: contratos de mídia sintéticos; sem ciclo UI import/attach/delete completo |

### Checklist DEV AI avaliado nesta rodada

| Requisito | Estado | Evidência ou limite |
| --- | --- | --- |
| Runner CLI sem janela visível | Parcial | Electron real com BrowserWindow oculto; ainda não usa `offscreen: true` |
| Fixture, perfil e dataRoot isolados; escrita externa bloqueada | Parcial | Guardas de path, sandbox sintética e cópia privada; não há teste de tentativa contra cada path real do host |
| IPC real e auditoria visual | Parcial | Ambos passaram, mas cenários continuam limitados às suites registradas |
| ISO-01–ISO-15 completa | Não concluído | Veja a matriz acima |
| Reports, screenshots, hashes locais e reproduzíveis | Parcial | Schema/report e artefatos locais; suíte redigida e inventário completo ainda faltam |
| Painel DEV AI ausente em release | Não demonstrado | Nenhuma validação de painel de desenvolvimento/release foi executada |
| Timeout, crash, rede e limpeza de processos | Parcial | Timeout e bloqueio do renderer foram exercitados; firewall do SO, crash injection e órfãos não foram verificados integralmente |

O histórico do runner ainda é `BrowserWindow` oculto, não `BrowserWindow({offscreen:true})`. A barreira comprovada neste teste bloqueou requisições do renderer via `webRequest`; firewall do sistema operacional não foi alterado nem testado.

## Adendo — edição real isolada e auditoria final local

**Commit de código validado:** `4aff45d71746a536baca22780e71e769f772ddec`. A suíte executada depois dessa alteração foi `npm run audit:all`, run `2026-10-19T02-25-42-248Z-112f71fa-5fd2-4188-8c81-919186a9cd97`: 13/13 casos passaram, incluindo typecheck, build, nove auditorias sintéticas, isolamento visual e IPC real em `userData` sintético. O relatório é local em `out/dev-ai/runs/<run-id>/report.json`; a suite declara que o bloqueio de rede do renderer não equivale a firewall do SO.

Também passaram `npm test` (24 pass, 2 skip por limitações do Windows), `npm run typecheck`, `npm run build`, `node --check` dos dois runners e `git diff --check`.

### Round trip IPC de Ayla e Chloe

A cópia privada independente foi renderizada antes da edição; cada personagem foi alterado por `window.desktop.saveCustomizerCharacter` via preload/IPC de produção em processo Electron separado. A verificação confirmou copy-on-write: a outra pessoa permaneceu igual em cada edição, a biblioteca Fabricador manteve hashes idênticos e os dois offsets persistiram após iniciar outro processo Electron. A renderização posterior do Customizador mudou para ambos (diferença de pixels não zero), e a comparação visual não escreveu no perfil privado. O resumo JSON e capturas estão somente no `%LOCALAPPDATA%\GachaV5PrivateValidation\...`, fora do repositório.

O perfil original foi comparado antes/depois dessa execução e não mudou. **Um arquivo** do perfil atual já diferia do backup histórico no início da rodada; os 567 arquivos do perfil permaneceram byte a byte iguais ao snapshot capturado no início desta execução. A auditoria relata essa diferença histórica separadamente, sem listar caminhos/valores privados, e não tentou restaurar ou sobrescrever o original.

Este round trip prova o salvamento IPC e a independência de personagem no Customizador em cópia privada. Não prova edição pela interface visual, paridade do personagem entre Customizador/Studio/Video Studio, nem fluxo de autoria UI do Fabricador. AF-01–AF-20, ISO-01–ISO-15 e os gates do roadmap seguem parciais/abertos conforme as matrizes acima.

O usuário autorizou depois o envio desta branch para o GitHub. Esse envio não muda o resultado local nem representa aprovação da CI remota; ver o handoff [CONTINUACAO_DEV_AI_2026-10-18.md](../CONTINUACAO_DEV_AI_2026-10-18.md) para SHA, commits e passos seguintes.
