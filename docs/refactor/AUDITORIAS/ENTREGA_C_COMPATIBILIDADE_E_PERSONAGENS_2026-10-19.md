# Entrega C — compatibilidade de roupas e isolamento por personagem

**Data:** 2026-10-19
**Branch:** `master-desenvolvimento`
**Escopo:** Prompt 3/5; somente fixtures sintéticas no sandbox DEV AI.

**Revalidação Prompt 5:** `audit:all` passou em `2026-10-19T08-07-29-925Z-89ea8c51-c331-4f5c-8a0e-df7a1aac5c27`; recuperação de manifesto de personagem e roupas após interrupção simulada passou junto da compatibilidade e do isolamento. Ver [relatório final](FINAL_PROMPT_5_2026-10-19.md).

## Resultado

A suíte DEV AI percorreu os formatos antigos de roupas, conversão explícita de referência, abertura e reabertura, falhas controladas e dois personagens associados ao mesmo modelo. Nenhuma biblioteca real do usuário foi lida ou alterada. O teste usa Electron, preload e IPC de produção em `userData` sintético; a mudança de roupa individual do personagem A é salva pelo preload de produção, enquanto seleção de personagens e poses passa pela interface React.

### Compatibilidade de conjuntos antigos

- Fixtures 1.0 e 2.0 foram carregadas sem reescrever seus arquivos ao abrir.
- O conjunto 1.0 permaneceu byte a byte inalterado. O 2.0 só foi rebaseado para a folha original após clicar explicitamente em **Salvar alterações**; ID do componente e vínculo válido ao osso foram preservados.
- Após salvar explicitamente, o conjunto 2.0 foi fechado/reaberto e manteve a geometria convertida: `x=522`, `y=334`, `width=162`, `height=285.6`, `rotation=8`.
- As hashes antes/depois foram registradas no `report.json`. Não houve migração em lote nem publicação automática ao abrir.
- Peça vinculada a `ghost-bone` gerou diagnóstico explícito no Fabricador Dev e seus bytes foram preservados. Conjunto com PNG ausente retornou ausência controlada, sem peça parcial.

### Dois personagens e reinício

- A e B foram criados e equipados com os mesmos nove componentes do conjunto sintético.
- Em A, o deslocamento da camisa foi `offsetX=220`, escala horizontal `1.05` e rotação `1°`; a peça deslocada para fora do tronco permaneceu salva ao alternar as poses 2 → 1 pela UI.
- B manteve todos os nove grupos em `offsetX=0`, `offsetY=0`, escala `1`, rotação `0` e pose 1. Nenhum delta de A apareceu em B.
- Um novo processo Electron confirmou persistência do modelo, poses 1/2, conjunto, IDs de componentes, valores do personagem A e defaults do personagem B.
- SHA-256 da árvore Fabricador sintética antes/depois das personalizações: `699f44ecbb8f589c7f8fd78d8663f01c12fc61b8142466eb0c93762c6fab1ae8` (inalterada dentro do cenário).

### Recuperação no Windows

Os testes reais de substituição revelaram que `rename(temp, existente)` pode falhar com `EPERM` no Windows, inclusive em salvamentos repetidos de conjuntos e personagens. A publicação agora move o manifesto anterior para `.backup`, instala o temporário e recupera o anterior em caso de falha. Na leitura, uma fila aguarda o save em curso e restaura o backup se o processo tiver parado entre as renomeações. Os testes do cenário IPC cobriram salvamentos repetidos; falha de energia real no meio de cada instrução não foi simulada.

## Evidências DEV AI

Run aprovado `2026-10-19T07-23-15-709Z-a4809fdf-aca8-4704-9fc6-4a50917bb433` (`npm run audit:all`, Windows). Diretório local ignorado pelo Git:

`out/dev-ai/runs/2026-10-19T07-23-15-709Z-a4809fdf-aca8-4704-9fc6-4a50917bb433/studio-ipc-real-artifacts/asset-ui-authoring/`

- `report.json`: seis fases, hashes, vínculos, geometrias, conversão legada, deltas de A/B e estados após save.
- `restart.json`: persistência comprovada em processo Electron novo.
- Capturas estabilizadas (4 capturas consecutivas): `07-legacy-v2-opened-before-save.png`, `08-legacy-v2-explicitly-saved-and-reopened.png`, `09-legacy-incompatible-bone-diagnostic.png`, `05-customizer-actor-a-adjusted-ui.png` e `06-customizer-actor-b-default-ui.png`.
- SHA-256 das capturas respectivamente: `58e284a081728d08d5e95152e10848872072ebc9709b3cc5b0725088d5db6467`; `d46856c9fe5f98716c1c874a58d8071db7741ca9fd9bc3d370022ffcdda09178`; `e2ad11e06a8df91fef6c17d69443e1448eb2c534de99de42bfd21fa160234543`; `f4ec03d558a570178f15f7e184dda1bc301889ae53874a2909e15e5c0470c641`; `9e088f2b735abb04753bc2688765a6b9db1fb26e83b1d159cf9c79d1c38e5cfe`.

## Validação executada

| Comando | Resultado |
| --- | --- |
| `npm test` | 26 aprovados, 0 falhas, 2 ignorados por condições locais documentadas pelo runner. |
| `npm run audit:boundaries:gate` | Aprovado; 22 arestas, nenhuma regressão nova. |
| `npm run audit:all` | Aprovado no run acima: typecheck, build e 11 auditorias, incluindo wardrobe-flow, compatibilidade 1.0/2.0, isolamento dos Studios e IPC real. |

## Limites e estado AF

Esta evidência cobre fixtures sintéticas e os fluxos definidos acima; não cobre o perfil real do usuário. A alteração de `offsetX`, escala e rotação de A é aplicada pela API preload de produção para reduzir a duração do cenário, não pelos controles de ajuste visual da UI. A navegação de personagens, a troca de poses, montagem, leitura/escrita, compatibilidade, diagnóstico, imagens e reabertura usam o app real. Isso não equivale a provar todos os ajustes pelo mouse/controles nem a equivalência visual entre Customizador, Studio e Video Studio.

AF-01…AF-09 e ISO-01…ISO-15 continuam abertos para seus critérios completos. Em particular, faltam UI de ajuste integral, variações mais amplas de rig/pose, falhas abruptas entre cada etapa de transação e a equivalência AF-13 nos três ambientes. O gate desta entrega é parcial e não autoriza migração de dados reais.
