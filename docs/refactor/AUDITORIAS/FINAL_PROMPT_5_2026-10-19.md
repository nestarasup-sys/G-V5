# Relatório final — sequência de cinco prompts

Data da revisão: 2026-10-19
Repositório: `nestarasup-sys/G-V5`
Pasta: checkout original `C:\TRABALHO 2\OUTROS\GACHA NYMI V5`
Branch de trabalho/publicação autorizada: `master-desenvolvimento`
Base da sequência: `cde43a930754fa82f3aa368089d7162c5bae918f`

## 1. Estado inicial e revisão do histórico

No início do Prompt 5, `git status --short --branch` mostrou árvore limpa e `master-desenvolvimento` quatro commits à frente de `origin/master-desenvolvimento`. O primeiro SHA local da sequência foi `1961cf1`; o checkout já estava na branch permanente correta. Os quatro commits da sequência são:

| Commit | Resumo |
| --- | --- |
| `1961cf1` | Registrar revisão técnica e linha de base da Entrega B |
| `d200bb5` | Fortalecer autoria sintética E2E pela UI |
| `3624c9b` | Cobrir formatos legados, recuperação e independência entre personagens |
| `983600f` | Integrar assets de autoria UI à comparação AF-13 |

O estado local de `master` permaneceu em `5b84834`; nenhum commit desta sequência foi criado nela. Nenhuma branch foi criada durante os Prompts 1–5. A lista local contém branches de tarefas/backups anteriores à sequência; o histórico novo está exclusivamente em `master-desenvolvimento`.

## 2. Alterações por módulo e arquivo

- `scripts/dev-ai/asset-ui-authoring.cjs`: fluxo real de autoria Modelos Dev → Poses Dev → Roupas Dev → Customizador por React, Worker, preload e IPC de produção. Gera PNGs apenas dentro do sandbox e testa componentes bilaterais, joins, encaixes, erros, dois personagens e poses após reabertura.
- `scripts/dev-ai/studio-ipc-driver.cjs` e `scripts/audit-studio-ipc.cjs`: usa os assets efetivamente criados pela UI; captura seis estados no Customizador, Studio e Video Studio; mede componentes/joelhos, pixels e hashes; reabre snapshots no Electron reiniciado.
- `electron/main.ts`: valida formatos e conteúdo de imagem antes de escrever o modelo; publicação recuperável de manifestos de personagens/conjuntos; leitura recupera backup do manifesto de personagem ausente antes de semear dados iniciais.
- `src/renderer/src/features/fabricator/models/imageProcessor.worker.ts`: melhora a identificação aproximada de braço/antebraço e coxa/canela na fixture de modelo.
- `src/renderer/src/features/fabricator/wardrobe/WardrobeWorkspace.tsx` e `scripts/audit-wardrobe-flow.mjs`: diagnóstico explícito de vínculos incompatíveis e testes de leitura legada/rebase sem migração implícita.
- `.github/workflows/dev-ai-foundation.yml`: acrescenta os artefatos sintéticos novos de AF-13 UI-authored no upload da execução Windows.
- `docs/refactor/ROADMAP_EXECUTAVEL.md`, fluxo de assets, política de recuperação, DEV AI e auditorias B/C/D: registra o alcance medido e conserva os gates parciais em aberto.

As alterações de produto são pequenas e dirigidas pelos casos de teste. Não houve refatoração ampla de renderizador nem mudança de contrato IPC público.

## 3. Funcionalidades e cobertura realmente executadas

- Importação real de PNG de modelo pela UI, detecção de dez partes, geometria `sourceTransform`, âncoras/pivôs, IDs, layer order e preservação/hash do original.
- Duas poses UI-authored com transformações distintas e membro articulado; save/load e reinício.
- Conjunto UI-authored com nove peças: camisa, coxas, canelas, sapatos ligados às canelas e luvas ligadas aos antebraços. Vínculos, posição, escala, rotação e equipamento inicial neutro foram verificados.
- Formatos antigos 1.0/2.0: leitura/rebase de fixture, diagnóstico para osso inexistente, sem migração em lote nem publicação ao abrir; save explícito e reabertura verificados.
- Personagens sintéticos A/B no mesmo modelo/conjunto: override e peça deslocada em A, override independente em B, duas poses, isolamento de valores e persistência em processo Electron novo.
- AF-13: seis aparências realmente UI-authored comparadas entre Customizador, Studio normal e Video Studio. São 18 capturas de personagem e comparações par a par em resolução nativa; nove componentes têm geometria medida por imagem/cor; joelhos medidos por overlap projetado; hashes de fonte preservados.
- Após reinício, os snapshots persistidos de todos os cenários são hash-verificados. A cena final de cada ator é reaberta nos dois Studios e comparada ao snapshot por pixels decodificados, com tolerância zero.
- Recuperação sintética: estado de interrupção simulada movendo o manifesto comprometido para `.backup`; a leitura IPC restaura os bytes e IDs de personagem e roupas. Tudo ocorre sob `out/dev-ai/runs/<run-id>/sandbox/electron-user-data`.

## 4. Testes locais e resultados

### Execução local final antes da reconciliação remota

`npm run audit:all` passou no Windows no run `2026-10-19T08-07-29-925Z-89ea8c51-c331-4f5c-8a0e-df7a1aac5c27`. Ele executou no conteúdo de trabalho após o commit `983600f` e incluiu a correção/teste de recuperação do Prompt 5. O campo `commit` do JSON guarda HEAD no começo (`983600fb57e7681add882814ab85e519203e4960`), portanto o artefato não identifica os arquivos não commitados do Prompt 5 por SHA. O commit final será verificado no workflow GitHub, que testa exatamente o SHA publicado. Os relatórios locais ficam sob `out/dev-ai/runs/` (ignorado pelo Git) e são sintéticos.

| Comando | Resultado esperado a registrar após a execução final |
| --- | --- |
| `npm test` | Passou: 26 aprovados, 0 falhas, 2 skips locais explicados |
| `npm run typecheck` | Passou |
| `npm run build` | Passou |
| `npm run audit:boundaries:gate` | Passou: 22 arestas, 10 legadas permitidas, 0 regressões novas |
| `npm run audit:all` | Passou: 13 casos, 0 `unsupported`, 0 falhas; IPC Electron real, isolamento, fixtures, recovery e restart incluídos |
| `git diff --check`, `node --check` nos drivers | Passaram |

O skip de `out/ symlink` informa que `out/` já existe e não deve ser alterado; o teste é deliberadamente não destrutivo. O skip de symlink do boundary scanner indica que o SO bloqueou criá-lo. São limitações do ambiente local, não sucessos desses cenários. Todos os 13 casos de `audit:all` passaram; nenhuma fase foi `unsupported` ou `skipped` naquele run. GitHub Actions fornece o resultado Windows/Linux no SHA publicado; link estável: [workflow DEV AI Foundation](https://github.com/nestarasup-sys/G-V5/actions/workflows/dev-ai-foundation.yml?query=branch%3Amaster-desenvolvimento). O status pós-publicação será reportado com o SHA e execução observados, sem inferência antecipada.

## 5. Relatórios e evidências

- [Entrega B — autoria UI](ENTREGA_B_AUTORIA_UI_2026-10-19.md): PNG original, geometria, IDs, bindings, erro de importação, equipamento e reabertura.
- [Entrega C — compatibilidade e personagens](ENTREGA_C_COMPATIBILIDADE_E_PERSONAGENS_2026-10-19.md): legados, deltas A/B, hashes e recuperação após restart.
- [Entrega D — paridade AF-13](ENTREGA_D_PARIDADE_AF13_2026-10-19.md): seis cenários, screenshots, diffs, pixels, geometria e limitações.
- [Revisão da Entrega B](REVISAO_ENTREGA_B_2026-10-19.md): análise de seletores, adapters e prova exercitada.
- Capturas completas, PNGs, JSONs e diffs ficam apenas no diretório local ignorado `out/dev-ai/runs/<run-id>/studio-ipc-real-artifacts/`; a CI anexa relatórios e screenshots sintéticos por sete dias.

## 6. Problemas encontrados e corrigidos

1. Worker aproximava braço/antebraço e classificava coxa/canela genericamente. A heurística atualizada é validada pelas quatro partes na autoria UI.
2. Importação podia copiar conteúdo de formato incompatível antes de rejeitar. A validação de extensão, assinatura, decodificação e dimensões precede a escrita; testes negativos verificam fonte/biblioteca inalteradas.
3. Um conjunto legado incompatível não expunha diagnóstico adequado. A UI agora sinaliza vínculo ósseo inválido sem substituir o ID ou migrar silenciosamente.
4. Harness AF-13 tentava salvar elenco antes do estado React de seleção; agora espera a seleção efetiva. A leitura de preview aguarda pose/modelo corretos e imagem estável.
5. A checagem de joelho aplicava requisito de encaixe ao override de B que deslocava a peça além da interseção. O teste agora separa o deslocamento intencional de A do override moderado de B e ainda exige diferença geométrica própria e overlap.
6. Reabertura comparava cena histórica com personagem deliberadamente alterado em cenários seguintes. Os hashes de todos os snapshots são mantidos; a igualdade visual pós-reinício é conferida nos estados finais consistentes de A/B.
7. Revisão final identificou que manifesto de personagem ausente com `.backup` poderia cair na semeadura inicial antes da recuperação. A leitura agora restaura primeiro e um teste real de IPC reproduz essa janela no sandbox.

## 7. Limitações e requisitos AF/ISO em aberto

- AF-13 não está totalmente concluído. A fixture tem partes retangulares/cor sólida; overlap de bounding boxes de joelho não comprova cobertura alfa nem ausência de pele em roupa real.
- Não há cabelo/acessório de cabeça UI-authored integrado a esta prova, nem toda combinação de cabelo/rosto/expressão/layer.
- Os casos automatizados não substituem inspeção do usuário em um personagem real e fechamento/reabertura visual. Esse é o objetivo restante do Prompt 5.
- AF-01…AF-20 permanecem abertos até seus critérios integrais; ISO-01…ISO-15 também. O gate de fronteiras permite dez arestas legadas observadas; passar significa ausência de nova dívida, não arquitetura isolada completa.
- Não foram executados fault injections de kill real, queda de energia, `fsync`, disco cheio, gravação concorrente, manifesto truncado, restore de backup completo ou atomicidade de grupos de PNG/vídeo. Recuperação implementada é de manifesto e parcial.
- O runner declara `network: not-invoked-by-runner; NOT OS-level blocked`; não alegar isolamento de rede de sistema operacional.
- A validação local é Windows. CI Linux valida unidade/arquitetura/build/fast suite; o workflow Windows valida Electron/IPC visual. Não marcar equivalência de ambientes além dessas suítes.

## 8. Privacidade, bibliotecas originais e sandbox

O `userData` de produção e bibliotecas reais não foram abertos, copiados, editados ou migrados. A autoria usa PNGs gerados para teste e nomes reservados; as rotas de filesystem dos testes apontam ao sandbox sintético. A leitura/edição de recuperação foi verificada somente em manifests sob o `userData` temporário do runner. Arquivos `out/`, screenshots, personagens de fixture e relatórios permanecem ignorados pelo Git. `git ls-files` não inclui `out/dev-ai`; a revisão de diff limita-se aos 14 arquivos documentados, sem dados pessoais, imagens privadas, backups ou perfis preparados para commit.

## 9. Próximas recomendações

1. Conferir no GitHub Actions o run do SHA exato publicado e confirmar ambos os jobs Linux/Windows.
2. Fazer a validação manual prometida: mesmo personagem real nos três ambientes, comparar joelhos, camadas, sapatos/acessórios e alterações por pose; salvar, fechar completamente e repetir.
3. Se houver diferença, registrar asset/pose/transform visível e corrigir o primeiro ponto divergente sem ampliar tolerâncias.
4. Antes de declarar AF-13 ou AF-01…20, acrescentar fixture com alpha/contorno sobreposto e acessórios de cabeça válidos, cumprir cobertura de camadas e testar o lifecycle de snapshots.
5. Expandir recuperação com kill-at-checkpoint e falhas IO apenas em sandbox sintético; não habilitar migração de bibliotecas reais sem backup/restore verificável e autorização própria.

## 10. Publicação

Publicação autorizada somente nesta rodada: `origin/master-desenvolvimento`. Nenhum merge, PR ou push em `master` faz parte desta entrega. Antes do push será feito `git fetch origin` e verificação fast-forward; se a remota tiver avançado, os commits serão reconciliados sem descarte e os testes afetados repetidos. O SHA remoto e as conclusões reais de Actions serão registrados no relatório final da resposta depois da execução.
