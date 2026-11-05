# Conectividade avancada - desenho

## Objetivo

Integrar ao navegador Electron um gerenciador de conectividade que configure a
sessao Chromium, exponha configuracao de proxy, diagnostico por etapa e
historico local de eventos sem substituir a pilha de rede do Chromium.

## Decisoes

- O trafego de navegacao usa exclusivamente `session.setProxy()` na sessao
  padrao do Electron e `session.closeAllConnections()` apos cada mudanca.
- Os modos suportados sao `direct`, proxy HTTP/HTTPS e SOCKS5. Um tunel
  autorizado e representado por um endpoint HTTP/HTTPS/SOCKS5 ja existente;
  o aplicativo nao cria tunel SSH/VPN nem contorna controles de rede.
- Credenciais de proxy sao guardadas cifradas por `safeStorage` quando esse
  servico estiver disponivel. A configuracao persistida nunca contem a senha
  em texto claro. A credencial e fornecida ao Chromium no evento `login`.
- Uma janela `network-settings` local e isolada do Node. Um preload com API
  minima valida mensagens IPC e nao expoe objetos Electron ao renderer.
- Diagnosticos no processo principal separam DNS, TCP, TLS/certificado,
  HTTP/1.1 e HTTP/2. HTTP/3/QUIC e observado pelo resultado de uma requisicao
  Chromium, pois Electron nao expoe uma API de diagnostico de handshake QUIC.
- Eventos `webRequest` e falhas de diagnostico ficam em memoria com limite e
  sao retornados pela API de configuracoes.

## Contratos

`NetworkManager.apply(config)` recebe modo, endpoint, timeout, tentativas e
credenciais opcionais; atualiza a sessao Chromium e devolve estado sem segredo.
`NetworkManager.diagnose(target)` devolve uma lista de etapas com codigo,
duracao e detalhe seguro. Os codigos incluem `DNS_FAILURE`, `TCP_TIMEOUT`,
`CONNECTION_REFUSED`, `CONNECTION_RESET`, `TLS_HANDSHAKE_FAILED`,
`CERTIFICATE_ERROR`, `PROXY_CONNECTION_FAILED`, `PROXY_AUTH_REQUIRED` e
`HTTP_ERROR`.

## Dependencias e limites

O teste de um proxy ou tunel so e operacional quando o usuario fornece um
endpoint autorizado e alcancavel. HTTP/3 depende de servidor, rede e suporte
QUIC do Chromium; o resultado nao sera inferido de uma conexao TCP.
