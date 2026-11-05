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
