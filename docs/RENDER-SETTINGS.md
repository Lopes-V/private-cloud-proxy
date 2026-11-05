# Aplicar o bloqueio por CI no serviço Render existente

Não crie outro serviço, não mude o plano Free e não cadastre cartão.

1. Acesse <https://dashboard.render.com/> e abra o serviço **private-cloud-proxy-free** no workspace correto.
2. Na navegação do serviço, escolha **Settings**. Role até **Build & Deploy**.
3. Ao lado de **Build Command**, escolha **Edit** e salve exatamente:

   ```sh
   npm ci --omit=dev --ignore-scripts && npm test
   ```

4. Em **Auto-Deploy**, escolha **Edit**, selecione **After CI Checks Pass** e salve. Se aparecer **On Commit**, o bloqueio ainda não está aplicado.
5. Confirme **Instance Type: Free**. Nenhuma alteração em Environment/TUNNEL_TOKEN é necessária.
6. Abra a aba **Events** para acompanhar o próximo commit: o deploy automático deve começar depois de o check GitHub **tests** terminar com sucesso. Não use **Manual Deploy** para validar esse bloqueio, pois esse caminho não comprova a espera pelo CI.

Se o serviço for controlado por Blueprint, também é possível abrir **Blueprints → Blueprint do projeto → Manual Sync**. Revise o diff: somente comando de build e comportamento de auto-deploy (e alterações previstas no repositório), sem recursos pagos. Depois confira os valores efetivos em Settings do serviço. Não recrie o Blueprint nem regenere o segredo.

O arquivo `render.yaml` contém `autoDeployTrigger: checksPass`, mas um commit no repositório não prova que a configuração do serviço existente foi sincronizada. O CI do GitHub está em `.github/workflows/ci.yml`. O build da Render executa a suíte Node novamente; a suíte completa inclui Python/GOST e Chromium no GitHub.

A Render documenta que `success`, `neutral` e `skipped` são considerados aprovados. Por isso o job não usa filtros condicionais para omitir os testes e instala o GOST antes dos testes Python. O ambiente sem `GOST_BIN` pode ignorar integrações quando executado manualmente; isso não é a execução configurada no CI.

## Proteção de main no GitHub

Quando disponível para a conta/repositório, em **GitHub → Lopes-V/proxy → Settings → Rules → Rulesets** (ou **Branches → Branch protection rules**) exija pull request e o status check **tests** para `main`. Não habilite plano pago nem torne o repositório público para obter esse recurso. A integração usada pelo agente retornou HTTP 403 nas APIs de proteção; ela não comprovou nem alterou essa regra. O bloqueio de deploy na Render e a proteção de branch são controles separados.

Fonte oficial consultada em 05/11/2026: <https://render.com/docs/deploys#configuring-auto-deploys>.
