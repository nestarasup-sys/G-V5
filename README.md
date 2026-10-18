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
