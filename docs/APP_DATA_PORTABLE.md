# Dados locais portáteis do GACHA V5

## Raiz e ownership

Todo dado persistente do aplicativo fica sob `app-data/`, dentro do checkout. A pasta é ignorada pelo Git e não deve entrar em commits, releases ou CI.

```text
app-data/
  database/catalog.sqlite       # metadados e arquivos lógicos por domínio
  libraries/                    # bibliotecas publicadas pelo Fabricador
  characters/                   # personagens e overrides do Customizador
  projects/                     # documentos dos Studios
  media/objects/sha256/         # arquivos binários deduplicados
  media/thumbnails/             # miniaturas derivadas
  runtime/profile/              # Local State e preferências do Electron
  cache/electron-session/        # localStorage, cookies e estado da sessão Electron
  cache/                        # caches recriáveis
  logs/                         # logs locais
  crash-dumps/                  # relatórios locais de falha
  temp/                         # temporários do processo
  backups/                      # backups manuais e recuperação local
  manifests/                    # recibos e proveniência local
```

`runtime/profile` e `cache/electron-session` são diretórios internos do Electron, mas ficam dentro de `app-data`. O app aponta `userData` e `sessionData` para esses locais antes do evento `ready`. Os caches descartáveis são separados e podem ser recriados. A pasta antiga `app-data/user-data` não é mais um destino de dados.

## Dados de domínio

O catálogo oferece migração guiada por domínio em Opções > Dados e armazenamento. Domínios ativos usam o catálogo e objetos endereçados por conteúdo através de um adaptador de filesystem, preservando os contratos de persistência das áreas. Fabricador publica bibliotecas e vínculos; Customizador guarda personagens e overrides; Studio normal e Video Studio mantêm projetos independentes.

Antes de uma migração de domínio, crie um backup manual em Opções. A migração verifica origem e destino por hash e só remove os arquivos antigos após o primeiro carregamento saudável. Não execute várias instâncias durante a migração.

## Importação e armazenamento de imagens

Os imports rasterizados passam pelo normalizador do processo principal. São aceitos PNG, JPEG e WebP estáticos; animações e arquivos inválidos são rejeitados. A orientação EXIF é aplicada, a cor é normalizada para sRGB, a transparência é mantida e os metadados são removidos. A saída é PNG sem paleta/quantização, limitada a 50 MB de entrada/saída e 32 megapixels. PNG de 16 bits permanece em 16 bits no arquivo canônico. Os editores baseados em canvas avisam e recusam 16 bits quando não conseguem editar sem reduzir a profundidade.

Os bytes canônicos ficam em `media/objects/sha256`, deduplicados pelo SHA-256. Ao salvar JSON de um domínio ativo, Data URLs de imagem são externalizadas para objetos e o documento armazena referências internas com hash; a tabela `domain_image_refs` indexa os caminhos JSON e referências para consulta e recuperação. Leituras ainda hidratam referências como Data URLs para compatibilidade com os componentes atuais. Essa hidratação é uma ponte temporária de API: reduz cópias persistentes, mas não elimina o custo de memória de Data URLs enquanto a imagem está aberta.

A externalização acontece ao salvar cada documento, não como migração em lote na inicialização. Arquivos binários legados permanecem íntegros até uma migração de domínio ou novo salvamento explícito. Objetos sem referências não são apagados automaticamente. A importação pode produzir arquivo maior que a origem, especialmente para JPEG; a economia previsível vem da deduplicação e das miniaturas, não de uma redução garantida do PNG. JPEG/WebP mantêm os pixels decodificados disponíveis, sem recuperar perdas já presentes no original.

Testes de imagem usam fixtures sintéticas e verificam PNG RGBA, PNG 16 bits, JPEG, WebP, orientação, remoção de orientação/metadados, animação, conteúdo corrompido, limites e deduplicação. Eles não substituem inspeção visual de imports reais. A geração/consumo de miniaturas sob demanda e um protocolo de mídia por referência ainda não estão ligados a todos os componentes; até essa etapa, os componentes recebem Data URLs hidratadas.

## Migração do perfil Electron

`npm run dev` e `npm run preview` executam `scripts/prepare-app-data.cjs` antes do Electron. Se o perfil `%APPDATA%/gacha-nymi-work-app` existir, o script confirma que o app está fechado, verifica a cópia por hashes e arquiva a origem em `app-data/backups`. O perfil portátil fica em `runtime/profile`.

Na inicialização, o Electron separa dados persistentes de sessão para `cache/electron-session`, remove somente caches descartáveis e recusa links simbólicos, colisões ou destinos não canônicos. A rotina não sobrescreve arquivos de perfil existentes. Pastas de domínio antigas eventualmente encontradas são preservadas no perfil portátil para a migração guiada; não são apagadas silenciosamente.

## Backup e testes

Backups manuais incluem `runtime/profile`, `cache/electron-session`, bibliotecas, personagens, projetos, mídia, manifestos e snapshot do catálogo. Caches descartáveis são omitidos. O restore valida hashes e integridade SQLite antes de aplicar.

Os testes de armazenamento, migração, limpeza e restauração usam diretórios sintéticos temporários. Nenhum teste automatizado migra o perfil real. Um backup no mesmo disco não protege contra falha física; mantenha outra cópia em uma unidade separada se precisar desse nível de proteção.
