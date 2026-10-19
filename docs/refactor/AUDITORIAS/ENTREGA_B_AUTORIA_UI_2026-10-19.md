# Entrega B — autoria de assets pela interface real

## Cobertura local atualizada — Prompt 2 (2026-10-19)

O adapter existente `scripts/dev-ai/asset-ui-authoring.cjs` foi ampliado; não foi criado outro runner. O cenário usa o app compilado, React, Web Workers, preload e IPC Electron de produção. Só o diálogo nativo de arquivo é interceptado para selecionar mídia gerada dentro do sandbox sintético.

### Modelos Dev

- Importa pela UI uma PNG sintética de **1122 × 1402**, dividida em 10 componentes desconectados.
- Confere quantidade, identificação semântica (cabeça, tronco, braços, antebraços, coxas e canelas) e cada caixa de origem com a margem de recuperação de 4 px produzida pelo Worker.
- Exige IDs únicos, `sourceTransform.anchorVersion`, pivôs finitos, camada e juntas que apontam para IDs existentes.
- Confere que o `sourceDataUrl` persistido e o arquivo original no slot têm o SHA-256 idêntico à PNG selecionada.
- Seleciona extensão incompatível e PNG malformada pelo controle de importação da UI. O app apresenta os erros, preserva IDs e projeto existentes e deixa o hash da árvore do Fabricador inalterado.
- Navega para fora e retorna à área; compara IDs, nomes, geometria de origem e pivôs. O segundo processo Electron repete a leitura após reiniciar.

### Poses Dev

- Cria e salva as poses dos slots 1 e 2 por controles da interface, em categorias Parado e Sentado.
- Pose 1 gira o braço direito em 15° e move sua posição X em 11 px. Pose 2 gira o antebraço esquerdo em −15° e desloca X em −17 px.
- Compara os conjuntos completos de transformações; exige que sejam diferentes, que os membros mantenham referência a uma junta, que a ordem de camadas corresponda à do modelo e que posições/rotações persistam após reinício.

### Roupas Dev unificado e Customizador

A PNG de roupas possui nove componentes separados, todos colocados sobre a folha de referência do corpo: camisa/tronco; duas coxas; duas canelas; dois sapatos; e duas luvas. Cada componente é selecionado no catálogo React, recebe categoria e `partId` explicitamente e é salvo pelo IPC real.

As assertions verificam posição, dimensões, rotação, imagem persistida e valores do vínculo bone-local. Cada recorte visível deve continuar dentro do `sourceTransform` da peça correspondente; os sapatos precisam apontar para as canelas corretas e as luvas para os antebraços corretos. A luva esquerda recebe deslocamento, escala horizontal/vertical independentes e rotação de 4° pela UI, e esses valores e o binding precisam sobreviver ao save/load.

O Customizador cria um personagem pela interface, equipa camisa, o conjunto de calça, os dois sapatos e as duas luvas pelas bibliotecas correspondentes e confirma todos os nove `componentId`. O estado do personagem precisa manter offsets em 0, escalas em 1 e rotação em 0: o encaixe publicado pelo Fabricador é suficiente para aplicar o conjunto sem reajuste individual. A imagem final do overlay precisa carregar. A hash do namespace do Fabricador permanece idêntica à registrada após publicar o conjunto.

## Correções de produto encontradas pela fixture

- O Worker de Modelos Dev nomeava antebraços como braços e coxas/canelas genericamente como pernas. Ajustou-se a classificação aproximada por posição para separar braço/antebraço e coxa/canela; a fixture agora exige os quatro nomes bilaterais esperados.
- `fabricator:import-model` copiava o arquivo ao slot antes de rejeitar extensões/conteúdo incompatíveis. O handler agora valida extensão, assinatura, decodificação e limite de pixels antes de criar arquivos. Os dois testes negativos confirmam que o slot e o modelo anterior não são alterados.

## Evidências reproduzíveis

Último run completo aprovado: `2026-10-19T06-30-58-800Z-73311523-403a-459a-ac32-6354deaf3a68` (`npm run audit:all`, Windows). Os artefatos estão localmente em `out/dev-ai/runs/<run-id>/studio-ipc-real-artifacts/asset-ui-authoring/` e são ignorados pelo Git:

- `report.json` — IDs, nomes, source frames, âncoras, layer order, referências de junta, categorias, `partId`, posição/escala/rotação, bone-local bindings, hashes de imagens e estados equipados.
- `restart.json` — confirmação em um novo processo Electron dos IDs e dados persistidos.
- `01-model-ui.png`, `02-pose1-ui.png`, `03-pose2-ui.png`, `04-wardrobe-ui.png`, `05-customizer-equipped-ui.png`, `06-model-reopened-ui.png` — capturas estabilizadas por quatro capturas consecutivas iguais.
- SHA-256 da folha de modelo: `3280212a91334293c80095d0fc0a13dd725a4abee92aff8ed9c08447ff37a544`.
- SHA-256 da PNG de roupas: `a62820deda387ffda1ad9e8ad2a491c2f94b2d4269b4d759f6650e821ef9df57`.
- SHA-256 do screenshot final do Customizador: `318cbeecc308cdd8fddc63ae460ac3e0a4f25ec00d7922b8f8bd7aacb77d1fe1`.

Exemplo de árvore de artefatos do último run: `out/dev-ai/runs/2026-10-19T06-30-58-800Z-73311523-403a-459a-ac32-6354deaf3a68/studio-ipc-real-artifacts/asset-ui-authoring/`. Os screenshots e saves são sintéticos; não versionar esse diretório nem copiar dados do usuário para ele.

## Validação local

| Comando | Resultado |
| --- | --- |
| `npm test` | Passou: 26 aprovados, 0 falhas, 2 ignorados (um porque `out/` já existia e outro por bloqueio de symlink do SO). |
| `npm run typecheck` | Passou no run final. |
| `npm run build` | Passou no run final. |
| `npm run audit:boundaries:gate` | Passou: 22 arestas observadas, 10 legadas permitidas, zero regressões novas. |
| `npm run audit:all` | Passou no Windows; todas as 13 fases, incluindo `studio-ipc-real`, passaram no run `2026-10-19T06-30-58-800Z-73311523-403a-459a-ac32-6354deaf3a68`. |

## Cobertura parcial e pendências

Esta é prova E2E sintética da autoria descrita acima, não a conclusão de AF-01…AF-09. Os IDs aleatórios são verificados como estáveis durante save, abertura e reinício do mesmo asset; não se exige que uma nova importação independente gere os mesmos UUIDs. A PNG de corpo tem peças retangulares sintéticas e testa geometria, pivôs e camada, mas não substitui um rig humano complexo.

O cenário cobre agora os dois lados de coxa, canela, sapato e luva, porém ainda não cobre variações de proporção/modelos, malhas com sobreposição real, todos os tipos de folha, múltiplos personagens com ajustes divergentes, 100 alternâncias, dados legados 1.0/2.0 em autoria UI ou comparação canônica de pixels entre Customizador, Studio normal e Video Studio. A captura do Customizador demonstra o cenário montado e o teste valida transforms neutros, mas não é um golden pixel contra render independente dos três ambientes. Erros de exceção dentro do Worker e falhas de escrita em disco também precisam de cenários separados.

AF-01…AF-09 e ISO-01…ISO-15 permanecem abertos até seus critérios integrais e evidências do documento de fluxo serem cumpridos. A aprovação local não é CI Linux/Windows no mesmo SHA nem publicação remota.

## Revisão final da sequência — Prompt 5 (2026-10-19)

Na revisão consolidada, `npm run audit:all` passou novamente no Windows no run `2026-10-19T07-58-23-245Z-96124ae5-3020-4e77-a8e9-70cd01a1abca` antes da extensão final do teste de recuperação. Foram revisados o pipeline de importação UI, Worker, preload/IPC real, persistência do catálogo sintético e isolamento por `userData`. A prova de paridade dos três consumidores está registrada separadamente na [Entrega D](ENTREGA_D_PARIDADE_AF13_2026-10-19.md).

O Prompt 5 adiciona recuperação legível do manifesto de personagens se `characters.json` estiver ausente e existir `characters.json.backup`. O teste IPC real simulou essa janela no sandbox e exigiu bytes/IDs de A e B idênticos; o teste equivalente recuperou as nove peças do conjunto. Resultado no `audit:all` `2026-10-19T08-07-29-925Z-89ea8c51-c331-4f5c-8a0e-df7a1aac5c27`. Isso testa recuperação de manifesto, não interrupção física do processo, flush/fsync, disco cheio ou atomicidade de todos os arquivos de imagem. Ver o relatório final consolidado em [FINAL_PROMPT_5_2026-10-19.md](FINAL_PROMPT_5_2026-10-19.md).
