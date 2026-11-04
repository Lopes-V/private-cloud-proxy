# Hospedagem sem Oracle — avaliação em 4/11/2026

**Nenhuma alternativa foi comprovada como gratuita por tempo indeterminado para todos os requisitos. Nenhuma conta conectada, recurso criado, faturamento habilitado ou teste remoto executado.** Oracle foi retirada da estratégia; seus arquivos foram preservados somente como histórico. Os arquivos cloud-init/systemd existentes são Ubuntu genérico e não dependem de Oracle.

## Comparação de fontes oficiais atuais

| Plataforma | Compatibilidade e limites | Custo/condição relevante | Decisão |
|---|---|---|---|
| Google Compute Engine | VM TCP nativa, GOST e CONNECT compatíveis. e2-micro gratuita nas regiões us-west1/us-central1/us-east1, 30 GB de disco padrão e 1 GB/mês de saída elegível. | IPv4 externo em uso: US$ 0,005/h, cerca de US$ 3,60–3,72/mês. Transferência acima da franquia e impostos adicionais; requer conta de faturamento. IPv6 gratuito não resolve clientes sem IPv6 nem saída para sites somente IPv4 sem infraestrutura adicional. | Não é totalmente gratuito com IPv4. Pode custar menos que US$ 4 se o tráfego for muito pequeno; não habilitar billing. |
| Koyeb Free | A plataforma agora tem **TCP Proxy público**, em preview. Contudo TCP Proxy é documentado como incompatível com Scale-to-Zero, e a instância Free obrigatoriamente suspende após 1h sem tráfego. | Free: 512 MB, 0,1 vCPU, sem volume persistente, uma instância; documentação desaconselha produção. | Não considerar o plano Free um proxy TCP confiável. O CONNECT real nesse plano não foi testado. |
| Koyeb pago | TCP Proxy encaminha bytes diretamente, com host/porta atribuídos; conceitualmente compatível com TLS GOST/CONNECT. | Compute eco-nano a partir de US$ 1,61/mês (256 MB). A página de pricing indica 100 GB de saída e cobrança futura acima disso a US$ 0,04/GB; diz que ainda não está cobrando e avisará antes. | Compute mais barato que a VPS, mas não é orçamento completo validado: TLS não é terminado/documentado como gerenciado pelo TCP Proxy, exige domínio/certificado próprios, renovação e adaptação do serviço sem systemd/volume. Não foi validado ponta a ponta; não escolhido como produção pronta. |
| Render Free | Entrada pública documentada para HTTP/WebSocket; portas TCP de serviços privados não equivalem a TCP público. Não foi encontrada garantia oficial de transporte CONNECT pelo frontend público. | Suspende após 15 min sem tráfego; 750 horas compartilhadas/mês. Excesso de banda pode gerar cobrança suplementar ou suspensão se não houver meio de pagamento. | Compatibilidade necessária não comprovada. Não selecionar apenas por aceitar aplicações HTTP. |
| AWS EC2 | VM TCP nativa, GOST/CONNECT possíveis. | O plano Free atual para novas contas termina em até 6 meses ou ao consumir créditos (até US$ 200). IPv4 EC2 custa US$ 0,005/h fora das condições/créditos aplicáveis, além de VM/disco/tráfego. | Não é gratuidade permanente. |
| Azure VM | TCP nativo e GOST possíveis. | Oferta de VM gratuita é limitada aos primeiros 12 meses e cotas; IP/disco/tráfego precisam de orçamento regional separado. | Não é gratuidade permanente. |
| Azure Container Apps | Suporta TCP externo, mas exige ambiente com VNet. HTTP ingress não é substituto automaticamente compatível com CONNECT. | Franquia mensal: 180 mil vCPU-s, 360 mil GiB-s e 2 milhões de requests; instância mínima/ociosa pode ser cobrada. Rede, logs e uso acima da franquia precisam ser contabilizados. | Não foi comprovado custo zero para um proxy TCP contínuo. |
| Fly.io | Máquinas TCP compatíveis, mas precisam de adaptação de container/certificados. | Documentação atual: sem free tier para novas organizações; trial US$ 1 por até 7 dias. | Não é gratuito permanente. |
| AWS Lightsail | VM TCP nativa compatível. | IPv4: pacote a partir de US$ 5/mês, 0,5 GB RAM, 20 GB disco e 1 TB de transferência (franquias regionais podem variar). Pacote US$ 3,50 é **somente IPv6**. | Alternativa paga, mais cara que o pacote DO examinado. |
| DigitalOcean Droplet | VM Ubuntu TCP nativa, permitindo GOST TLS/CONNECT diretamente, sem ingress HTTP intermediário. Cloud-init, API, Terraform e console web documentados. | Pacote Basic regular: US$ 4/mês, 512 MiB, 1 vCPU, 10 GiB disco e 500 GiB transferência. Planos bundled incluem IPv4. Excesso de saída US$ 0,01/GiB; IP reservado desassociado US$ 5/mês. Impostos/domínio são separados. | **Melhor caminho preparado para a implementação atual:** reutiliza Ubuntu, systemd, TLS e firewall. É pago e não foi criado. |

Não afirmamos que a VPS de US$ 4 é a mais barata do mercado ou para todo perfil de uso: Koyeb anuncia compute inferior e Google pode ficar abaixo disso com tráfego mínimo. Ela é o menor pacote completo com IPv4/disco/franquia significativa cujo preço confirmamos e para o qual produzimos infraestrutura sem reimplementar o proxy. Não use créditos promocionais como prova de gratuidade permanente. Não foi possível consultar o preço Vultr (fonte oficial retornou HTTP 403); a página Hetzner não forneceu valores extraíveis verificáveis, portanto não inventamos valores nem rankings.

## Custos e operação

- DigitalOcean não suspende essa VM por ociosidade como um PaaS Free; uma VM desligada continua alocada/cobrada. Destruir a VM é diferente de desligá-la. Backups automáticos e IPv6 estão desabilitados no Terraform; não há load balancer, volume extra ou IP reservado.
- US$ 4 é o preço mensal-base publicado, não teto de fatura: tráfego excedente, impostos, câmbio e domínio podem aumentar o total. A franquia é proporcional ao período e compartilhada no time. Confira preço/região no preflight e no painel antes de qualquer criação.
- O pacote de 512 MiB é pequeno. O proxy pessoal é candidato, mas RAM, disco, bootstrap e carga real ainda precisam de validação na VM. Há pacote de US$ 6 com 1 GiB, porém não substituímos automaticamente o tamanho.
- TLS público do GOST usa seu próprio domínio e Certbot. Não compramos domínio, não utilizamos certificado self-signed em produção, nem desativamos a validação TLS.
- No Windows, apenas navegador/PowerShell. O console web DigitalOcean usa SSH internamente, sem exigir SSH instalado no computador cliente. As políticas de rede precisam permitir o caminho do console; Recovery Console é alternativa para recuperação.

## Arquivos e validação

Veja [digitalocean/README.md](digitalocean/README.md). Infraestrutura prepara VM dedicada, firewall dedicado, bootstrap do GOST 3.3.3 com SHA-256 já fixo, espera por DNS e ativa o instalador existente somente após o domínio apontar para o IPv4 da própria VM. A senha continua gerada dentro da VM, sem passar por Terraform/GitHub/user-data.

A variável `allow_paid_deployment` é **false por padrão**. Não executamos `terraform apply`. O estado Terraform e o token não devem ir ao Git; os arquivos de lock de provider devem ser versionados. Os 21 testes existentes foram preservados.

## Fontes oficiais consultadas

- Google Free Tier: https://cloud.google.com/free/docs/free-cloud-features
- Google IPv4: https://cloud.google.com/vpc/network-pricing
- Koyeb instâncias: https://www.koyeb.com/docs/reference/instances
- Koyeb TCP público: https://www.koyeb.com/docs/run-and-scale/tcp-proxy
- Koyeb pricing: https://www.koyeb.com/docs/faqs/pricing
- Render Free: https://render.com/docs/free
- Render Web Services: https://render.com/docs/web-services
- AWS Free: https://aws.amazon.com/free/
- AWS IPv4: https://aws.amazon.com/vpc/pricing/
- Lightsail: https://aws.amazon.com/lightsail/pricing/
- Azure Free: https://azure.microsoft.com/en-us/pricing/free-services
- Azure ingress TCP: https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview
- Azure Container Apps pricing: https://azure.microsoft.com/en-us/pricing/details/container-apps/
- Fly: https://fly.io/docs/about/pricing/
- DO Droplets: https://www.digitalocean.com/pricing/droplets
- DO IPv4: https://docs.digitalocean.com/products/networking/reserved-ips/details/pricing/
- DO tráfego: https://docs.digitalocean.com/platform/billing/bandwidth/
- DO console web: https://docs.digitalocean.com/products/droplets/how-to/connect-with-console/
- DO provider oficial: https://github.com/digitalocean/terraform-provider-digitalocean
