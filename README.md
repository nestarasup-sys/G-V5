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
