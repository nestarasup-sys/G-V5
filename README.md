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

**Estado:** os documentos descrevem mudanças futuras; não significam que a migração de dados, o runner DEV AI, novas ferramentas ou as otimizações já tenham sido implementados. O código de runtime e os comandos de desenvolvimento acima continuam sendo o estado atual até mudanças testadas e aprovadas.

## Baseline DEV AI e auditorias locais

A branch de baseline acrescenta um runner **CLI**, ainda inicial, sem painel, sem telemetria e sem modificar documentos do usuário. Os comandos são:

```powershell
npm test
npm run audit:list
npm run audit:boundaries
npm run audit:fast
npm run audit:isolation
npm run audit:all
```

`npm test` usa `node:test` e não depende de Electron. `audit:list` descreve as 12 auditorias legadas e seus pré-requisitos. `audit:boundaries` lista imports cruzados existentes, **sem falhar por eles**: é diagnóstico estático inicial, não uma barreira de segurança. `audit:fast` executa somente sete auditorias com fixtures sintéticas; precisa de `npm ci` previamente. `audit:isolation` executa `typecheck`, `build` e a auditoria visual Studio → Video Studio → Studio em janela Electron **oculta**. Essa auditoria ainda usa **preload simulado** e não prova IPC ou persistência reais. `audit:all` combina fast e isolation; não inclui auditorias que usam vídeo externo nem o script `audit-animator-rig` que, sem argumento, lê `APPDATA`.

Relatórios da execução ficam em `out/dev-ai/runs/<run-id>/report.json` e são ignorados pelo Git. `passed` indica somente a cobertura da suite executada; `inconclusive` e código de saída 2 indicam ferramenta/dependência ausente ou etapa não executada. Antes de executar, consulte [runbook e limites](docs/refactor/AUDITORIAS/BASELINE_DEV_AI_2026-10-18.md). Não aponte essas auditorias para arquivos de usuário. A suíte de integração com IPC Electron real e a medição de baseline de desempenho são etapas futuras, abertas no roadmap.
