# Navegador com abas - desenho

## Objetivo

Evoluir a janela Electron de página única para um navegador desktop funcional,
com controles de navegação, abas, favoritos, histórico e downloads, mantendo
o Chromium como motor e a proteção de conteúdo já existente.

## Arquitetura

A janela principal passa a carregar uma interface local de shell. O processo
principal mantém um `BrowserTabManager`: cada aba é um `BrowserView` com
`webPreferences` isoladas; somente a aba ativa ocupa a área abaixo da barra
de ferramentas. O renderer do shell recebe um snapshot de estado e envia
comandos mínimos por preload/IPC.

`BrowserStore` persiste favoritos e histórico em `userData/browser-data.json`.
Navegações concluídas atualizam título, URL e histórico; downloads são
registrados com nome, caminho e estado através de `will-download`.

## Funcionalidades da primeira versão

- Nova aba, alternância, fechamento, título e indicador da aba ativa.
- Barra de endereço: URL absoluta ou busca DuckDuckGo para texto comum.
- Voltar, avançar, recarregar, parar e página inicial configurada como nova
  aba (`chrome://newtab` local não é exposto; a página inicial é uma página
  local do shell).
- Favoritar/desfavoritar a URL atual e abrir um menu de favoritos.
- Histórico persistente e lista de downloads com status.
- Pop-ups externos são abertos em nova aba controlada. Permissões para mídia,
  localização e notificações são negadas por padrão, exceto futura aprovação
  explícita; a primeira versão não cria uma tela de permissões.
- O menu de configurações de rede permanece disponível e atua na mesma sessão
  Chromium das abas.

## Limites deliberados

- Não há sincronização com conta Google, extensões, modo incógnito, impressão,
  autofill, gerenciador de senhas ou DevTools expostos nesta versão.
- Downloads usam o diretório padrão de downloads do usuário; seleção de pasta
  e pausa/retomada ficam para uma etapa posterior.
- Todas as abas compartilham a `defaultSession`, portanto cookies e a política
  de proxy configurada são consistentes entre elas.

## Segurança

As páginas remotas executam com `nodeIntegration: false`, `contextIsolation:
true`, `sandbox: true` e sem acesso ao IPC. Somente a interface local tem um
preload com métodos enumerados e validação de entrada no processo principal.
URLs `file:`, `javascript:` e esquemas não HTTP(S) são rejeitados pelo
gerenciador de abas.

## Testes

Testes Node cobrem normalização de endereço, ciclo de vida de abas, persistência
de favoritos/histórico e canais IPC. Testes de integração usam doubles da API
Electron, sem depender de acesso externo à internet.
