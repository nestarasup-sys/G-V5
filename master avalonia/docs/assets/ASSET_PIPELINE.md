# Pipeline e cache de imagens

## Decode

`AssetImageDecoder` executa SkiaSharp fora da UI e devolve um `DecodedAssetImage` descartável. A imagem é convertida para RGBA8888 sRGB, com alpha, e as oito orientações EXIF são aplicadas antes de entregar o bitmap. Por enquanto, WebP animado produz o primeiro frame. A entrada deve ser um stream legível e seekable; `IAssetStore.OpenReadAsync` atende esse contrato. O chamador mantém ownership do stream e precisa descartar o bitmap quando terminar.

Limites iniciais por imagem: 16.384 pixels por eixo, 100 milhões de pixels e 512 MiB para o buffer de saída. Eles são guardrails de segurança, não uma configuração final de memória do produto. Decode inválido retorna `AssetImageDecodeErrorCode`; cancelamento é propagado e o stream continua aberto.

## Cache de bitmaps

`AssetBitmapCache` usa `(SHA-256, decoderVersion)` como chave, para invalidar pixels quando a implementação do decoder mudar. O padrão inicial é 512 MiB. A LRU só descarta entradas sem leases ativos. Se o limite não puder ser atendido sem desalojar uma imagem em uso, a nova imagem é devolvida em lease fora do cache; ela é descartada ao liberar o lease.

Cada `AssetImageLease` controla a vida do bitmap compartilhado. Dispose do cache aposenta imediatamente entradas livres e deixa as em uso vivas até o último lease ser liberado. A snapshot `Metrics` informa hits, misses, evictions, bypasses, bytes residentes, entradas e leases ativos. As métricas são locais ao processo e não carregam dados de usuário.

O orçamento de 512 MiB ainda precisa de benchmark em hardware real e ciclos de abertura/fechamento; o cache não define a fonte de verdade e pode ser reconstruído a qualquer momento.

## Miniaturas em disco

`ThumbnailService` calcula a identidade por SHA-256 do asset, versão do gerador e receita imutável (largura, altura e `Contain`/`Cover`/`Stretch`). Gera PNG RGBA em background e salva em `thumbnails/<prefixo>/<chave>.png`; não altera o asset original nem grava caminhos no banco. Os manifestos vizinhos registram tamanho e SHA-256 dos bytes derivados. Um cache ausente, truncado ou adulterado é removido e reconstruído a partir do asset original.

Publicação usa arquivos temporários na mesma pasta e rename atômico, com o manifesto publicado por último. Uma queda entre os dois renames deixa um par inválido que será detectado na próxima leitura. Requisições concorrentes para a mesma chave compartilham a geração; cada chamada recebe seu próprio stream, que deve ser descartado pelo consumidor. Cancelamento é propagado e remove os temporários criados durante a tentativa.
