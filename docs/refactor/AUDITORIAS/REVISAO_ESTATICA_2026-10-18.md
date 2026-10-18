# Verificações documentais da revisão — 2026-10-18

**Tipo de evidência:** checagem estática de Markdown e metadados retornados pela conexão GitHub. **Não é** execução de testes de aplicativo, benchmark, build, Electron nem inspeção visual.  
**Branch:** `docs/refactor-review-2026-10-18`  
**Base da auditoria:** `master@5b8483454757f4cc9606c626471aabbeccf35daa`.  
**Head documental inspecionado:** `aa406baff064f799c8796d692bc49f26ab857da1` (pode mudar depois desta revisão).  
**Limitação do método:** não houve checkout completo na máquina-alvo, instalação de dependências, acesso aos dados pessoais ou aos logs de execução. Revisão em código foi dirigida por inventário de árvore e caminhos de maior risco, não execução/exame semântico de cada linha do repositório.

## Evidências coletadas

| Verificação | Método efetivamente aplicado | Resultado |
| --- | --- | --- |
| Árvore do GitHub `master` | GET da árvore recursiva Git e confirmação `truncated:false` | 128 entradas; `docs/STUDIO_WORKSPACES.md` ausente |
| Referências históricas | Commit Git `192245e`, `e352f04`, `5b84834` e pesquisa de commits recentes | remoção da doc antiga, commit de correção histórica e base da revisão confirmados |
| Permissão e isolamento de branch | Metadados do repositório e ação `create_branch` pelo GitHub | branch criada; nenhuma alteração aplicada a `master`, nenhuma PR/merge |
| Documentos e links relativos | Leitura integral dos **9** arquivos Markdown versionados na branch, extração de Markdown links e normalização de caminhos relativos contra a árvore Git | **30 links relativos, 0 destinos inexistentes** |
| Fences e estrutura simples de Markdown | Contagem de início/fim de blocos ``` e headings vazios nos 9 arquivos Markdown | 0 fences desbalanceados; 0 headings vazios |
| Completude de IDs do roadmap | Extração das declarações `**R-xx` no roadmap | **28 IDs únicos R-01…R-28; 0 lacunas/duplicatas** |
| Completude da matriz DEV AI | Extração de `ISO-xx` da tabela de casos | **15 casos únicos ISO-01…ISO-15; 0 lacunas** |
| Estado dos checklists | Contagem de checkboxes Markdown em 9 documentos | 3 fechados (somente leitura/revisão/criação de documentação); 64 abertos, incluindo todas tarefas de runtime/migração/tests |
| Dependências/arquivos registrados | Comparação do inventário com caminhos `master`, leitura dirigida de código/roteamento/persistência/preload/scripts | evidências E-01–E-28 registradas; execução **não** certificada |
| Links externos | Extração textual dos links absolutos dos docs | 10 referências encontradas; existência e conteúdo atual de cada URL **não foram testados** por este verificador |

## Checks **não** realizados (permanecem abertos)

- `npm ci`, `npm run typecheck`, `npm run build`, `npm test` (script não declarado no baseline), lint, testes unitários, E2E, IPC real e integração Electron.
- `electron scripts/audit-studio-isolation.cjs` e outros `scripts/audit-*`; screenshot, comparação visual, navegação real e teste de lifecycle/CSS.
- Benchmarks de CPU/RSS, cold start, timeline e uso de mídia; `p50/p95` só são metas metodológicas no plano.
- Inspeção de `userData` real/`localStorage` de perfil do usuário; backups reais, restore, export/import, migração e exclusão.
- Testes contra payload malicioso, CSP, arquivos truncados, symlink, crash injection e dependências vulneráveis.
- Verificação de offscreen verdadeiro de Electron, GPU/codec no host, Tauri ou alternativas de runtime.
- Renderização por engine externa de Markdown/diagramas (somente checagens estruturais simples e links).

## Como repetir as checagens

Consultar árvore GitHub `GET /repos/nestarasup-sys/G-V5/git/trees/<ref>?recursive=1`; em seguida obter os nove arquivos Markdown dessa árvore. Para cada link relativo `[label](target)`, resolver `target` contra o diretório do arquivo que contém o link e testar existência exata na árvore. Validar quantidade par de fences de Markdown `^````, ausência de headings vazios, IDs R-01…R-28 únicos nas declarações do roadmap e ISO-01…ISO-15 na tabela de cenários. Anotar commit de HEAD, pois qualquer edição invalida os números anteriores. Repetir as verificações após mudar documentação.

A revisão documental pode ser considerada concluída independentemente de os gates de execução do produto estarem abertos; **não marcar funcionalidades implementadas somente porque suas especificações estão completas**.
