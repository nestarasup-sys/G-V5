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

## Migração do perfil Electron

`npm run dev` e `npm run preview` executam `scripts/prepare-app-data.cjs` antes do Electron. Se o perfil `%APPDATA%/gacha-nymi-work-app` existir, o script confirma que o app está fechado, verifica a cópia por hashes e arquiva a origem em `app-data/backups`. O perfil portátil fica em `runtime/profile`.

Na inicialização, o Electron separa dados persistentes de sessão para `cache/electron-session`, remove somente caches descartáveis e recusa links simbólicos, colisões ou destinos não canônicos. A rotina não sobrescreve arquivos de perfil existentes. Pastas de domínio antigas eventualmente encontradas são preservadas no perfil portátil para a migração guiada; não são apagadas silenciosamente.

## Backup e testes

Backups manuais incluem `runtime/profile`, `cache/electron-session`, bibliotecas, personagens, projetos, mídia, manifestos e snapshot do catálogo. Caches descartáveis são omitidos. O restore valida hashes e integridade SQLite antes de aplicar.

Os testes de armazenamento, migração, limpeza e restauração usam diretórios sintéticos temporários. Nenhum teste automatizado migra o perfil real. Um backup no mesmo disco não protege contra falha física; mantenha outra cópia em uma unidade separada se precisar desse nível de proteção.
