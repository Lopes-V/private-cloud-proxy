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

## Continuação autônoma — 4/11/2026

O SHA `3ad35fac1128ff16a4f3b7247b89f226eaf64067` tem deployment Render com estado `success` registrado no GitHub (deployment 7558781508). Isso corrige a informação anterior de que os diagnósticos ainda não haviam sido publicados. Nesta continuação, `/health` respondeu 200 com TLS válido e `/usage` anônimo respondeu 401.

Defeito reproduzido: o prazo de abertura encerrava o WebSocket sem veredito de aplicação. O novo teste falhou com `Transport closed without verdict` antes da correção. Agora o servidor envia uma recusa classificada, impede conexão após resposta DNS tardia e encerra os recursos com prazo de limpeza de 1 segundo. Não aumentamos o prazo de conexão, sessões ou tráfego. Um segundo teste comprovou que o cliente perdia o diagnóstico remoto; agora ele registra a classificação restrita recebida pelo WSS autenticado.

Os eventos contêm apenas etapa, código permitido, classe, UUID e duração. São distinguíveis DNS_FAILED, DNS_REJECTED, TCP_CONNECT_TIMEOUT, TCP_CONNECTION_REFUSED, NETWORK_UNREACHABLE, SESSION_LIMIT, TRAFFIC_LIMIT, WSS_CONNECTION_FAILED, AUTH_FAILED, REMOTE_SOCKET_CLOSED e INTERNAL_ERROR. Encerramento TCP por erro após conexão é classificado como REMOTE_SOCKET_CLOSED; fechamento normal não é interpretado como falha. Limites de upgrade retornam classe em cabeçalho somente após autenticação. `/health` informa o SHA de `RENDER_GIT_COMMIT`, quando válido, para verificar a revisão servida.

Teste real com Node 24.22.1, relay local WSS com CA de teste confiada explicitamente pelo cliente, DNS público real e Chrome Linux instalado:

| Destino | HTTP | HTTPS / CONNECT / TLS | TCP local | Chromium, documento principal |
|---|---|---|---|---|
| api.ipify.org | 200 | 200 / 200 / válido | IPv4, 18–20 ms | 200 |
| www.wikipedia.org | 301 | 200 / 200 / válido | IPv6 17 ms; IPv4 27 ms | 200 |
| store.steampowered.com | 302 | 200 / 200 / válido | IPv4 22 ms | 200 |

Chromium falhou ao desligar o proxy, sem fallback direto. Recursos secundários foram bloqueados no teste de navegador para limitar tráfego; não é uma validação de toda a interface da Steam. O comparador reproduzível está em `bridge/test/destinations.mjs`; o modo padrão usa relay local e `--remote` exige binding seguro do token. DNS/TCP diretos são sempre identificados como observações da máquina executora, mesmo no modo remoto.

Limite exato: TUNNEL_TOKEN e RENDER_API_KEY estavam ausentes no ambiente autorizado, sem ferramenta Render conectada. Não procuramos segredos em outros processos ou perfis. Portanto, a causa específica do 502 Steam remoto continua indeterminada. A resolução atual escolhe um único IPv4 público preferencial e rejeita toda resposta contendo IP proibido; não houve evidência remota que justificasse atribuir a falha a esse endereço ou alterar o algoritmo. Os testes locais não demonstram bloqueio da Steam/Render nem solução do acesso remoto.

Fontes consultadas: https://nodejs.org/api/net.html e https://render.com/docs/free . As limitações documentadas da Render Free não são prova de uma restrição neste incidente.

Regressão desta continuação: Node 24.22.1, **27/27 testes passaram**, incluindo HTTP, CONNECT, CA válida/inválida, TLS do destino, DNS rebinding, concorrência, limites, timeout DNS tardio e ausência de fallback. Python: 24 testes descobertos, 8 passaram e 16 ignorados por condições/dependências de integração ausentes (incluindo GOST, que não faz parte do relay WSS em análise). Não apresentamos esses 16 como executados.

Implantação confirmada: commit de código `b562d9850681eb9c71982d701b5be65c9a42533e`, publicado na main. O deployment GitHub/Render **7558984616** terminou com `success`. Em 4/11/2026 às 21:59 UTC, o serviço respondeu `/health` 200, corpo `ok`, e `X-Relay-Revision: b562d9850681eb9c71982d701b5be65c9a42533e`, com validação TLS habilitada. Após o deploy, `/usage` anônimo e upgrades WSS sem token/com credencial deliberadamente inválida retornaram 401. Navegação autenticada pela Render permanece não executada nesta continuação; a implantação da correção de diagnóstico não equivale à resolução comprovada do 502 Steam.

## Correções adicionais — 4/11/2026

Foram reproduzidos e corrigidos outros defeitos sem atribuí-los, sem prova, ao incidente Steam remoto:

- CONNECT com dados enviados junto dos cabeçalhos e orçamento insuficiente respondia `200 Connection Established` seguido de `502` dentro do túnel. O teste de regressão observou essa sequência antes da correção. Agora a contabilização precede o 200 e a falha termina o WSS criado.
- O relay conservava somente um endereço DNS. Agora valida a resposta inteira, remove duplicatas e fornece a lista fixada ao algoritmo `autoSelectFamily` do Node. Nenhum lookup externo ocorre durante as tentativas; um membro privado/proibido invalida toda a resposta. O prazo total de abertura permanece 10 s. Testes com sockets reais confirmam sucesso após recusa do primeiro candidato e entre famílias; timeout TCP usa socket controlado e está identificado como simulação.
- Limites locais de sessão e tráfego agora produzem diagnósticos explícitos. Resposta DNS tardia após recusa não interrompe o envio do veredito já em andamento.
- O comparador de destinos agora falha também para status HTTP de erro. A espera do teste de cota tem prazo de encerramento.
- Os testes de navegador aceitam caminhos configuráveis para Playwright/Chromium. O teste completo com CA temporária, HTTP, HTTPS, reinício do cliente e falha sem acesso direto passou no Chrome Linux. A CA temporária foi removida pelo cleanup.
- O ZIP Windows omitia `diagnostics.mjs`, importado pelo cliente. Corrigimos a inclusão e o caminho de saída, geramos o pacote e validamos a importação do cliente após extração fora do repositório. Isso não é execução em Windows real.

Validação: Node 24.22.1 **33/33**; revisão independente sem achados importantes; teste Chromium completo passou. O comparador com DNS/TCP públicos e relay local novamente retornou HTTPS/CONNECT 200 e TLS válido para ipify, Wikipedia e Steam; Chromium retornou 200 nos três documentos. Python: **25 testes**, 9 passaram e 16 integrações legadas ignoradas por condições/dependências ausentes. O teste do pacote extraído passou.

TUNNEL_TOKEN e RENDER_API_KEY continuam ausentes nos bindings autorizados. A seleção de candidatos corrige uma limitação real, mas não comprova que ela causou o 502 Steam da Render. Nenhuma restrição externa foi contornada e nenhuma proteção ou cota foi removida.

Deploy adicional confirmado: **f357a6baeecd679e14e3860b5d3de7c023f588b8**, deployment **7559202523**, estado `success`. Em 4/11/2026 às 22:09 UTC, `/health` retornou 200 com `X-Relay-Revision` igual a esse SHA e TLS verificado. Após o deploy, `/usage` anônimo e WSS sem credencial/com credencial inválida retornaram 401. O pacote atualizado foi gerado em `.local/private-cloud-proxy-free-windows.zip` (artefato local ignorado pelo Git). A validação autenticada Steam/Render continua pendente pelas limitações de acesso registradas acima.

## Auditoria com recursos completos — 05/11/2026

A revisão `669eb59`, aprovada no CI e verificada no header de saúde Render, passou duas vezes pela página inicial Steam com todos os tipos de recurso habilitados: HTTP 200, load em 3,9/3,7 s, 46 scripts, 17 CSS e 60 imagens, sem falhas registradas em cada janela. Três fetch da API permaneceram pendentes em cada teste. Autenticação inválida/ausente, bloqueios de destinos/portas, concorrência e navegação Chromium HTTP/HTTPS com falha sem acesso direto foram repetidos contra o endpoint real. Saída observada: 74.220.48.29. Os resultados anteriores que falharam foram preservados, com explicação dos ajustes e limitações em [STEAM-AUDIT.md](STEAM-AUDIT.md). Não é uma validação de toda a Steam nem de Windows real.
