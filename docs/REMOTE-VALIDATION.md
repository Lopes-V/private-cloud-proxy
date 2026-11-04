# Aceitação remota — Render

Endpoint: https://private-cloud-proxy-free.onrender.com

Testes em 4/11/2026, com validação TLS habilitada e segredo autorizado recebido por stdin sem eco, mantido apenas na memória dos processos de teste. Nenhum segredo foi incluído neste relatório, no código ou no pacote Windows.

| Verificação real contra Render | Resultado |
|---|---|
| HTTPS com verificação de certificado/hostname | Passou |
| GET /health | 200, corpo `ok` |
| GET /usage sem credencial | 401 |
| Upgrade WSS sem credencial ou com credencial inválida | 401 |
| Upgrade WSS autenticado e conexão TCP pública | 101 e `ready: true` |
| HTTP pelo cliente local → WSS → Render | Passou |
| HTTPS por CONNECT pelo mesmo caminho | Passou |
| IP de saída observado com curl e Chromium | **74.220.48.29** |
| Metadados 169.254.169.254, loopback 127.0.0.1 e porta 22 | Recusados explicitamente pelo servidor |
| Três túneis HTTPS concorrentes | Passaram |
| Túnel sem tráfego | Encerrado em aproximadamente 36 s (o destino também pode fechar antes do timeout de 45 s) |
| Chromium real no Linux: HTTP, HTTPS e consulta de IP pelo Render | Passou |
| Chromium com proxy local encerrado | Navegação falhou, sem acesso direto silencioso |
| Retomada após 17 minutos sem requisições de teste | Passou; saúde pronta em 12.663 ms; processo reiniciado segundo contadores |

## Retomada observada

O experimento começou com zero sessões ativas, 20 sessões acumuladas e 103.827 bytes. Durante os 17 minutos o processo de teste apenas esperou localmente: nenhuma requisição HTTP/WSS, health probe ou keep-alive foi enviada ao serviço. Na retomada, saúde e contadores autenticados ficaram disponíveis em aproximadamente **12,7 segundos**. Antes de abrir qualquer novo túnel, o processo remoto reportou **zero sessões e zero bytes**, confirmando restart desde o baseline. A causa exata do restart não foi consultada nos eventos internos do Render; a observação é compatível com a suspensão Free documentada.

Logo depois, a aceitação autenticada repetiu HTTP, HTTPS/CONNECT, IP de saída e bloqueio de metadados com sucesso. O IP permaneceu **74.220.48.29**. O checker genérico ainda imprime coldStart/billing como não verificados porque não realiza sozinho a janela nem acessa faturamento; a evidência de retomada é do verificador `remote-idle.mjs` e os dados financeiros são a confirmação do proprietário.

## Correção encontrada em produção

A primeira aceitação falhou na etapa de bloqueio de metadados: a recusa dependia apenas do fechamento WebSocket, que não foi percebido pelo cliente antes do timeout no caminho remoto. Destinos públicos retornavam 200 e o servidor não encaminhava bytes para os destinos proibidos. Uma sondagem mostrou a sessão no servidor desaparecer após seu prazo de abertura, enquanto o cliente ainda não recebia o encerramento.

O servidor passou a enviar um veredito de aplicação `{ "ready": false }` antes do fechamento, sem divulgar endereço, credenciais ou conteúdo. Um teste local reproduziu a falta desse veredito, a correção passou nos testes e foi enviada ao Render por auto-deploy. A aceitação autenticada completa depois disso passou, incluindo metadados. Não desativamos TLS ou filtros de destino para obter sucesso.

## Custos e cotas

O proprietário confirmou **Free, sem método de pagamento cadastrado**. O Blueprint validado define somente um serviço Free, sem banco/disco/add-on pago. Não houve criação de recurso pago ou habilitação de faturamento pelo agente. Não há acesso independente à fatura/telemetria financeira do Render; a confirmação da conta é do proprietário.

Um snapshot autenticado depois da aceitação registrou 15.955 bytes e quatro sessões no processo reiniciado. O baseline da janela de inatividade foi de 103.827 bytes, 20 sessões acumuladas e **zero sessões ativas**. Esses contadores são da aplicação e não incluem todo o overhead nem o restante do workspace; não equivalem à medição/fatura do Render. Hobby documenta 5 GB/mês compartilhados e possível suspensão por saída incomum.

## Repetir testes sem expor o segredo

O campo seguro `TUNNEL_TOKEN` e a URL WSS foram declarados no rascunho do ambiente para uso futuro. Nesta execução o valor autorizado foi recebido por stdin com eco desativado; não foi salvo como configuração de ambiente permanente. Nunca coloque o valor em argumentos, Git ou arquivos de texto.

Com um binding seguro já disponível no processo:

```sh
TUNNEL_URL=wss://private-cloud-proxy-free.onrender.com/tunnel node bridge/check-remote.mjs
node bridge/test/remote-browser.mjs
node bridge/test/remote-policy.mjs
node bridge/test/remote-idle.mjs
```

A opção `--secret-stdin` dos verificadores exige um canal de entrada sem eco preparado pelo operador; não a use para digitar em um terminal com eco ativo. O launcher Windows já oculta a entrada automaticamente.

O verificador de inatividade faz uma consulta de baseline, espera 17 minutos sem qualquer chamada ao serviço e só então consulta saúde/contadores e repete a aceitação. O proprietário deve manter clientes fechados durante a janela. Reinício observado é deduzido de contadores não nulos antes e zerados depois; a causa exata do restart depende dos eventos do Render.

## Windows

```sh
python3 scripts/package-free.py --endpoint wss://private-cloud-proxy-free.onrender.com/tunnel
```

O ZIP é entregue com a URL pública pré-configurada. Abra `Start-Private-Proxy.cmd` e informe o segredo com entrada oculta. O launcher ainda não foi executado num Windows real; o teste remoto de navegador foi feito com Chromium Linux. O IPv4 de saída compartilhado pode mudar após reinício do provedor.

## Investigação do CONNECT da Steam — 4/11/2026

O 502 observado no Chromium é gerado pelo cliente antes de estabelecer o túnel; ele não contém o motivo remoto. O servidor anterior encerrava erros TCP sem registrar o código e sem enviar o veredito de aplicação, de modo que DNS, política, TCP, timeout e limites não podem ser distinguidos pelo resultado registrado. Não há evidência suficiente para atribuir a falha a bloqueio da Steam ou da Render, nem para afirmar que a alteração local resolveu o caso remoto.

Neste ambiente Linux, com o relay e cliente locais usando resolução real, política de IP público e TLS verificado, `api.ipify.org`, `www.wikipedia.org` e `store.steampowered.com` retornaram CONNECT 200, HTTP 200 e verificação TLS 0. A resolução local da Steam retornou IPv4 público `23.201.218.102`; DNS e caminhos de rede da Render podem diferir. Esses testes não usam o relay publicado. O ambiente desta investigação não tinha `TUNNEL_TOKEN` nem `RENDER_API_KEY`, e os logs da Render não estavam acessíveis; por isso o 502 remoto não pôde ser reproduzido ou atribuído a uma etapa específica.

O relay agora registra somente etapa e código de erro de uma lista restrita, sem host, IP, URL, conteúdo, cabeçalhos ou credenciais. As etapas de abertura, política, DNS, TCP, timeout e limite permitem distinguir a falha nos logs após disponibilização da versão alterada. Erros TCP durante a abertura também enviam o mesmo veredito negativo explícito usado para recusas de política; isso corrige uma inconsistência comprovada por teste, sem tornar o destino acessível se a conexão falhar. Não foi feito deploy nem teste autenticado remoto desta alteração.

Nova verificação nesta sessão: os três destinos acima retornaram CONNECT 200, HTTP 200 e `ssl_verify_result=0` através do cliente e relay locais, com resolução pública real. O endpoint Render respondeu ao `/health` e rejeitou `/usage` anônimo; o teste autenticado continua indisponível porque `TUNNEL_TOKEN` não está presente. Não há chave de API nem ferramenta Render conectada para consultar os logs. A suíte Node com Node 24.22.1 passou 23/23; a suíte Python passou com 16 dos 24 testes ignorados por dependências ou condições de integração ausentes. Os diagnósticos locais ainda não estão publicados na Render, e não identificam retroativamente a causa do 502 observado.
