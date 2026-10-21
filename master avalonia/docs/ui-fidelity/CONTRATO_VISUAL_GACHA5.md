# Contrato visual — Gacha 5 reconhecível no Avalonia

Referência exclusiva: Gacha 5 Electron neste repositório, não Editor V4.
Decisão vigente: ADR-0006, que substitui as restrições visuais excessivamente rígidas da ADR-0004.

## Objetivo

Ao abrir o G-V5 Avalonia, o usuário deve reconhecer imediatamente o Gacha 5: identidade visual, cores principais, estrutura, ferramentas e navegação familiares. **Não exige réplica pixel a pixel.** O usuário aceita pequenos ajustes de posição, dimensões, margens, estilos e organização; poderá pedir refinamentos depois.

**Nenhum botão, função, submenu, atalho ou comportamento real do legado pode desaparecer sem autorização.** Não vale reproduzir visualmente controles que não funcionem. A implementação deve ser 100% nativa C#/Avalonia e pode melhorar desempenho, virtualização, acessibilidade, DPI, bindings, layout e qualidade de uso.

## O que preservar

- Identidade e paleta reconhecíveis, organização geral das páginas, localização aproximada das ferramentas, terminologia e fluxos conhecidos.
- Todas as ações existentes, estados relevantes, menus, diálogos, seleção, importação, edição, exportação e persistência.
- Controles com implementação funcional, e não placeholders decorativos.

Pequenas diferenças visuais são aceitáveis. Mudanças radicais na navegação, remoção/ocultação de botões ou descaracterização do Gacha 5 exigem aprovação.

## Política de evidência

- Inspeção de código Electron, CSS e inventários orienta a implementação.
- Capturas Electron/Avalonia na mesma resolução, DPI e estado são **recomendadas para revisão visual**, não pré-condição da programação de F07.
- Testes unitários, de integração, headless e gates técnicos comprovam comportamento dentro de seus limites; não declaram captura Windows/GPU realizada.
- Uma tela pode ter **aceite técnico verde e revisão visual pendente**; registrar ambas separadamente na matriz visual e no gate.
- Falta de folha pessoal ou screenshot comparativo não bloqueia, por si só, a próxima fase. Falha crítica de função, dados ou testes obrigatórios continua bloqueante.

## Reavaliação final

Antes de declarar o G-V5 pronto, conferir fluxos no Windows com conteúdo representativo, cobertura de botões/funções e aparência familiar. Registrar divergências importantes; o usuário pode solicitar ajustes estéticos depois.

Preservar os 247 IDs, a ordem de módulos e o legado Electron somente leitura.
