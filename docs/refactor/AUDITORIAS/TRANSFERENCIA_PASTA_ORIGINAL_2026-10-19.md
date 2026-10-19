# Transferência para a pasta original

Pasta de trabalho definida pelo usuário:
`C:\TRABALHO 2\OUTROS\GACHA NYMI V5`.
As próximas alterações devem ser feitas nesta pasta.

## Origem e preservação

- Original antes da transferência: `69eb913a228c121bf1cb2fd98c9a2ebe58c764f7`,
  branch `codex/dev-ai-validation-2026-10-18`.
- Ponto de recuperação local: `codex/backup-original-before-af13-transfer`.
- Origem das mudanças: `codex/af13-cross-studio-equivalence`,
  pasta `GACHA NYMI V5-raster-continuation`, até `982bd90`.
- A atualização do BAT foi desfeita na origem em `21ac86a`.
- Aplicação pela diferença desde a base comum `eab0084`, com resolução de três
  vias, sem merge de branches, troca de master ou substituição da pasta inteira.
  Inclui as dependências de validação/asset flow e as correções AF-13.
- Quarenta e sete arquivos de código, scripts, configuração e documentação
  transferidos antes deste registro. Os arquivos coincidem com `21ac86a`, exceto
  `WardrobeWorkspace.tsx`, que também preserva alterações da pasta original.
- O conflito em `WardrobeWorkspace.tsx` foi resolvido mantendo a folha original
  completa na prévia, a escala mínima de 0,05 e a espera pela imagem de referência,
  além dos controles e correções de roupa transferidos.
- Nenhum salvamento, imagem pessoal, perfil Electron, `node_modules` ou diretório
  de evidências foi copiado ou sobrescrito entre as pastas. O build foi regenerado
  dentro da pasta original.

## BAT

`ABRIR_DESENVOLVIMENTO.bat` permanece no comportamento anterior: `npm run dev`.
Objeto Git original e após a transferência:
`2cb8e379ebe1783181252e3663cf485af7cecdf9`.
Não há encaminhamento do BAT para outra pasta.

## Validações executadas na pasta original

- `node scripts/audit-wardrobe-flow.mjs`: passou, incluindo 72 casos entre poses,
  conversão de folha original, preservação de vínculos e sapato/luva por osso.
- `npm test`: 26 aprovados, 2 pulados por restrições locais de symlink.
- `npm run typecheck`: passou.
- `npm run build`: passou.
- Nenhum conflito Git pendente; verificação de whitespace do código passou.
- Não foi aberta outra janela do aplicativo. A conferência visual continua
  com o usuário; AF-13 não é considerado concluído por esta transferência.
