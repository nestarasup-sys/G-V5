# Gacha Nymi

Aplicativo desktop de trabalho em português brasileiro. A tela inicial começa vazia, com uma barra superior no topo.

## Requisitos

- Node.js 20.19+ ou 22.12+
- npm

## Desenvolvimento

No Windows, abra `ABRIR_DESENVOLVIMENTO.bat`. O inicializador instala as dependências e o executável do Electron quando necessário. O modo de desenvolvimento atualiza a interface automaticamente e recarrega o Electron quando arquivos do processo principal ou preload mudam. Mantenha a janela do terminal aberta enquanto trabalha.

Também é possível iniciar pelo terminal:

```powershell
npm install
npm run dev
```

## Verificações e build

```powershell
npm run typecheck
npm run build
```

## Estrutura

- `electron/`: processo principal e preload seguro do Electron.
- `src/renderer/`: interface React e estilos.
- `electron.vite.config.ts`: configuração dos bundles main, preload e renderer.

O renderer não recebe acesso direto ao Node.js. Novas capacidades nativas devem ser expostas pelo preload usando APIs estreitas e tipadas.

## Plano de refatoração e qualidade do produto

O projeto possui um [plano de refatoração integral](docs/PLANO_ESTRUTURA_PROJETO_E_DADOS.md) com diagnóstico estático, arquitetura proposta, proteção de dados, isolamento entre Studio normal e Video Studio, segurança, desempenho e testes DEV AI offscreen. Consulte o [índice documental](docs/refactor/README.md) para as fontes de verdade de cada assunto e o [roadmap executável](docs/refactor/ROADMAP_EXECUTAVEL.md) para tarefas, dependências, riscos, rollback e critérios de aceite.

**Estado atual da branch de testes:** o runner DEV AI e as auditorias sintéticas existem, incluindo integração com Electron/IPC reais. **Não** significam que migração de dados, matriz ISO-01–ISO-15 completa ou otimizações estejam concluídas. O aplicativo real não foi migrado e o próximo gate exige evidências de GitHub Actions e revisão de regressões.

## Baseline DEV AI e auditorias locais

A branch de fundação mantém um runner **CLI**, sem painel ou telemetria; a integração Electron roda exclusivamente com dados sintéticos. O teste de regressão real compara PNGs decodificados com limites explícitos, salva diff/relatório e **falha** em diferenças relevantes; aprovação de um workflow depende do SHA testado. Os comandos são:

```powershell
npm test
npm run audit:list
npm run audit:boundaries
npm run audit:boundaries:ast
npm run audit:fast
npm run audit:isolation
npm run audit:ipc
npm run audit:all
```

`npm test` usa `node:test` e não depende de Electron. `audit:list` descreve as auditorias e seus pré-requisitos. `audit:boundaries` lista imports cruzados com matcher legado; `audit:boundaries:ast` usa parser TypeScript para diferenciar imports apenas de tipo, runtime e reexports. **Ambos são diagnósticos**, não gates estritos nem autorização automática de acoplamento. `audit:fast` executa sete auditorias com fixtures sintéticas; precisa de `npm ci` previamente. `audit:isolation` executa `typecheck`, `build` e a auditoria visual Studio → Video Studio → Studio em janela Electron oculta, ainda com preload simulado. `audit:ipc` executa o app compilado com preload/IPC reais em `userData` sintético, validando mutações, namespaces, reinício de processo e root inválido. `audit:all` combina fast, isolation e IPC; não inclui auditorias que usam vídeo externo nem o script `audit-animator-rig` que, sem argumento, lê `APPDATA`. O runner não aplica bloqueio de rede em nível de SO. Consulte [resultados e limites do DEV AI em Windows](docs/refactor/AUDITORIAS/VALIDACAO_WINDOWS_2026-10-18.md).

Relatórios da execução ficam em `out/dev-ai/runs/<run-id>/report.json` e são ignorados pelo Git. `passed` indica somente a cobertura da suite executada; `inconclusive` e código de saída 2 indicam ferramenta/dependência ausente ou etapa não executada. `audit:ipc` usa dados sintéticos e testa preload/IPC/storage reais com reinício. Antes de executar, consulte [runbook e limites](docs/refactor/AUDITORIAS/BASELINE_DEV_AI_2026-10-18.md) e [validação Windows](docs/refactor/AUDITORIAS/VALIDACAO_WINDOWS_2026-10-18.md). Não aponte essas auditorias para arquivos de usuário. Benchmark e suíte de isolamento completa permanecem abertos no roadmap.

## Integração contínua DEV AI

O workflow [G-V5 DEV AI Foundation](.github/workflows/dev-ai-foundation.yml) executa `npm ci`, unit tests e auditorias rápidas no Linux, e a suite completa com Electron/IPC real no Windows. Dispara apenas em pushes da branch `ci/dev-ai-*` ou manualmente; **não** faz merge, release nem usa credenciais de escrita. Os artefatos do GitHub Actions têm retenção de sete dias e contêm apenas diagnósticos de **fixtures sintéticas** em `out/dev-ai/runs`, incluindo capturas PNG de regressão; não envie nem importe bibliotecas pessoais para essa CI.

O relatório de comparação visual fica em `studio-ipc-real-artifacts/real-ipc-visual-comparison.json`, e a imagem de diferença em `real-ipc-studio-visual-diff.png`. A validação aguarda duas capturas temporalmente estáveis; o teste não é relaxado automaticamente para aprovar a UI. Para análise, consulte [guia de CI e troubleshooting](docs/refactor/AUDITORIAS/CI_DEV_AI_2026-10-18.md).
