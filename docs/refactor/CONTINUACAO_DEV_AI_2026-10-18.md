# Handoff para continuar a missão DEV AI e fluxo de assets

**Projeto:** G-V5 (`nestarasup-sys/G-V5`)  
**Branch entregue:** `codex/finalizar-dev-ai-local`  
**Base:** `feat/dev-ai-raster-continuation-2026-10-18` em `9ba244e397dd7aafcb7c8025392460519b60e773`  
**Objetivo:** continuar a missão ampla de completar a fundação DEV AI e provar/corrigir Fabricador → Customizador → Studio / Video Studio. Este handoff registra progresso real, mas **não declara a missão completa**.

## Estado Git desta entrega

Esta branch contém sete commits após a base:

1. `35c1ad8 test(dev-ai): assemble synthetic raster actor for private evidence`
2. `2b1bbcf test(dev-ai): isolate shoe geometry mask in raster evidence`
3. `5b82b5a test(dev-ai): validate real characters in private copies`
4. `9cecee3 docs: record clean local audit for dev ai continuation`
5. `4aff45d test(dev-ai): verify isolated character edit roundtrip`
6. `aefec0b [skip ci] docs: add DEV AI continuation handoff`
7. `8c31b2c [skip ci] docs: record continuation branch publication`

O commit `4aff45d71746a536baca22780e71e769f772ddec` foi o SHA do código testado por `npm run audit:all`. A branch `master` não foi modificada. O usuário pediu explicitamente para publicar esta branch; a publicação não autoriza merge nem alteração de `master`.

**Publicação confirmada:** `origin/codex/finalizar-dev-ai-local` foi criada e recebeu esta continuação. Não foi aberto PR, feito merge ou alterado `master`. O workflow `dev-ai-foundation.yml` só dispara em branches `ci/dev-ai-*` e `feat/dev-ai-*`; portanto esta publicação não executou Actions. A aprovação remota para o SHA publicado continua pendente e não deve ser inferida dos testes locais.

## Trabalho comprovado

- A fixture raster sintética tem modelo e partes com retângulos estáveis, duas poses, roupas, sapato, cabelo, rosto, óculos e dois atores. Geometria de sapato/acessório é verificada sem usar capturas de personagens reais nos testes automatizados.
- A comparação privada de Ayla e Chloe usa backup SHA-256 e cópias isoladas. Captura do Customizador encontrou transformações individuais nas duas personagens; reset foi aplicado somente à cópia de teste e produziu mudança visual mensurada.
- Um round trip adicional usa o preload e IPC de produção `window.desktop.saveCustomizerCharacter` em uma terceira cópia privada. Editou um grupo equipado de cada personagem, em processos Electron independentes. Provou que o outro personagem não mudou em cada edição, as duas alterações sobreviveram à abertura de processo novo, o Customizador renderizou mudança de pixels e os arquivos do Fabricador mantiveram hash estável.
- Comparação do perfil original antes/depois do último runner: nenhuma alteração durante a execução. O perfil atual tinha uma diferença em relação ao backup histórico, identificada antes de iniciar a rodada. O código registra a quantidade dessa divergência separadamente e não tenta restaurar o arquivo. Evidências, hashes e imagens reais ficam fora do repositório, em `%LOCALAPPDATA%\GachaV5PrivateValidation`.
- `npm test`: 24 passaram, 0 falharam, 2 ignorados por `out/` existente e symlink recusado pelo Windows.
- `npm run typecheck`, `npm run build`, `node --check` dos runners e `git diff --check`: passaram.
- `npm run audit:all`: 13/13 casos passaram no Windows/Node 24.18.0; run `2026-10-19T02-25-42-248Z-112f71fa-5fd2-4188-8c81-919186a9cd97`. O JSON local está em `out/dev-ai/runs/<run-id>/report.json` e não deve ser adicionado ao Git.
- O runner Electron usa janelas ocultas, não `offscreen: true`. A barreira de rede verificada é de requisições do renderer; firewall do sistema operacional não foi configurado nem testado.

Relatório detalhado: [AUDITORIAS/VALIDACAO_LOCAL_2026-10-19.md](AUDITORIAS/VALIDACAO_LOCAL_2026-10-19.md). Autoridade normativa e escopo aberto: [FLUXO_ASSETS_FABRICADOR_CUSTOMIZADOR_STUDIOS.md](FLUXO_ASSETS_FABRICADOR_CUSTOMIZADOR_STUDIOS.md), [ISOLAMENTO_STUDIOS_E_DEV_AI.md](ISOLAMENTO_STUDIOS_E_DEV_AI.md) e [ROADMAP_EXECUTAVEL.md](ROADMAP_EXECUTAVEL.md).

## O que estes testes ainda não demonstram

- Edição dos personagens clicando pelos controles da UI real; o novo round trip chama a API de salvamento exposta pela UI através do IPC de produção.
- Paridade visual/semântica do mesmo personagem no Customizador, Studio normal e Video Studio.
- Fluxo de autoria pelas UIs modernas do Fabricador, atualização/versionamento de biblioteca e consumo por personagem novo.
- Matriz integral AF-01–AF-20 ou ISO-01–ISO-15. As tabelas no relatório continuam sendo a fonte do estado caso a caso; vários itens estão parciais ou não demonstrados.
- `npm ci` limpo, Linux, benchmarks de produto, fault injection completo, recuperação de dados de produção, firewall de SO, CI remota ou aprovação GitHub Actions para o SHA desta entrega.

Não marcar AF/ISO como concluídos a partir de uma auditoria correlata. Em particular, o gate final do roadmap exige personagem recém-criado com pré-ajustes de fábrica, deltas privados sem mutação de biblioteca e equivalência comprovada nas duas áreas Studio.

## Próximos passos para a próxima IA

1. Começar por `git status --short --branch`, `git rev-parse HEAD` e `git fetch origin`; preservar a branch de continuação, nunca resetar ou limpar arquivos gerados do usuário.
2. Ler as fontes de verdade e auditorias listadas no objetivo da missão, o roadmap completo R-01–R-38, a especificação AF-01–AF-20, a matriz ISO-01–ISO-15 e este relatório. Usar os casos abertos como plano, sem recomeçar o harness.
3. Executar a CI remota no SHA publicado somente se o usuário autorizar/solicitar essa validação. A branch `codex/*` não corresponde ao filtro de branches do workflow atual; não alegar resultado remoto baseado em testes locais.
4. Priorizar reproduções UI reais e isoladas para AF-07/08/13/14: criar/abrir personagem via interface, editar ajuste individual sem tocar biblioteca, fechar/reabrir, validar cena nos dois Studios e provar a propriedade com hashes mais comparação de imagens na mesma escala/DPI.
5. Investigar sem escrita a diferença única já existente entre o perfil atual e o backup privado de referência. O caminho/valor e a imagem não devem ir para GitHub. Criar snapshot novo antes de qualquer nova comparação com o perfil atual; não restaurar backup antigo sobre dados atuais.
6. Expandir a suíte por critérios explícitos para ISO e AF; separar `confirmed in execution`, `observed statically` e `not demonstrated`. Registrar cada comando, SHA, ambiente, artefato local e limites.
7. Fazer commits pequenos na branch de continuação. Não fazer merge em `master` sem pedido explícito.

## Privacidade e execução remota

Não incluir backups, relatórios de hashes ligados a dados pessoais, screenshots ou conteúdo de Ayla/Chloe no Git, Actions, artifacts, issues ou logs remotos. O upload desta branch contém apenas código e documentação. O envio não equivale a merge; nenhum resultado de GitHub Actions deve ser presumido.
