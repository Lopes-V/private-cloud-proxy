# Revisão da auditoria — 05/11/2026

## Escopo e medição

O incidente original de 502 motivou a investigação. Nesta sessão o documento principal da Steam já retornava 200 na versão anterior; o problema reproduzido foi o carregamento incompleto dos recursos secundários. Não atribuímos retroativamente todo 502 a uma única causa.

Todos os testes remotos aqui usam `https://private-cloud-proxy-free.onrender.com`, WSS autenticado, Chromium real Linux e validação TLS ativa. Nenhum tipo de recurso foi bloqueado, nenhuma chamada foi interceptada para produzir sucesso e não houve fallback direto. O segredo autorizado entrou por stdin sem eco e não foi salvo. O teste tem orçamento independente de 24 MiB por execução e não equivale à medição de banda do workspace Render.

## Evidência anterior à última revisão

| Revisão servida / teste | HTTP principal | Recursos / resultado |
|---|---|---|
| `f357a6b`, cliente original | 200 | 130 pedidos, 58 falhas; rejeições locais/remotas `SESSION_LIMIT` |
| `fa33067`, fila de 60 s, 8 MiB/túnel | 200 | 155 pedidos, 2 imagens com timeout; 33 IDs cliente/servidor correlacionados e um evento `TRAFFIC_LIMIT` |
| `b0128bc`, 16 MiB/túnel, oito sessões | 200 | evento load em 47,6 s, documento complete; 166 pedidos, cinco timeouts; 33 eventos de saturação correlacionados, sem novo limite de tráfego |

A segunda medição usou somente 13,5 MB de um teto de processo de 64 MiB: o evento de tráfego indicou o teto individual de 8 MiB, não esgotamento do processo. Na terceira medição o teto individual ampliado não bastou para eliminar a espera entre autoridades/conexões da página. Não houve evidência de bloqueio DNS/TCP pela Steam nessa medição.

Os snapshots sanitizados em `docs/evidence/` preservam contagens e UUIDs para confrontar o cliente com os últimos 64 eventos do relay. Esse histórico é limitado, volátil e pode descartar eventos antigos; não é uma exportação completa do painel Render.

## Implementação entregue

- Fila FIFO de até 32 pedidos, espera máxima de 60 s, cancelamento e desligamento que removem os pedidos sem discar; testes com sockets reais comprovam quatro pedidos através de um único slot.
- Teto finito de 16 túneis simultâneos em cliente/relay, ajustado após a saturação real. Continuam 16 MiB por túnel, 64 MiB por processo, 128 MiB/mês no cliente persistente, 2.000 sessões/dia, 45 s de inatividade e cinco minutos de vida. Não aumentamos franquias do provedor.
- Fechamento WebSocket explícito no cancelamento do CONNECT e no desligamento, com término forçado após um segundo. O teste de reset TCP do navegador reproduziu código WebSocket anormal 1006 antes da correção; depois recebeu fechamento normal. O caso HTTP normal também tem teste.
- Saturação transitória `SESSION_LIMIT` pode ser repetida dentro do prazo; a cota diária `SESSION_QUOTA`, autenticação e falta de orçamento não entram nessa repetição.
- `/diagnostics` exige Bearer, mantém somente 64 eventos restritos (código/etapa/UUID/duração), sem destinos, cookies, tokens ou conteúdo. IDs retornam no veredito WSS e nos headers de saturação autenticada.
- Snapshot IANA IPv4/IPv6 de finalidade especial, recusa conservadora de todas as suas faixas e dos mecanismos de tradução/transição; IPv6 nativo permitido somente em `2000::/3`. Testes cobrem fronteiras dos prefixos, respostas mistas e IPv6 não alocado. A resolução inteira é validada antes de fornecer a lista numérica ao conector, que não faz segunda resolução.

A lista de faixas é uma política conservadora, não uma garantia de alcançabilidade de todo endereço permitido. Ela pode bloquear exceções especiais legítimas; a navegação comum não necessita dessas exceções.

## CI e controle de deploy

`.github/workflows/ci.yml` instala dependências fixadas, executa a suíte Node, dois testes Chromium locais e toda a suíte Python com GOST 3.3.3 verificado por SHA-256. As fixtures locais usam CA confiada explicitamente e certificados conformes à verificação X.509 estrita. O servidor HTTPS de teste informa Content-Length; nenhum controle TLS foi desabilitado para compatibilizar o runner.

O Blueprint define `autoDeployTrigger: checksPass`; o build também exige `npm test`. Em 05/11 o proprietário confirmou que salvou **After CI Checks Pass** e **npm ci --omit=dev --ignore-scripts && npm test** no serviço Free existente. Consulte [o guia do painel](RENDER-SETTINGS.md).

A proteção obrigatória de `main` no GitHub permanece sem comprovação: a integração retornou 403 ao consultar/configurar proteção. Não habilitamos plano pago nem alteramos a visibilidade do repositório. Essa proteção é distinta do bloqueio de deploy na Render.

## Resultado remoto final — revisão `669eb59`

`/health` informou o SHA completo `669eb59047850d28853cf99f7c24b9e636e434e8`, o mesmo commit aprovado no CI. Duas execuções independentes de Chromium, com perfil novo e todos os tipos de recurso habilitados, passaram no teste explícito `bridge/test/steam-page.mjs`:

| Medida | Execução 1 | Execução 2 |
|---|---|---|
| Documento HTTPS / título | 200 / Welcome to Steam | 200 / Welcome to Steam |
| Evento load / document.readyState | 3.865 ms / complete | 3.720 ms / complete |
| Pedidos observados | 135 | 135 |
| Scripts / CSS / imagens concluídos | 46 / 17 / 60 | 46 / 17 / 60 |
| Fontes / XHR / fetch concluídos | 6 / 1 / 1 | 6 / 1 / 1 |
| Falhas HTTP ou de rede registradas | 0 | 0 |
| Bytes contabilizados pelo cliente | 13.460.605 | 14.240.352 |
| Eventos de saturação recuperada correlacionados por UUID | 21 | 25 |

O período observado terminou oito segundos após load. Havia três chamadas fetch da API Steam ainda pendentes em cada execução; não foram abortadas para acelerar a navegação, e o teste não exige networkidle. O resultado valida a página inicial e recursos observados, não a conclusão dessas chamadas, toda a aplicação Steam ou ausência permanente de erros. Os contadores variam com conteúdo/CDN. Os dois snapshots completos sanitizados estão em `docs/evidence/steam-16-sessions*.json`.

O cliente ainda encontrou `SESSION_LIMIT` no relay e recuperou dentro dos prazos, sem transformá-lo em requisição falhada nessas duas execuções. O teto foi preservado, não desativado. Um segundo após fechar os clientes, os snapshots ainda mostraram 8 e 10 sessões remotas; não alegamos liberação imediata atrás da plataforma. O prazo de inatividade permanece relevante e recargas rápidas/múltiplas abas ainda podem saturar a cota.

No mesmo endpoint, `remote-policy.mjs` passou: upgrade sem credencial e com credencial inválida → 401, metadados/loopback/porta 22 → recusa explícita classificada, três túneis HTTPS concorrentes → 200. `remote-browser.mjs` passou em HTTP e HTTPS, observou saída **74.220.48.29** e comprovou falha de navegação ao encerrar o cliente local, sem fallback direto. O verificador de política foi atualizado para conferir classe/UUID do veredito atual, em vez de supor que ele contém somente ready.

O verificador `remote-cleanup.mjs` encontrou zero sessões antes e depois de 50 s sem consultas intermediárias; bytes permaneceram em 26.936.423. Isso confirma o estado ocioso observado, sem medir o instante exato em que as sessões anteriores foram liberadas.

## Verificações aprovadas no CI

O [run 42016203591](https://github.com/Lopes-V/proxy/actions/runs/42016203591), commit `669eb59047850d28853cf99f7c24b9e636e434e8`, concluiu com sucesso: **42 testes Node, 27 testes Python/GOST, zero ignorados**, além dos dois scripts Chromium. O teste de todos os recursos locais carregou 12 hosts de imagens + CSS + JS com concorrência máxima de dois, sem bloqueio de tipos de recurso. O teste de navegador anterior continua cobrindo HTTP, HTTPS/CONNECT, CA confiada, reinício do cliente na mesma porta e falha sem acesso direto.

O ZIP Windows foi refeito com fila, diagnósticos e snapshot IANA. Um teste extrai o cliente numa pasta separada e importa seus módulos sem depender do checkout. Isso não substitui a execução real do launcher no Windows.

## Limites desta aceitação

Um teste da página inicial não valida login, compra, todas as regiões/CDNs, downloads de jogos ou navegação contínua. O IP de saída é compartilhado e pode ser bloqueado por destinos. A Render Free pode suspender por inatividade/saída incomum; não há garantia de disponibilidade. A confirmação de Free sem meio de pagamento é do proprietário, sem acesso independente à fatura. Windows real ainda não foi executado.
