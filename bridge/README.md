# Ponte gratuita: implementação e limites

## Arquitetura

O cliente Node mantém HTTP/CONNECT apenas em `127.0.0.1`, usa a porta local fixa 17831 e abre um perfil isolado do Chromium com proxy explícito, sem fallback DIRECT. Cada conexão TCP do navegador usa um WebSocket autenticado em `/tunnel`. O primeiro quadro contém somente host/porta; o servidor valida, resolve uma única vez e fornece **todos os IPs numéricos validados** a um lookup fixo de `net.createConnection`, que seleciona endereços com `autoSelectFamily` dentro do prazo de abertura existente. Não há nova resolução entre autorização e conexão. Um servidor DNS UDP de teste comprova rejeição quando uma resposta pública muda para loopback. Respostas mistas e IPv6 de transição também são rejeitadas.

O GOST continua preservado como alternativa para VM; não está oculto no caminho WSS e não foi reimplementado. A nova ponte é necessária porque o frontend do Render não foi escolhido para receber CONNECT diretamente: ele recebe exclusivamente WebSocket HTTPS documentado.

O servidor aceita somente as portas 80/443 e IPs públicos unicast, bloqueando loopback, redes privadas, link-local e metadados. As fixtures positivas usam explicitamente destinos loopback e portas aleatórias no laboratório; essa exceção existe somente por injeção direta de dependência nos testes e não por variável do servidor publicado. A configuração de produção não permite essa exceção.

Render oferece certificado para o hostname `onrender.com`. O cliente valida cadeia e hostname e rejeita redirects WSS. O TLS do site HTTPS é transportado opacamente por CONNECT; nem a ponte nem o servidor terminam esse TLS. HTTP comum continua sendo HTTP entre servidor e site, como qualquer proxy de navegação HTTP.

## Acesso, logs e execução no Windows

`TUNNEL_TOKEN` precisa de pelo menos 32 caracteres. O Blueprint gera 256 bits aleatórios. Autenticação é enviada em cabeçalho dentro de WSS, nunca na URL. Upgrade sem segredo ou com segredo incorreto é rejeitado antes de conectar destinos. Cookies, URLs dos sites, credenciais e conteúdo não são registrados pelo aplicativo. `/usage` exige o mesmo Bearer e retorna apenas contadores agregados; `/health` não revela dados de navegação.

No Windows x64, o `.cmd` baixa Node 24.22.1 portátil via HTTPS, exige o checksum oficial fixo e executa o cliente sem instalar no sistema. Só bibliotecas JS puras são incluídas no pacote. Não usa `ExecutionPolicy Bypass` nem altera controles corporativos. Se a organização bloquear os comandos, ele falha em vez de contornar o bloqueio.

O segredo pode ser digitado com eco desativado e mantido somente na memória, injetado como `TUNNEL_TOKEN` ou carregado do `.env` na pasta do projeto. O `.env` é ignorado pelo Git; não o inclua em commits nem coloque segredos em argumentos ou scripts. Variáveis já definidas no processo têm prioridade sobre o arquivo. O servidor local também carrega esse arquivo; no Render, configure `TUNNEL_TOKEN` em Environment. O processo Chromium não recebe essa variável. URL e consumo são salvos em `%LOCALAPPDATA%\PrivateCloudProxy`, sem segredo. Um lock evita duas instâncias compartilhando a mesma contagem. A porta 17831 permanece igual entre execuções, pois um perfil Chromium já aberto conserva a configuração de proxy; se a porta estiver ocupada, o cliente falha em vez de escolher outro destino ou acesso direto. Fechar a janela do cliente encerra o proxy; não há serviço privilegiado.

HTTP(S)_PROXY e NO_PROXY configurados para o processo são respeitados pelo agente HTTPS nativo do Node. O aplicativo não remove controles nem faz conexão alternativa para contornar uma recusa. A política do navegador desabilita bypass implícito de loopback, QUIC e UDP WebRTC não proxied; isso é configuração deste perfil, não uma VPN nem firewall de todo o Windows. A ausência de fallback foi comprovada para navegação HTTP/HTTPS no Chromium Linux; Windows ainda precisa de aceitação real.

## Consumo e suspensão

Os limites constam no README principal. O orçamento do cliente é gravado antes de transmitir dados; arquivo corrompido bloqueia uso, sem reset silencioso. O mês UTC é estabelecido ao iniciar o cliente; reinicie no mês seguinte para carregar nova franquia. Não apague o arquivo para contornar o limite. A reserva por tentativa inclui handshakes malsucedidos; margem por bloco e limite baixo deixam folga em relação aos 5 GB compartilhados do workspace.

O limite por processo no servidor é volátil e não prova cota mensal: Render reinicia/descarta filesystem. Sem banco ou serviço externo, não há contador central durável entre cold starts. O limite local não mede outros aplicativos ou outros clientes da conta. A garantia financeira depende também de manter conta/workspace somente Free sem cobrança automática e de respeitar as cotas do provedor.

Não há timer de keep-alive/ping nem requisições a terceiros para impedir suspensão. Retentativas ocorrem somente para abrir um túnel pedido pelo navegador, com backoff limitado, por até 90 s. Falhas de certificado/autenticação não são ignoradas. Uma conexão já estabelecida nunca é reproduzida automaticamente, evitando repetir transações HTTP; uma falha fecha o túnel e a próxima requisição pode reconectar.

O Render documenta suspensão por tráfego de saída incomum, sem publicar um valor que garanta permanência. Não consideramos o plano um proxy de alto volume. A AUP proíbe abuso de recursos e uso para burlar controles de rede; a aplicação é exclusivamente privada, para destinos públicos e uso autorizado, sem revenda ou evasão. A consulta à documentação não constitui aprovação individual do provedor.

## Deploy e autorização

O Blueprint foi validado contra o JSON Schema oficial. Render cria só um Web Service Free, Node, URL `onrender.com` e segredo gerado. GitHub → Render faz build via `npm ci --omit=dev --ignore-scripts && npm test`; o Blueprint pede auto-deploy somente após os checks de CI. Confira as configurações efetivas no [guia do painel](../docs/RENDER-SETTINGS.md). Não há Docker privilegiado, DB, disco persistente, domínio pago ou dependência de Oracle/DigitalOcean.

O endpoint `https://private-cloud-proxy-free.onrender.com` passou pela aceitação autenticada com curl e Chromium Linux; resultados e limites estão em `docs/REMOTE-VALIDATION.md`. O ambiente tem acesso ao repositório privado `Lopes-V/proxy`, mas não tem API key Render nem binding permanente para o segredo do túnel. Os testes atuais usaram o valor autorizado somente em memória por stdin sem eco. Para verificações remotas, prefira o campo seguro `TUNNEL_TOKEN` das configurações do ambiente do Codex. Para uso local persistente, use somente o arquivo `.env` ignorado pelo Git; não grave o valor em argumentos, código ou arquivos versionados. Não adicione cartão e pare se houver verificação/plano pago obrigatório.

A URL só é conhecida depois de criar o serviço; não inventamos hostname. O Build log e os eventos do Render são a fonte para o deploy. As restrições de outbound, IP de saída e cold start só podem ser confirmados contra o serviço real.

## Cloudflare Workers como alternativa

Workers suporta WebSocket e TCP de saída, com franquia Free de 100.000 requisições/dia e limite de CPU por requisição. Porém a API TCP bloqueia destinos em ranges Cloudflare e outros endereços proibidos. Substituir CONNECT por `fetch` para esses destinos terminaria o TLS e não preservaria o túnel ponta a ponta. Por isso não implementamos uma falsa alternativa para toda a navegação nem tentamos contornar esses bloqueios. Nenhuma identidade Cloudflare está conectada. Falta de vínculo Render não é evidência de que a plataforma seja incompatível.

## Verificação local e remota

`npm test`: política IP, DNS público→privado com servidor UDP real, HTTP GET/POST, TLS do WSS e destino, CONNECT bidirecional, autenticação ausente/inválida, concorrência, conexão máxima, timeout, reconexão sob demanda, falha sem acesso direto, cap de bytes/sessões, ledger persistente e proxy de rede configurado. As integrações usam sockets reais locais; as fixtures positivas liberam os destinos locais explicitamente. Nenhum resultado local prova Render.

`npm run test:browser`: requer Chromium, OpenSSL, NSS certutil e Playwright no caminho `/opt/codex/cua_node/lib/node_modules/playwright-core` (ou `PLAYWRIGHT_MODULE`); `CHROMIUM_BIN` permite selecionar o executável instalado. Navega HTTP com redirect e HTTPS pelo cliente e desliga o relay para comprovar falha sem acesso direto. Adiciona uma CA temporária ao NSS e a remove em finally. Execute sem outros testes simultâneos alterando esse banco.

Os testes Python e os testes Terraform anteriores são preservados separadamente. Não é necessário usar os artefatos de VPS paga para a versão Free.

Depois de obter o endpoint, `TUNNEL_URL=wss://NOME.onrender.com/tunnel node bridge/check-remote.mjs` verifica TLS, health e rejeição anônima sem precisar do segredo. Se `TUNNEL_TOKEN` for injetado com segurança no processo, o mesmo script também testa HTTP/HTTPS, bloqueio de metadados e mostra o IP de saída observado e contadores. Ele não verifica a fatura nem mantém o serviço ativo. A variável nunca deve ser enviada no chat. Windows pode usar o launcher e o navegador em vez de comandos de terminal.

Após obter URL/segredo reais:

1. Execute o launcher, navegue HTTP e HTTPS e consulte um serviço de IP público; compare com saída observada do servidor, não com IP local do cliente.
2. Valide credenciais inválidas e certificados; tente loopback/metadados e portas proibidas, sem atingir recursos de terceiros.
3. Consulte `/usage` com Bearer por cliente autorizado e o painel Render para bytes/requests reais (são contadores diferentes).
4. Feche todas as conexões e espere a suspensão natural, sem pings; abra novamente e verifique retomada.
5. Confirme Free/US$ 0 no painel e que não há meio de pagamento para overages, outros serviços ou uso compartilhado que possam gerar cobrança. Sem isso não declare custo comprovado.

## Fontes oficiais consultadas em 4/11/2026

- https://render.com/docs/free
- https://render.com/docs/websocket
- https://render.com/docs/outbound-bandwidth
- https://render.com/acceptable-use
- https://render.com/docs/blueprint-spec
- https://render.com/schema/render.yaml.json
- https://render.com/docs/api
- https://developers.cloudflare.com/workers/runtime-apis/websockets/
- https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- https://developers.cloudflare.com/workers/platform/limits/
- https://nodejs.org/dist/v24.22.1/SHASUMS256.txt
- https://nodejs.org/dist/v24.22.1/docs/api/http.json

## Revisão de sessões, CI e IANA

O cliente mantém no máximo 16 túneis ativos e até 32 pedidos em fila FIFO por no máximo 60 s. Cancelamento do navegador remove pedidos em espera. Somente saturação transitória `SESSION_LIMIT` pode ser tentada novamente dentro do prazo; cotas diárias `SESSION_QUOTA`, orçamento e autenticação falham sem retry. Os limites do servidor e os orçamentos permanecem finitos.

`GET /diagnostics` exige Bearer e retorna apenas os últimos 64 eventos sanitizados em memória; não inclui destinos, cookies, conteúdo ou mensagens externas de erro. Os IDs são compartilhados com os vereditos/headers e permitem correlação com o cliente. A lista desaparece no restart.

A política inclui um snapshot dos registros IANA IPv4/IPv6 de finalidade especial (`bridge/data/iana-special.json`). Por decisão conservadora, toda alocação especial é recusada, inclusive exceções globalmente alcançáveis; isso pode rejeitar endpoints especiais legítimos, mas não é necessário para navegação web comum. A lista e seus endereços de fronteira têm teste de regressão.

O comando de build Render executa `npm test` e impede iniciar uma versão reprovada. A configuração GitHub Actions preparada usa somente runner Ubuntu padrão e valida Node, Python/GOST e Chromium com todos os recursos de uma fixture local habilitados, sem tráfego de teste à Render. Proteção de branch e permissões da instalação GitHub precisam ser verificadas separadamente; a credencial atual retornou 403 nessas APIs. Nenhum plano pago ou mudança de visibilidade é autorizado.

A sessão individual foi ajustada para 16 MiB após um evento `TRAFFIC_LIMIT` observado com imagens da Steam em HTTP/2; o teto de 64 MiB por processo e o cliente de 128 MiB/mês não mudaram. Isso redistribui o orçamento e não libera transferências ilimitadas.

Para repetir a aceitação da página inicial com todos os recursos habilitados, use `node bridge/test/steam-page.mjs` com `TUNNEL_TOKEN` injetado por configuração segura (e opcionalmente `--output=/caminho/resultado.json`). Ela limita cada teste a 24 MiB e recusa começar com menos de 28 MiB restantes no processo remoto. Não é executada automaticamente no CI. Os resultados e as chamadas pendentes estão na [auditoria Steam](../docs/STEAM-AUDIT.md). `remote-cleanup.mjs` observa a limpeza após 50 s sem consultas intermediárias, com os outros clientes fechados.

A revisão de desempenho posterior alinha o teto do processo a 128 MiB, mantendo o cliente em 128 MiB/mês. A verificação de prontidão e o cancelamento explícito estão documentados em [PERFORMANCE.md](../docs/PERFORMANCE.md). Registros de testes anteriores com teto de 64 MiB são históricos.
