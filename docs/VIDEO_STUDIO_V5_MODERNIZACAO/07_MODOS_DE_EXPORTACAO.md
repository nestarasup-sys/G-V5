# ESPECIFICAÇÃO DE PRODUTO — Modos de Exportação e Semântica de Animações
Atualização: 2026-10-19 · **Contrato proposto e obrigatório para implementação**, não declarar funcional antes de testes de ponta a ponta.

## 1. Objetivo e nomes
O usuário solicitou **dois modos simples e otimizados**, com nomes apenas exemplificativos:
- **Turbo — Completo** (equivalente conceitual ao “Turbo 2x”): vídeo com animações do Video Studio.
- **Turbo — Sem animações** (equivalente conceitual ao “Turbo 2x sem animações”): sem animações automáticas/interpoladas **de personagens**, mantendo edição autoral e mídias.
Nomes visíveis são decisão de UX, podem mudar. **Turbo** não é promessa de 2× de velocidade nem obrigação de dois workers; ambos os modos podem usar 1/2/N workers e GPU quando benchmarks e qualidade permitirem.

## 2. Diferença entre os modos (primeira versão)

| Recurso da timeline | Completo | Sem animações | Motivo |
|---|---|---|---|
| Pose/expression/face **autoral por keyframe/segmento** | Mantém | **Mantém** estado authored do segmento, com corte instantâneo no boundary | Nunca apagar o roteiro nem fundir reações |
| Interpolação suave entre poses/expressões (250ms/15 ticks padrão) | Mantém | **Desliga** | Diferencial central do modo |
| Piscada automática gerada pelo Video Studio | Mantém quando elegível | **Desliga** | Sem microanimações de personagem |
| Movimento de boca automático enquanto fala | Mantém quando elegível | **Desliga** | Face authored parada dentro do segmento |
| Expressão facial/pose explicitamente selecionada no segmento | Mantém | **Mantém** | Não apagar reação de roteiro |
| Transformações estáticas de personagem (flip, escala, posição, rotação) | Mantém | **Mantém** | Não altera geometria |
| Texto, narrador, balões e timing/speaker | Mantém | **Mantém** | Não remover narrativa |
| Backgrounds, imagens, objetos, z-order | Mantém | **Mantém** | Não alterar composição |
| Vídeos importados (movimento nativo da mídia) | Mantém | **Mantém** | “Sem animações” **não** significa pausar vídeo original |
| Áudio de mídia e mixagem | Mantém | **Mantém** | Mesmo áudio e temporização |
| Mudanças de elementos explicitamente animadas no futuro | Conforme recurso e especificação de cada track | Política explícita por categoria, nunca desligar por engano | Extensibilidade |

**Importante:** o modo "Sem animações" **não** é congelar o vídeo inteiro, não é renderizar apenas um único frame, não elimina troca de pose/expressão registrada nas keys, não remove efeitos estáticos faciais. Também não modifica `animateCharacterTransitions`, `characterKeys`, `StudioDocument` nem arquivos de projeto; é um **perfil imutável de export** interpretado no compilador.

Se no futuro o usuário desejar literalmente nenhuma mudança de pose/expressão, adicionar **terceira opção** explícita ("Congelar personagens") mediante requisito e teste próprio. Não confundir com a opção atual.

## 3. RenderVariant no núcleo

Representação interna ilustrativa:

```ts
type RenderVariant = 'animated' | 'static-characters'
type ExportPreset = {
  version: 1
  renderVariant: RenderVariant
  output: { width: 1920; height: 1080; fps: 60; video: 'h264'; audio: 'aac' | 'none' }
  optimization: 'auto' | 'compatibility' // escolha avançada/diagnóstico, não tela principal
}
function effectiveFeatures(
  authored: StudioDocument,
  variant: RenderVariant
): { transitions: boolean; autoBlink: boolean; autoMouth: boolean } {
  return variant === 'animated'
    ? {
        transitions: authored.videoTimeline?.animateCharacterTransitions !== false,
        autoBlink: true,
        autoMouth: authored.videoTimeline?.animateCharacterTransitions !== false
      }
    : { transitions: false, autoBlink: false, autoMouth: false }
}
```

Tratar `autoBlink` real conforme as regras atuais e transparência de estado, não assumir que efeito independe de playing. Se a aplicação evoluir em políticas de animação independentes, versionar essa função/semântica. O preset faz parte do **digest de job e de cache**; variantes distintas não podem compartilhar frames errados.

## 4. Comparação justa dos modos
- Criar fixture com 2 atores, keyframe de pose, 15 frames de interpolação, 2 falas, blink, vídeo original com contador 24/30/60/VFR, balões e áudio.
- Amostrar imediatamente antes/na/depois de key boundaries, no meio da transição, nos frames de blink e dentro de fala.
- Em `animated`, confirmar interpolação/boca/blink corretos, transições completas e seek A-B-A.
- Em `static-characters`, confirmar cortes corretos nas keys, zero frames intermediários de transição **sem perder nenhuma pose/expression final**, boca estática e sem piscada automática. Clipes de vídeo e áudio são bit/timing equivalentes entre variantes, sujeitando o vídeo codificado a perdas de codec previstas.
- Garantir texto/background/objetos/transformações idênticos entre variantes em todos os frames.
- Validar FFprobe + decode completo, PTS monotônico, contagem N frames, áudio sync, clipes VFR, cancel e recomeço.
- Medir cold/warm separadamente: o modo sem animações pode usar muito mais cache e ser mais rápido, **mas nunca anunciar multiplicador fixo sem prova**.

## 5. UX, validação e fallback
- Uma caixa de diálogo clara: selecionar **Completo** ou **Sem animações**, resolução/qualidade se oferecidas, botão exportar. Mostrar status, ETA somente com medição confiável, progresso, cancelamento e pasta final.
- Fallback interno automático: Turbo multiworker → single worker → encoder CPU sondado quando necessário; preserva o mesmo RenderVariant e visual pretendido. Nunca desabilitar animação para acelerar silenciosamente o modo Completo.
- Não oferecer opção experimental como pronta. O export não é concluído quando FFmpeg fecha: checar output de ponta a ponta antes de publicá-lo.
- Dois caminhos podem compartilhar decoder, compositor, áudio, cache, buffer pool e encoder; **não criar duas engines divergentes**. A diferença é uma flag semântica *no compilador*.
- Para projetos com `animateCharacterTransitions=false`, o modo Completo respeita a configuração autoral; o modo Sem animações aplica restrição adicional apenas no output.

## 6. Compatibilidade e migração
- ExportPreset não é mutação de `VideoTimelineDocument`.
- Arquivos antigos são interpretados pela mesma função de estado authored; ausência de campos opcionais mantém defaults canônicos testados.
- Evitar usar string de UI como identity/hash; armazenar enum `renderVariant` e versão.
- Em caso de feature nova (câmera, zoom, partículas, legenda dinâmica), declarar para cada componente se pertence à variante ou é invariável, com teste e default que preserve a edição.

## 7. Aceite obrigatório
Nenhum dos modos pode ser declarado pronto sem: MP4 válido no Windows alvo/instalador, preview/export canônico, 60fps real, áudio, estabilidade de memória, cancel/recovery, projetos antigos, fixtures 5/30/90s e projeto longo conforme laboratório, testes de diferença semântica completos. Compatibilidade antiga preservada em backups sintéticos.

**Ligações:** [00_PLANO_DIRETOR.md](./00_PLANO_DIRETOR.md), [02_ARQUITETURA_CANONICA.md](./02_ARQUITETURA_CANONICA.md), [04_LAB_E_GATES.md](./04_LAB_E_GATES.md), [06_BACKLOG_DE_EXECUCAO.md](./06_BACKLOG_DE_EXECUCAO.md).
