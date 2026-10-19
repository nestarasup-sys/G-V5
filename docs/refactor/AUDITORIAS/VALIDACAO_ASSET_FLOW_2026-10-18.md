# Validação executada — fluxo de assets, ownership e DEV AI

**Data da execução:** 2026-10-18 (run registrado pelo GitHub Actions em 2026-10-19 UTC).  
**Branch:** `feat/dev-ai-foundation-asset-flow-2026-10-18`.  
**Commit validado:** `cc5dbf2823be85a3d88b50501851320af1847b32`.  
**CI:** [GitHub Actions #39179878381](https://github.com/nestarasup-sys/G-V5/actions/runs/39179878381), conclusão **success**, dois jobs em **success**.  
**Artefato sintético:** [Windows ZIP, execução #39179878381](https://github.com/nestarasup-sys/G-V5/actions/runs/39179878381/artifacts/12155173523). Retenção temporária de GitHub Actions; sem arquivo de usuário.

## Execução observada

| Verificação | Host | Resultado | Escopo |
| --- | --- | --- | --- |
| Node unit tests | Linux Ubuntu | **21 passes, 0 fails** | Runner CLI, imports AST/gate, comparação visual |
| Node unit tests | Windows Actions | **21 passes, 0 fails** | Mesmas suites de núcleo |
| TypeScript `tsc --noEmit` | Linux + Windows | **pass** | Tipagem com os arquivos novos e UI alterada |
| `npm run build` | Windows | **pass** | Vite Electron Main, preload e renderer |
| `audit:boundaries:ast` + gate | Linux | **pass** | Detecta dívida existente sem crescimento |
| `audit:fast` | Linux | **pass** | **8 auditorias**, inclusive `wardrobe-flow` sintética |
| `audit:all` | Windows Electron | **pass — 12/12** | `typecheck`, `build`, 8 auditorias Node, 1 visual fixture, 1 IPC real |
| `studio-isolation` | Windows Electron | **pass** | Preload simulado, 20 ciclos visuais |
| `studio-ipc-real` | Windows Electron | **pass** | Production preload, namespaces, concorrência, restart, fechamento, rede, personagens |

**Resultados verificados no artifact** `report.json` e `studio-ipc-real/report.json`: status `passed`; phases: seed, area-smoke, process-restart, close-with-pending-saves, pending-saves-after-restart, namespace-delete e invalid-root-rejected passaram.

O `seed-result.json` confirmou dois personagens sintéticos novos, ajuste apenas do A, B sem alteração e SHA do diretório Fabricador inalterado após salvar personagem. `restart-result.json` confirmou o ajuste individual após reabrir app. **Isso ainda usa locator sintético de roupa sem renderização real**, não prova que prefit visual já esteja correto.

O `area-smoke-result.json` confirmou barrier `session.defaultSession.webRequest` contra HTTP(S)/WebSocket/FTP partindo do renderer: controle Node realizou 1 acesso loopback; tentativa de `fetch` do renderer não atingiu servidor. **Não é firewall de sistema operacional para processos Node e CI**; `osFirewallEnforced:false`.

O teste de 100 transições entre os editores resultou em **0 pixels diferentes** nas capturas antes/depois (1104×681), com SHA-256 idêntico e estabilização temporal de duas capturas por estado. O teste visual continua com threshold explícito e salva diff/JSON antes de reprovar diferenças materiais.

**Medições limitadas em fixture vazia de assets:** Studio save `p50=1.89ms`, `p95=2.04ms`, Video save `p50=2.17ms`, `p95=2.33ms`; 100 aberturas de editor com `p50=7.28ms`, `p95=10.32ms` até DOM pronto. Não medir como experiência de projetos complexos nem estabilidade de memória: CPU/heap idle e crash recovery não cobertos.

## Falhas reais da rodada, investigação e correções

1. **Auditoria de bone selection reprovou em Linux.** O modelo sintético sem perna direita fazia um sapato direito escolher o tronco. Código corrigido para rejeitar candidatos distantes do local esperado e impedir salvar set sem vínculo válido. A auditoria `wardrobe-flow` passou em ambos hosts depois.
2. **Primeira ampliação IPC reprovou** por assumir que um perfil sintético começa com exatamente dois personagens; o app entrega dez personagens embutidos de demonstração. Corrigido teste de count para `antes+2`, sem alterar inicialização nem dados do app.
3. **Segunda ampliação IPC reprovou** em comparação profunda pela diferença semântica inócua `wardrobeGroups:undefined` versus ausência da chave no objeto. O teste de persistência passou a comparar JSON serializável, mantendo checagens de A e B, após restart e SHA da biblioteca.
4. **Validação final ficou verde** com alterações do `CustomizerPage.tsx`, guarda de `WardrobeWorkspace`, novo `assetFlow.ts`, nova auditoria de roupas e rede de sandbox por renderer.

Testes que falham são dados valiosos; nenhum caso foi marcado como `skip` para produzir verde.

## Do que a validação NÃO dá garantia

- **Não** houve criação de modelo/roupa/cabelo/head-extra renderizável na fixture de IPC. Não foi demonstrada equivalência *pixel a pixel* entre a prévia do Fabricador e o Customizador (AF-03/04/07/10/11), nem entre o Customizador e os dois Studios com personagem vestido (AF-13).
- O script `audit-wardrobe-flow` só usa objetos sintéticos e cálculo puro de geometria. A seleção corrigida de osso vale para *novas importações*; não corrige automaticamente roupas antigas armazenadas com boneId errado.
- Não foi aplicado snapshot versionado de modelos e sets; alterações posteriores no Fabricador podem afetar personagens existentes enquanto não houver revisão imutável/pinning. R-35 permanece necessário.
- **Não** houve inspeção, upload, backup ou migração de arquivos reais; sem acesso ao perfil real do usuário. R-04 e R-15–R-17 permanecem abertos e sujeitos a consentimento e backup verificado.
- Matriz **AF-01–AF-20** e **ISO-01–ISO-15** não estão completas; testes de vida útil de áudio/RAF/worker, referências V2 de peça por índice, heads com zoom/DPI, importação de mídia e crash recovery ainda precisam de E2E.
- Bloqueio de rede foi implementado em *session* DEV AI, não com ACL/firewall/container a nível do sistema. 
- Isso **não** declara R-01/R-02/R-05/R-25/R-26 globalmente concluídos. Mostra que a base já está executável/reproduzível para a refatoração segmentada, mas nem todos os critérios do roadmap foram provados.

## Handoff seguinte priorizado

**P0 / imediata:** R-29/30/36 (fixture raster e diagnóstico por osso/pose/categoria; comparar roupa 1.0 e 2.0 em preview original versus Character). **P0 / logo após:** R-31/33 (motor de transformações e referencial head-local compartilhado, cabelo/óculos/pose); R-32/34 (herança por personagem, render único consumido por Studios, sem imports de UI); R-35/37 (revisões de assets e golden E2E de AF-01–20). **Depois de backup e recuperação verificados:** R-38 + R-07–R-09/R-15–R-17 (migração de acervos legados, sempre dry-run opt-in). **Paralelo independente:** completar R-03 performance com 20 repetições/idle e ISO-03..15, restrição OS de rede/ACL, worker, keyboard, lifecycle e acessibilidade.

Este registro não é autorização para editar dados reais.
