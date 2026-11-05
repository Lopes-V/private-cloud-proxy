# Lentidão contínua — investigação de 05/11/2026

## Evidência do incidente

O cliente Windows conseguiu iniciar, mas o log enviado registrou **13 WSS_CONNECTION_FAILED em 15.001–15.018 ms** e **61 SESSION_LIMIT em 256–711 ms**. As tentativas são concorrentes; somar essas durações não mede o tempo total do usuário. O proprietário confirmou lentidão em todas as páginas.

A consulta autenticada ao serviço existente encontrou:

- `/health`: 200 em 236 ms, revisão `669eb59047850d28853cf99f7c24b9e636e434e8`.
- `/usage`: zero sessões ativas, 206 acumuladas, **67.108.839/67.108.864 bytes** usados: somente 25 bytes restantes.
- Últimos eventos do servidor: 23 SESSION_LIMIT e 41 TRAFFIC_LIMIT.

Isso comprova o esgotamento do orçamento interno no momento da consulta, além da saturação anterior. Não prova que todo timeout de abertura fosse cold start: faltam timestamps e telemetria da rede Windows para atribuir cada tentativa. Saúde rápida também não mede a velocidade de todos os destinos externos.

## Correções

1. O launcher agora autentica e verifica `/usage` **antes de abrir o navegador**. Aguarda no máximo 90 s para a retomada natural da Render, lê no máximo 16 KiB e mantém validação TLS. Não envia heartbeat, pings de aquecimento ou consultas periódicas sem pedido do usuário. A consulta e o corpo recebido entram no ledger local.
2. Menos de 8 KiB restantes provoca recusa explícita de cota antes do upgrade, evitando aceitar um túnel incapaz de transmitir. Uma recusa global de tráfego impede novas tentativas dos pedidos já na fila, além dos novos. O navegador não passa a usar acesso direto.
3. O cliente cancela um túnel terminado com `DELETE /tunnel/UUID` sobre HTTPS autenticado. O servidor libera o socket e a vaga sem depender de ler um fechamento WSS que pode estar bloqueado. Esse endpoint exige o mesmo Bearer, UUID válido e responde 204 idempotente, sem destinos ou conteúdo. A limpeza do cliente tem prazo de 2 s e conserva o slot local até a resposta/timeout; servidor anterior ou indisponível usa o fechamento WSS como fallback. A resposta HTTP de controle é descartada ao receber headers, sem drenar corpos inesperados.
4. O teto interno do processo foi alinhado a **128 MiB**, o mesmo valor já previsto no cliente por mês UTC. O ledger mensal existente é preservado. Continuam **16 túneis simultâneos, 32 pedidos em fila, 16 MiB/túnel, 2.000 sessões/dia, 45 s ocioso e cinco minutos por túnel**. Não houve aumento de plano ou recurso pago. O contador de processo é volátil e não equivale à banda total/fatura da Render.

## Testes locais e limites de inferência

- Sockets HTTPS/WS reais: leitor WSS pausado, cancelamento do navegador por TCP FIN e reset. Antes a vaga permanecia ocupada; depois a próxima requisição passa sem retry. A pausa é uma simulação local de backpressure, não reprodução da rede Windows/Render.
- Cancelamento sem autenticação não afeta a sessão; UUID inválido é rejeitado; repetir cancelamento é idempotente; endpoint anterior retorna 404 sem vazar vagas.
- Resposta de cancelamento com corpo que nunca acaba não é drenada nem prende a fila.
- Prontidão testa autenticação incorreta, CA não confiada, corpo excessivo, deadline absoluto e cota insuficiente. O processo de inicialização recusa a cota antes de tentar abrir o navegador.
- Dez pedidos concorrentes com um único slot e cota indisponível: antes produziram sete recusas; depois somente uma, com reserva local de 8 KiB. O número anterior varia conforme scheduling; a expectativa posterior é exatamente uma.
- Suítes anteriores são preservadas, inclusive DNS rebinding, IANA, TLS ponta a ponta, bloqueios e falha sem acesso direto.

128 MiB/mês ainda é uma franquia **pequena** para navegar: a página inicial Steam observada anteriormente consumiu aproximadamente 13–14 MiB por abertura. Essas correções reduzem esperas e tornam limites visíveis; não tornam o plano Free adequado a navegação ilimitada ou downloads de jogos. A Render pode suspender por inatividade ou saída incomum; a confirmação de Free sem pagamento é do proprietário, sem acesso independente à fatura.

Windows nativo continua dependendo de um teste com o ZIP atualizado no computador do usuário. Tempos medidos em Chromium Linux não garantem o mesmo tempo na rede Windows.

## Publicação

Código servido na Render: `b826238ff1b7c144e11f5c2f48933c590596d4ef`, confirmado por /health com TLS válido. [CI 42025541518](https://github.com/Lopes-V/proxy/actions/runs/42025541518) aprovado:58 testes Node,27 Python/GOST e2 scripts Chromium locais. O ZIP extraído foi verificado offline antes de atualizar downloads/windows.

## Navegação remota consecutiva
Revisão observada: `b826238ff1b7c144e11f5c2f48933c590596d4ef`. Aceitação do teste: **True**. Todos os tipos de recurso permaneceram habilitados.
- Steam: HTTP 200, load 4161 ms, 0 falhas na janela observada.
- Wikipedia: HTTP 200, load 1831 ms, 0 falhas na janela observada.
- SteamReturn: HTTP 200, load 1454 ms, 0 falhas na janela observada.

Bytes contabilizados pelo cliente: 20673918. Sessões remotas ao encerrar: 0. Medição com Chromium Linux; não garante o mesmo tempo no Windows. A comparação anterior tinha cota esgotada, então não é uma medição percentual antes/depois.

## Otimização do ledger local (PR #1, 05/11/2026)

O `Budget.consume()` gravava e renomeava `bridge-usage.json` sincronamente a cada bloco recebido/enviado, interrompendo o event loop do cliente para cada operação. A mudança na branch `perf/durable-budget-reservations` grava um **marco superior conservador** de consumo em incrementos de 256 KiB para o limite padrão de 128 MiB, antes de permitir enviar o bloco. Isso reduz o número de escritas sem permitir tráfego não contabilizado.

- Reinicializações carregam o marco superior persistido como consumo realizado. O saldo pode diminuir em até 256 KiB por encerramento abrupto ou reinício; é uma troca consciente por menos I/O com limite rígido.
- Orçamentos menores que 512 KiB continuam contabilizados exatamente, preservando os testes de cotas pequenas.
- Falhas no disco continuam bloqueando a transmissão; não há fallback para contabilização apenas em memória.
- Servidores Render que usam `Budget` sem arquivo não mudam o comportamento.

Microbenchmark local em Node 22, comparando o padrão anterior de escrita/rename com reservas antecipadas: 16.000 blocos de 4 KiB (64 MiB) exigiram cerca de **16.000 vs. 250 escritas**, com tempos indicativos de **1,58 s vs. 28 ms** na máquina do teste. Estes tempos **não** representam latência de abertura de páginas ou testes autenticados na Render. Use `node scripts/bench-budget.mjs` para repetir o microbenchmark com o código efetivo, e o CI para validar as regressões.

O gargalo estrutural remanescente é a abertura de um WSS por túnel lógico, além das limitações de fila, quotas e cold start da Render. Multiplexação requer protocolo novo com controle de fluxo e testes de segurança; não foi introduzida sem evidência de benchmark end-to-end.

## Redução de latência por abertura e controle (05/11/2026)

O cliente agora admite **12** sessões em paralelo, mantendo **16** no servidor para absorver sessões remotas ainda em limpeza. A fila local espera até **20 segundos**, e cada tentativa WSS tem prazo de **10 segundos**, sem alterar a janela global de até 90 segundos usada na retomada de solicitações ativas. Respostas `SESSION_LIMIT` usam novo intervalo de **75–199 ms com jitter**; falhas de rede continuam com backoff exponencial limitado. O slot local é liberado quando o transporte WSS fecha, sem aguardar um `DELETE` remoto de até dois segundos.

O agente HTTPS do cliente permite conexões keep-alive para `/usage` e `DELETE /tunnel/UUID`: respostas de controle pequenas e concluídas deixam o socket reutilizável. Respostas malformadas/sem fim permanecem sujeitas a prazo de cancelamento. A conexão ao destino ativa `TCP_NODELAY`, evitando atraso de Nagle em escritas pequenas.

No relay, um cache LRU de até **128** snapshots DNS, por **20 segundos**, consolida consultas concorrentes ao mesmo domínio. Somente snapshots inteiramente públicos e validados são armazenados; respostas privadas, mistas e falhas nunca são cacheadas. Todos os sockets continuam usando IPs numéricos fixados antes da conexão. A atividade de tráfego atualiza apenas a marca temporal; o timer de ociosidade é reprogramado no vencimento, em vez de ser destruído/criado por bloco.

**Não houve aumento** de cotas do relay, alteração no plano Render, desativação de TLS/SSRF ou suporte a acesso direto como fallback. O limite mensal local de 512 MiB continua separado do limite por processo da Render de 128 MiB.

**Limites:** as mudanças são incrementais e não demonstram redução de RTT Brasil–Oregon. Não há multiplexação de fluxos sobre um único WSS: essa troca requer protocolo binário, controle de fluxo, cancelamento de subfluxos e testes de isolamento adicionais. Não foi adicionada uma cache de DNS permissiva, nem alterado `UV_THREADPOOL_SIZE` sem evidência de saturação. A contabilidade de bytes por stream continua usando `meter` para preservar backpressure e cortes de cota. Ganhos reais dependem de medição remota no Windows com o pacote de CI correspondente.
