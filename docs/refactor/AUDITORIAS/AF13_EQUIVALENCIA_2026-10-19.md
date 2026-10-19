# AF-13 — equivalência visual: validação em andamento

Branch: `codex/af13-cross-studio-equivalence`, baseada em `31a7f830`.

**Estado na rodada original (histórico): pendente de confirmação visual manual.** O usuário assumiu o teste
visual e relatou pele visível nas juntas dos joelhos apesar da cobertura no
Roupas Dev 2.0. Esse relato impede considerar AF-13 concluído.

## Evidência automatizada anterior ao relato

- Fixture sintética ampliada em `79e96d7`: modelo de dez partes, duas poses,
  camisa, sapato, óculos, cabelo frontal/traseiro, olhos, sobrancelhas, nariz,
  boca e acessório de cabeça. Nenhum perfil privado foi usado.
- Harness em `ade7efe`: composição das camadas reais do Customizador e PNGs
  gerados ao adicionar o mesmo personagem ao elenco dos dois Studios.
- `npm run audit:ipc` passou no run
  `2026-10-19T02-52-57-181Z-5c6ce1f9-ed33-42f5-b23f-c56fe23666f7`.
  Os artefatos locais estão em `out/dev-ai/runs/<run-id>/studio-ipc-real-artifacts/af13/`.
- A comparação remove somente margens transparentes; não redimensiona as imagens.
  Há capturas dos palcos e verificação dos hashes dos assets persistidos em
  outro processo Electron. As capturas não foram aprovadas por inspeção visual.
- **Limite relevante:** a fixture não inclui calça dividida em coxa/canela.
  O resultado automatizado não demonstra cobertura correta dos joelhos nem
  equivalência com a prévia de autoria do Fabricador.

## Correção motivada pelo teste manual

O Fabricador avaliava o conjunto completo para ativar os 18 pixels de cobertura
de joelho já existentes no teste de pose. O Customizador avaliava apenas os
componentes da seleção atual, que pode conter uma única peça. Nesse caso,
coxa e canela equipadas em seleções separadas nunca ativavam a mesma cobertura.

A regra agora reside em `wardrobePosePadding`, usada pelos dois renderizadores.
O Customizador reúne as peças visíveis selecionadas do mesmo conjunto/modelo
antes de avaliá-la. Peças não equipadas ou ocultas não ativam a cobertura.
Os bindings, imagens originais e ajustes individuais persistidos não são alterados.
A versão do render dos dois Studios passou de 4 para 5 para renovar snapshots.

Validações executadas após a correção:

- `node scripts/audit-wardrobe-flow.mjs`: passou, incluindo cobertura com
  seleções individuais, centro preservado, calça incompleta e fontes imutáveis.
- `npm run typecheck`: passou.
- `npm run build`: passou.
- `git diff --check`: passou.

## Próxima confirmação, pelo usuário

Reabrir o build desta branch e comparar o mesmo personagem/pose no Customizador,
Studio e Video Studio. Conferir joelhos, roupas e camadas; fechar completamente
o app e repetir a conferência. Registrar qualquer pele ainda visível, inclusive
o ambiente e a pose. A correção de código ainda não tem confirmação visual nas
peças reais mostradas pelo usuário.

## Ajustes de roupa ao alternar poses

Segundo relato manual: ajuste da calça no Customizador ficava inadequado ao
trocar de pose. A implementação aplicava offsets e escalas nos eixos do canvas,
depois do vínculo da roupa com o osso. O valor estava salvo globalmente no
personagem, mas seu efeito não acompanhava a orientação do membro.

A correção usa `adjustmentReference` por componente, contendo dimensões e
rotação do osso na pose em que o ajuste foi estabelecido. O render transporta
a transformação afim inteira entre esse referencial e o osso na pose atual.
Isso inclui offsets, rotação e escalas independentes, sem transformar apenas
a posição. Controles de movimento e arraste convertem o deslocamento da tela
para esse referencial, mantendo as direções visíveis dos controles.

Compatibilidade:

- Os ajustes antigos são ancorados usando a pose atualmente salva no personagem.
  A aparência nessa pose é preservada; não há informação para reconstruir a
  intenção de uma edição histórica realizada em outra pose não registrada.
- Grupos antigos com várias peças são separados com compensação do pivô,
  preservando o efeito visual de suas escalas/rotações na pose de referência.
- Assets/modelos/poses ausentes não são usados para adivinhar o referencial.
  A hidratação não sobrescreve uma edição feita durante o carregamento.
- Somente o documento do personagem recebe o novo campo. O Fabricador mantém
  seus assets e bindings. A validação IPC aceita documentos antigos e verifica
  os referenciais novos. Os dois Studios usam a versão 6 do render para renovar
  imagens persistidas, preservando os overrides locais pelo fluxo existente.

Validações após essa correção:

- `node scripts/audit-wardrobe-flow.mjs`: 72 comparações afins entre poses,
  transporte independente de pontos, escalas não uniformes, direção do arraste,
  conversão de grupos antigos, persistência JSON e imutabilidade das fontes.
- `npm test`: 26 aprovados e 2 pulados por restrições locais de symlink.
- `npm run typecheck` e `npm run build`: passaram.
- O oráculo raster/fixture do runner foi atualizado para o referencial por osso.
  A auditoria Electron não foi repetida nesta etapa; o usuário assumiu o teste
  visual. Os resultados Electron anteriores não comprovam esta nova correção.

Teste manual pendente: ajustar posição/largura/altura/rotação de uma peça;
alternar entre poses em pé e sentada; retornar à pose inicial; conferir também
nos dois Studios e após reiniciar. AF-13 permanece aberto até essa confirmação.

## Validação posterior à integração — 2026-10-19

- **Relato manual:** no código local `codex/dev-ai-validation-2026-10-18@6cfd0b5`, o usuário equipou outra roupa, deslocou o ajuste individual para fora do personagem, alternou poses e confirmou que **Studio e Video Studio acompanharam**. Não enviou screenshots, hashes nem relatou explicitamente teste de save/restart, autoria Fabricador ou todos os casos de joelho.
- **Automação:** [CI master #39198498661](https://github.com/nestarasup-sys/G-V5/actions/runs/39198498661) passou Linux e Windows no SHA `3b70ceef`. A regressão AF-13 sintética do PR #3 comparou imagens canônicas com resultado positivo; não cobre toda variedade de peças reais.
- **Status:** o cenário reportado de propagação do ajuste funcionou. AF-13 e R-31/R-34/R-37 **permanecem amplamente abertos** até prova E2E de autoria, joelhos, camadas, outras poses, save/restart e equivalência entre as áreas em fixtures completas.

## Entrega D — cenário sintético UI-authored nos três consumidores (2026-10-19)

A [Entrega D](ENTREGA_D_PARIDADE_AF13_2026-10-19.md) adicionou seis estados de AF-13 usando modelo, duas poses, roupas e personagens criados na interface pela automação da Entrega B. Foram capturadas as composições reais em Customizador, Studio e Video Studio, com comparação pixelar a resolução nativa, medições de cada componente, joelhos, hashes de persistência e reabertura em novo processo Electron.

No run `2026-10-19T08-07-29-925Z-89ea8c51-c331-4f5c-8a0e-df7a1aac5c27`, `audit:all` passou depois de incluir as provas de recuperação de manifesto do Prompt 5. Nos seis estados, a diferença foi zero pixels em cada par de consumidores. Dois estados finais (A e B) foram reabertos visualmente após reinício nas duas áreas Studio e tiveram zero pixels divergentes do snapshot guardado. A árvore do Fabricador e o manifesto de personagens mantiveram os mesmos SHA-256 durante o consumo.

O alcance continua sintético: nove componentes de roupas/luvas/sapatos, duas poses, partes retangulares e cores marcadoras. A métrica do joelho é overlap de bounding boxes; não comprova máscara alfa ou ausência de pele em arte real. Cabelo e acessórios de cabeça não são cobertos. Portanto AF-13 continua parcial; esta evidência não substitui a validação visual do usuário em personagens reais nem encerra R-34.
