# Tokens visuais extraídos do legado

**Fonte primária inspecionada:** `src/renderer/src/ui/styles.css`.  
**Limite:** valores abaixo são literais declarados no código CSS, não medições de screenshot. Existem estilos por workspace e regras inline que ainda precisam ser catalogados. Não usar estes tokens globais para apagar variações locais.

## Tokens globais declarados em `:root`

| Token | Valor declarado | Uso declarado |
|---|---|---|
| `font-family` | `'Aptos', 'Segoe UI', sans-serif` | tipografia raiz |
| `color` | `#28232a` | tinta raiz |
| `background` | `#f5f3f4` | fundo raiz |
| `font-size` | `16px` | tamanho raiz |
| `--ink` | `#28232a` | tinta/estado ativo da navegação |
| `--muted` | `#9c949c` | texto secundário |
| `--line` | `#efeaee` | linha neutra |
| `--rose` | `#e76391` | rosa primário |
| `--rose-dark` | `#c74677` | rosa escuro/hover |
| `--rose-pale` | `#fff1f6` | rosa pálido |

## Medidas globais/componente confirmadas no CSS

| Componente | Propriedade declarada | Valor |
|---|---|---|
| Documento raiz | tamanho mínimo | `760px × 560px` |
| Shell | mínimo vertical | `560px` |
| Top bar | altura e min-height | `67px` |
| Top bar | padding horizontal | `25px` |
| Marca | tamanho | `33px × 33px` |
| Marca | radius | `11px` |
| Nome da marca | fonte | `Manrope`, `20px`, peso `800` |
| Subtítulo da marca | fonte | `DM Sans`, `12px`, peso `600`, letter spacing `1.15px` |
| Links de navegação | altura | `36px` |
| Links de navegação | fonte | `12px`, peso `600` |
| Links de navegação | radius | `9px` |
| Sidebar vazia de Roteiros | largura/min-width | `280px` |
| Cards da biblioteca de Roteiros | coluna | `minmax(300px, 360px)` |
| Modal de criação de Roteiros | largura | `min(520px, 100%)` |
| Modal de criação de Roteiros | altura máxima | `min(680px, 92vh)` |

## Famílias tipográficas vistas em regras

`Aptos`, `Segoe UI`, `Manrope` e `DM Sans` são mencionadas nos trechos inspecionados. **Disponibilidade de arquivos locais, fallback efetivamente escolhido e cobertura por página ainda não foram comprovados.** Não baixar ou substituir fontes sem inventariar a distribuição original e verificar licença/asset do repositório.

## Tokens e variações ainda não catalogados

- Paletas completas e estilos locais de cada área/workspace, incluindo cores de cards por categoria e estados.
- Gradientes, opacidades, sombras, bordas, raios e escalas de espaçamento por componente.
- Estados hover/focus/selected/disabled e transições, inventariados de maneira exaustiva.
- Dimensões visuais medidas em captura Electron, escalas DPI e diferenças entre viewports.
- Ícones, dimensões de SVG, imagens decorativas e fontes binárias/font-face.

Não preencher essas lacunas com valores “parecidos”. Acrescentar token apenas com caminho e linha CSS/XAML ou evidência visual real; registrar o escopo/variação intencional.
