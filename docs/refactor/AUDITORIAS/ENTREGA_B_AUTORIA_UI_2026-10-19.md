# Entrega B — autoria de assets pela interface real (2026-10-19)

## Implementação

Fase `asset-ui-authoring` do runner existente `npm run audit:ipc` / `npm run audit:all`, adicionada após as fases anteriores e seguida por `asset-ui-verify-restart` num segundo processo Electron. O teste usa **uma fixture PNG sintética e o app compilado**, nunca personagens reais.

- Fabricador **Modelos Dev**: pressiona o botão de importar na UI; somente o diálogo nativo é interceptado no processo Electron do teste, apontando para uma imagem synthetic `sandbox/dev-ai-ui-model.png` criada ali pelo runner. O handler **real** `fabricator:import-model`, o processamento Web Worker, a montagem React, autosave e real IPC persistem o modelo com dez recortes, seus `partId` e `sourceTransform`.
- Fabricador **Poses Dev**: pela UI cria/salva pose 1 e pose 2, muda rotação via controle da interface e verifica persistência.
- Fabricador **Roupas Dev unificado**: importa a folha PNG sintética pela entrada `<input type=file>` e pelo evento real de mudança, exercita Worker de roupas, classifica uma camisa e um sapato, fixa o sapato à canela correta por `partId`, salva conjunto com bindings no IPC.
- **Customizador**: abre a rota real, cria um novo personagem pelo formulário, seleciona o modelo e equipa a camisa pelo catálogo visível, exigindo override salvo e presença da camada visual. O teste verifica hash da biblioteca Fabricador antes/depois de equipar.
- **Reinício completo** do processo Electron: verifica personagem, modelo, roupa e pose 2 persistidos; arquivos e PNGs exclusivamente de sandbox na pasta `out/dev-ai/runs/<run-id>/studio-ipc-real-artifacts/asset-ui-authoring/`.

## Contratos de segurança e limites

Sem migração, escrita nos dados reais, rede livre, alteração de permissões ou novas APIs expostas ao renderer. Não há `NODE_ENV=development` com privilégio extra: o runner já exige marcador `.dev-ai-sandbox.json` e raiz dentro de `out/dev-ai/runs`. O diálogo mock só existe no **processo de teste** e recusa qualquer título que não corresponda à importação esperada.

Este cenário valida **apenas** os casos sintéticos construídos: dois poses e duas peças, modelo com 10 recortes. Não fecha a matriz AF-01..20, cobertura legado 1.0/2.0, variações de proporção, fluxo de cabeça/cabelo, nem igualdade pixel Studio/Video (Entrega C).

## Validação no SHA final

O workflow deve executar `npm test`, `typecheck`, build, gates e `audit:all` no Windows e Linux. Um erro dessa fase deve falhar o job Windows, com mensagem explícita; nenhum `unsupported` deve ser tratado como `passed`. A entrega só está pronta depois de inspeção do relatório do run final no GitHub.
