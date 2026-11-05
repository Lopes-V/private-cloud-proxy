# Reduzir espera de abertura e saturação

Objetivo: corrigir a lentidão contínua reportada no Windows mantendo WSS, autenticação, TLS e cotas finitas. O usuário pediu execução autônoma e dispensou aprovações de decisões comuns; as escolhas abaixo são do implementador.

Evidência: registro do cliente contém 13 falhas de abertura de aproximadamente 15 s e 61 recusas SESSION_LIMIT. Consulta autenticada encontrou zero sessões, 206 sessões acumuladas e 67.108.839/67.108.864 bytes usados. A saúde respondeu em 236 ms. As medições anteriores também mostraram 8–10 sessões retidas um segundo após fechar o cliente.

Abordagens: aumentar somente concorrência adia a saturação; baixar o timeout de ociosidade pode interromper respostas lentas legítimas. Escolha: verificar prontidão/cota uma vez ao iniciar, e cancelar sessões terminadas por um pequeno endpoint HTTPS autenticado, idempotente, identificado pelo UUID já existente. Isso libera recursos mesmo se o leitor WSS estiver bloqueado por backpressure. A conexão de navegação continua sendo o mesmo túnel; não há multiplexação nova nem reconstrução da arquitetura.

Cliente: checkRelay() valida /usage por HTTPS com confiança normal, Bearer, prazo máximo de 90 s e resposta até 16 KiB. Uma consulta iniciada pelo usuário, sem heartbeat. Consome reserva de 8 KiB no ledger. O navegador só abre se autenticação/cota estiverem válidas. Ao fechar um túnel, DELETE /tunnel/UUID cancela a sessão; aguarda até 2 s, mantendo o slot local até concluir a limpeza. Servidor anterior/indisponível mantém fallback para fechamento WSS e timeout existente.

Servidor: DELETE exige o mesmo Bearer, UUID válido e nenhuma navegação/host no caminho; responde 204 idempotente e remove sessão/cancela socket. Continua 16 sessões, fila local 32, 16 MiB/sessão, 2.000 sessões/dia, 45 s ocioso e 5 min de vida. Teto de processo passa a 128 MiB, alinhado ao cliente de 128 MiB/mês (inalterado). Reserva mínima de 8 KiB para admissão: quota insuficiente retorna TRAFFIC_LIMIT antes de abrir túnel. O contador volátil não equivale à medição da Render. Não há reset artificial para burlar franquias, mudança de plano ou cobrança habilitada.

Testes: HTTPS/WS locais reais com leitor WSS pausado reproduzem retenção; cancelar deve liberar o slot. Testar cancelamento inválido/sem Bearer, idempotência e queda do endpoint. Prontidão: atraso, auth, cota, CA inválida e tamanho da resposta. Preservar todas as suítes existentes e testar Chromium remoto com baixo tráfego; publicar ZIP atualizado. Windows nativo precisa de novo teste pelo usuário.
