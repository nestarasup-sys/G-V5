# Video Studio V5 — rodada local de hardware

**HEAD avaliado:** `845761cbedf6b660c3da7c1292b9621a2e0e6a90`  
**Branch de referência:** `master-desenvolvimento`  
**Plataforma:** Windows 11 Pro, build `26300`  
**FFmpeg:** `n8.1.3-18-g46d899d7a0`, pacote BtbN LGPL-2.1-or-later, SHA-256 `26634a5e06429c4f51ed08ba518923f928c5e4a49ed0ee62f701e035227b91a7`

Este é um registro das medições efetivamente executadas nesta máquina. Os resultados sintéticos não substituem exportação de projetos reais nem validam todos os critérios de release. O JSON detalhado do gate permaneceu em `%TEMP%` e contém caminhos locais; este documento registra somente dados sanitizados.

## Máquina

| Item | Resultado |
|---|---|
| CPU | AMD Ryzen 5 4600G with Radeon Graphics |
| Processadores lógicos | 12 |
| RAM física | 16.526.802.944 bytes (aprox. 15,4 GiB) |
| GPU | AMD Radeon RX 7600, 4 GiB reportados |
| Driver | `32.0.31041.1004` |
| Encoder efetivamente usado | `h264_mf` — passou os benchmarks e os soaks com MP4 decodificado |

O FFmpeg também lista `h264_nvenc`, `h264_qsv` e `h264_amf`, mas esta rodada não fez encode real com esses três encoders; não há evidência para escolhê-los ou rejeitá-los.

## Gates executados

| Etapa | Resultado | Tempo |
|---|---:|---:|
| `npm run typecheck` | passou | 15,2 s |
| `npm run build` | passou | 10,8 s |
| Oráculo de personagem/mídia no Electron | passou; variantes `animated` e `static-characters` | 11,3 s |
| `npm test` | passou, 140/140 | 7,7 s |
| Benchmark serial/Turbo misto, 5 s | passou; H.264, 300 frames, SHA do MP4 igual nos dois modos | 37,7 s |
| Cache frio/quente | passou | 11,0 s |
| Full-engine soak, 90 s | passou; 5.400 frames, decode integral | 57,4 s |
| Full-engine soak, 15 min | passou; 54.000 frames, decode integral | 450,8 s |

O FFmpeg LGPL foi preparado a partir da versão pinada do manifesto. O gate reportou os quatro encoders acima como disponíveis no build; isso é apenas descoberta de capabilities, não teste individual.

## Serial versus Turbo — cenário misto sintético de 5 s

| Modo | Tempo do export | Throughput | Pico de working set medido pelo benchmark |
|---|---:|---:|---:|
| Serial, 1 worker | 22,04 s | 13,61 fps | 1,11 GiB |
| Turbo, 2 workers | 14,21 s | 21,11 fps | 1,52 GiB |

O Turbo levou 1,55× menos tempo nesta única execução (ganho observado de aproximadamente 35,5%). Os MP4s finais tiveram SHA-256 igual e passaram validação H.264 1920×1080/60 e decode integral. É uma amostra única de cinco segundos; não é calibragem geral, não prova ganho em outros perfis e a RAM informada cobre a árvore de processos Electron, **não** soma de forma confiável os subprocessos FFmpeg.

O componente de readback representou 29,1% de `composeMs + readbackMs` no serial deste cenário. Isso não identifica readback como gargalo dominante, então não há justificativa nesta medição para iniciar sharedTexture.

## Cache frio/quente

| Estado | Tempo | Frames renderizados na surface |
|---|---:|---:|
| Frio | 5,46 s | 20 |
| Quente | 3,81 s | 0 |

Speedup observado: 1,44×. A amostra usou 20 estados e cache de aproximadamente 3,0 MiB; é um microbenchmark do caminho de cache, não um export complexo representativo.

## Soaks de duração

| Duração lógica | Frames no MP4 | Chunks | Tempo de execução | Throughput | RSS pico da aplicação |
|---|---:|---:|---:|---:|---:|
| 90 s | 5.400 | 9 | 57,4 s | 94,15 fps | 189 MiB |
| 15 min | 54.000 | 90 | 450,8 s | 119,78 fps | 191 MiB |

Os dois arquivos foram H.264, 1920×1080, 60/1, com contagem exata de frames e decode integral. **Limite da fixture:** após renderizar 301 frames, o harness reutiliza uma imagem estática; os demais 5.099/53.699 frames não exercitam nova composição. O soak valida duração do container, escrita em chunks, concatenação e decodificação longa, mas não estabilidade de 15 minutos de animação/composição contínua. A métrica RSS é do Electron e não inclui FFmpeg.

## PixiJS, WebCodecs e GPU

Os scripts de experimento retornaram `supported: false`: o Electron não expôs aceleração WebGL/media elegível e reportou dispositivos inativos, incluindo RX 7600 e Microsoft Basic Render Driver. Logo, os experimentos não produziram A/B de desempenho nem paridade e são **inconclusivos para a capacidade física da GPU**. Não concluir que RX 7600 não suporte essas tecnologias. Repetir em sessão Electron com aceleração real habilitada antes de decidir sobre Pixi ou WebCodecs.

## Ainda sem evidência nesta rodada

- Encode real isolado de `h264_amf`, `h264_nvenc` e `h264_qsv`.
- Perfis `static-heavy`, `transition-heavy`, `imported-video-heavy` e `text-heavy`, com repetições para mediana.
- Comparação workers × threads do encoder e coleta total confiável de RAM incluindo FFmpeg.
- Soak de 15 minutos com conteúdo animado e mídia em movimento.
- A/B de layer cache ligado/desligado na mesma fixture.
- Recovery torture (cancel, crash de FFmpeg/surface, resume, permissões e espaço em disco).
- Package Windows portable iniciado e exportado sem depender do FFmpeg no `PATH`.
- Teste de export com áudio e prova em UI do pacote portable.

**Conclusão desta rodada:** o caminho sintético `h264_mf`, o build/testes atuais, o Turbo em cenário misto curto, o cache frio/quente e a validação de MP4 longo passaram. O fechamento no hardware real continua pendente dos itens acima e de um A/B GPU válido.
