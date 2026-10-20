# Novo Gacha Nymi — C# + Avalonia

Status: proposta de arquitetura, antes da implementação.

## 1. Objetivo e fronteira do novo aplicativo

Construir um aplicativo novo em C# e Avalonia, começando pelo Fabricador e pelo Customizador. Aproveitar o conhecimento do produto e os arquivos úteis do aplicativo antigo, sem transportar sua organização interna automaticamente.

Tudo necessário para desenvolver, compilar, testar, empacotar e executar o novo aplicativo deverá existir dentro de `master avalonia`. O conteúdo externo a essa pasta será tratado como legado e referência durante a transição.

O novo aplicativo não poderá depender de código, scripts, executáveis ou dados localizados fora dessa pasta de forma implícita. Dependências externas necessárias deverão ser declaradas e instaláveis. Arquivos pessoais do usuário continuarão em uma pasta de dados independente do código.

Não existe arquitetura que impeça todos os erros. A meta é limitar o alcance de cada mudança, detectar regressões cedo e permitir recuperar dados e operações que falharam.

## 2. Princípios de construção

- Uma funcionalidade possui responsabilidades e limites explícitos.
- Interface apresenta dados e encaminha ações; regras de personagem e persistência não ficam no código da tela.
- Fabricador e Customizador compartilham o mesmo modelo e motor de personagem.
- Módulos se comunicam por contratos pequenos e tipados, sem acessar tabelas ou controles internos de outros módulos.
- O disco, a importação de arquivos e a decodificação de imagens são tratados como operações que podem falhar.
- Salvar com sucesso significa que a gravação foi confirmada; a interface nunca anuncia sucesso antes disso.
- Trabalho pesado tem cancelamento, limite de concorrência e estado de progresso.
- Recursos gráficos têm orçamento de memória e descarte explícito.
- Uma mudança pode ser desfeita quando sua natureza permitir.
- Dados possuem versão e migrações verificáveis desde a primeira versão pública.
- Novas abstrações entram quando resolvem uma necessidade concreta; evitar um framework interno gigante antes do primeiro fluxo funcionar.

## 3. Organização inicial da solução

Começar como um aplicativo modular em um único processo. Criar processos adicionais apenas para trabalhos que precisem de isolamento ou que as medições justifiquem.

```text
master avalonia/
  GachaNymi.sln
  README.md
  global.json
  Directory.Build.props
  Directory.Packages.props
  src/
    GachaNymi.Desktop/          # Avalonia, navegação, composição e telas
      Features/
        Fabricador/
        Customizador/
      SharedUi/                # controles e estilos realmente compartilhados
    GachaNymi.Core/             # modelos e regras sem dependência de Avalonia
      Characters/
      Assets/
      Projects/
    GachaNymi.Application/      # casos de uso, comandos e contratos de serviços
    GachaNymi.Infrastructure/   # SQLite, arquivos, importação e logs
    GachaNymi.Rendering/        # composição de personagem e recursos gráficos
  tests/
    GachaNymi.Core.Tests/
    GachaNymi.Integration.Tests/
    GachaNymi.Desktop.Tests/
  docs/
    decisions/                 # decisões curtas: motivo, alternativas e limite
    data/                      # esquema, migrações e recuperação
  tools/                       # ferramentas reproduzíveis de desenvolvimento
```

Os nomes representam responsabilidades, não uma obrigação de criar dezenas de projetos vazios. `Application` e `Core` devem permanecer livres de controles, janelas, caminhos absolutos e consultas SQLite. `Desktop` usa casos de uso; não executa SQL diretamente. `Infrastructure` implementa os contratos usados pelos casos de uso. `Rendering` recebe uma descrição da cena e não altera o personagem salvo.

Fixar versões do SDK e dos pacotes compatíveis na criação da solução. Atualizações de dependências serão mudanças deliberadas, acompanhadas de compilação e verificações.

## 4. Modelo de personagem único

Definir uma representação canônica que sirva às ferramentas de criação e de personalização:

- Modelo corporal com peças, hierarquia, articulações e pontos de encaixe.
- Pose com transformações locais relativas à hierarquia.
- Aparência com cabelo, rosto, roupas, acessórios e cores.
- Ordem de camadas explícita, com critérios determinísticos para empates.
- Referências de recursos por identificador estável.
- Unidades, origem, eixos, pivôs e regras de espelhamento documentados.
- Separação entre definição do modelo, personagem salvo e estado temporário da prévia.

O tronco e as articulações reais orientam as transformações conectadas. As roupas são recursos associados ao corpo e não se tornam peças corporais por conveniência da interface. Alterar o zoom da prévia não modifica as dimensões salvas do personagem.

Antes de implementar todos os ajustes, estabelecer exemplos de referência com resultados visuais conhecidos: pose neutra, rotação de braço, espelhamento, roupa vinculada e personagem com proporções alteradas.

## 5. Dados e arquivos do usuário

Usar SQLite para metadados estruturados e relacionamentos. Guardar imagens e outros arquivos grandes no armazenamento de recursos, referenciados pelo banco. Não persistir imagens repetidas como base64 em cada registro de personagem ou pose.

Estrutura conceitual da pasta de dados:

```text
GachaNymiAvalonia/
  database/app.db
  assets/<hash-do-conteudo>.<extensao>
  thumbnails/
  backups/
  logs/
  temp/
```

A localização real será resolvida por um serviço de armazenamento. Não depender da pasta atual do terminal ou do repositório. Um modo portátil poderá ser criado depois, com seleção explícita de diretório.

Entidades iniciais previstas: modelos, peças, articulações, poses, personagens, roupas, conjuntos de rosto, recursos e referências entre eles. Cada domínio deve detalhar seu esquema antes de implementar suas gravações. Evitar tanto uma tabela gigante de JSON quanto fragmentar cada pequeno valor em tabelas desnecessárias. JSON versionado pode servir para configurações flexíveis que não precisem de consultas relacionais.

Regras essenciais:

- IDs estáveis independentes do nome exibido e da posição em listas.
- Chaves estrangeiras, índices, unicidade e restrições de valores quando aplicáveis.
- Datas com convenção única e revisão para detectar gravações desatualizadas.
- Migrações numeradas e backup consistente antes de atualizações de esquema.
- Backup feito com mecanismo consistente para SQLite; não copiar apenas o arquivo principal enquanto há gravações ou arquivos WAL ativos.
- Exportação e importação de projeto com manifesto versionado e verificação de integridade.
- Nenhuma exclusão de arquivo compartilhado enquanto houver referências válidas.

Banco e arquivos não participam da mesma transação automaticamente. A importação deve preparar o recurso em área temporária, validar, publicar o arquivo e confirmar suas referências no banco, com recuperação de operações interrompidas. A limpeza de recursos órfãos será uma operação explícita e recuperável.

## 6. Edição, desfazer e salvamento

Representar ações importantes por comandos: mover peça, alterar pivô, aplicar pose, trocar roupa, duplicar personagem e excluir item. Uma interação contínua de arrastar gera uma única entrada no histórico, não centenas.

O estado de edição deve distinguir alterações temporárias e dados confirmados. Definir estados visíveis como: salvo, alterações pendentes, salvando e falha ao salvar. Ao fechar, aguardar gravações pendentes ou permitir uma decisão informada do usuário.

Agrupar mudanças rápidas e gravar apenas os registros necessários, dentro de transações. Usar uma política de escrita coordenada para evitar duas telas sobrescrevendo a mesma revisão. Não guardar um histórico ilimitado de imagens para implementar desfazer.

Exclusões comuns podem ir para uma lixeira com restauração. Exclusão permanente é uma ação separada. Recursos necessários a uma sessão ou exportação em andamento não podem ser removidos silenciosamente.

## 7. Interface e novas áreas

Usar MVVM com ViewModels pequenos por tela ou painel e bindings compilados onde forem adequados. A composição da aplicação registra os serviços e as áreas disponíveis. Evitar um ViewModel global que conheça todos os detalhes do produto.

Cada nova área declara rota, título, permissões de edição quando necessárias, ViewModel e casos de uso. A navegação precisa liberar inscrições de eventos, cancelar tarefas e descartar recursos ao encerrar a sessão.

Criar desde cedo um conjunto consistente de cores, espaçamentos, tipografia, botões, formulários, estados de carregamento e mensagens de erro. Suportar escala de tela, atalhos com contexto, foco de teclado e textos acessíveis.

Primeiras áreas: Fabricador e Customizador. Poses, Rosto e Roupas podem começar como seções do Fabricador. Studio, Roteiros e Base de Vídeos só entram quando seus contratos estiverem definidos; não criar páginas fictícias para antecipar todo o produto.

## 8. Prévia e desempenho

- Uma superfície de composição de personagem, em vez de reconstruir a tela inteira para cada ajuste.
- Atualização limitada às peças e propriedades alteradas.
- Carregamento assíncrono de recursos, com primeiro resultado útil aparecendo cedo.
- Fila limitada de geração de miniaturas, priorizando os itens visíveis.
- Cache por conteúdo e parâmetros de renderização, com limite de bytes e descarte de recursos nativos.
- Cancelamento e número de geração para impedir uma prévia antiga de substituir uma edição mais recente.
- Listas com virtualização quando a quantidade de itens justificar.
- Transformações rápidas durante o arraste; tarefas caras agrupadas ao confirmar a edição quando isso preservar o resultado esperado.
- Nenhuma gravação, decodificação ou processamento demorado executado diretamente no thread da interface.

Escolher primeiro os recursos de desenho do próprio Avalonia e medir. Uma integração direta adicional com Skia ou outra biblioteca só deve entrar por necessidade demonstrada. GPU e C# não garantem fluidez se a interface continuar fazendo trabalho desnecessário.

Registrar abertura fria e quente, tempo até a primeira prévia, latência de arraste, tempo de salvamento, memória e recursos retidos depois de fechar um projeto. Definir metas com um primeiro cenário medido no computador de uso, em vez de prometer números sem evidência.

## 9. Falhas, logs e suporte

Erros esperados devem ter resultado tipado: arquivo ausente, formato inválido, conflito de revisão, acesso negado e falta de espaço. Exibir uma mensagem útil com a ação que falhou e a possibilidade de tentar novamente quando aplicável.

Logs locais devem incluir operação, duração, módulo e identificador de correlação, com rotação e limite de tamanho. Não registrar imagens, textos privados, segredos ou caminhos pessoais completos por padrão. Um relatório de diagnóstico exportável deve permitir revisão antes de compartilhar.

Falhas inesperadas precisam preservar o último estado confirmado e informar quando uma operação ficou incompleta. Não usar um capturador global de exceções para fingir que uma operação foi concluída.

## 10. Verificações que acompanham a arquitetura

- Regras geométricas: articulações, pivôs, espelhamento, encaixe de roupas e ordem de camadas.
- Persistência: criar, editar, fechar, reabrir, migrar e recuperar uma gravação interrompida.
- Contratos: comandos e arquivos exportados continuam compatíveis.
- Comparação visual com referências aprovadas para o motor de personagem.
- Interface: fluxos essenciais, atalhos, desfazer e fechar com mudanças pendentes.
- Desempenho: o mesmo cenário antes e depois da mudança, com quantidades de peças e personagens documentadas.
- Arquitetura: dependências entre projetos respeitam os limites definidos.

Compilar não comprova correção visual. Uma verificação automática também não substitui executar o aplicativo no Windows e manipular um personagem real. Novos testes devem proteger regras e riscos concretos, sem apenas repetir a implementação.

## 11. Importação do legado e independência

O legado será fonte de referência e importação, nunca biblioteca obrigatória do novo aplicativo. Criar importadores versionados em C# que copiem os dados selecionados e gerem um relatório de itens importados, ignorados e incompatíveis.

Não escrever no banco ou nos arquivos originais do Electron. Conservar IDs de origem em um mapeamento de importação para evitar duplicar itens na repetição do processo. Validar transparência, dimensões, vínculos, camadas e poses, além da contagem de arquivos.

Antes de excluir o legado, provar que uma cópia contendo somente `master avalonia` compila e executa, que os recursos necessários foram importados, que backups e restauração funcionam e que os fluxos usados foram aceitos. A exclusão futura do legado será uma ação explícita do usuário.

## 12. Primeiras entregas, na ordem

1. **Fundação executável:** solução C#, janela Avalonia, navegação entre Fabricador e Customizador, tema e diretório de dados próprios. Critério: abrir e fechar no Windows com logs e configuração persistente.
2. **Personagem mínimo real:** importar um modelo de referência com peças, desenhar camadas, selecionar e transformar uma peça. Critério: geometria e transparência corretas em zoom e espelhamento.
3. **Edição confiável:** articulações, comando de edição, desfazer/refazer e SQLite. Critério: salvar, fechar e reabrir preserva o resultado, inclusive após falha simulada de gravação.
4. **Primeiro Customizador:** criar personagem a partir do modelo, aplicar uma roupa e uma aparência facial usando o mesmo motor. Critério: Fabricador e Customizador concordam sobre encaixe e proporções.
5. **Bibliotecas úteis:** miniaturas leves, busca, filtros, duplicação, lixeira e importação com progresso e cancelamento.
6. **Expansão controlada:** completar poses, rosto, cabelo, roupas e proporções, uma seção validada por vez.

## 13. Ideias adicionais para evoluir sem perder controle

- Recuperar rascunhos após encerramento inesperado.
- Prévia de importação antes de confirmar alterações na biblioteca.
- Mostrar quais personagens utilizam uma roupa, pose ou recurso antes de excluir.
- Presets de interface e atalhos configuráveis, separados dos dados de personagens.
- Comparação visual antes/depois de um ajuste.
- Exportação de pacote de personagem com todos os recursos necessários.
- Ferramenta local para verificar integridade e relatar recursos ausentes.
- Histórico de revisões do personagem com retenção limitada e restauração.
- Recursos experimentais liberados por opção, com formato de dados protegido por versão.
- Modo de diagnóstico que mede desempenho por operação, ativado explicitamente.

## 14. O que não construir antecipadamente

Evitar microserviços, servidor obrigatório, sistema de plugins de terceiros, barramento global de eventos para qualquer alteração e dezenas de camadas genéricas. Começar com módulos claros dentro de uma solução e expandir a estrutura quando houver uma necessidade demonstrada.

Antes do código inicial, confirmar as decisões de versão do .NET/Avalonia, localização dos dados, convenção geométrica, representação de personagem e primeiro modelo de referência. As decisões técnicas devem ficar documentadas perto do código e ser revisáveis.
