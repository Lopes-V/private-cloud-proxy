# Downloads para Windows

## Cliente tradicional

[Baixar o ZIP do cliente existente](https://github.com/Lopes-V/proxy/raw/refs/heads/main/downloads/windows/private-cloud-proxy-free-windows.zip)

Este pacote executa o Chrome/Chromium já instalado e **não** protege a janela contra captura. Ele também pode estar defasado. O [CI](https://github.com/Lopes-V/proxy/actions/workflows/ci.yml) publica uma versão mais recente em **Artifacts**.

## Chromium protegido, portátil (prévia)

[GitHub Releases: Private Cloud Chromium protegido](https://github.com/Lopes-V/proxy/releases/tag/protected-browser-preview)

O novo pacote **PrivateCloudProxy-Protegido-Windows.zip** inclui o cliente de proxy e um navegador Electron/Chromium completo, em uma pasta portátil. O arquivo binário é hospedado em **GitHub Releases**, não commitado diretamente no repositório porque o Chromium é grande. A [ação Windows](https://github.com/Lopes-V/proxy/actions/workflows/protected-browser.yml) também fornece um artefato temporário de build.

Extraia o ZIP completo em uma pasta gravável e execute **Start-Private-Proxy-Protegido.cmd**. O segredo Render continua solicitado com entrada oculta. O navegador usa o mesmo proxy local e cota, mas tem perfil de dados independente.

A janela própria do aplicativo chama `setContentProtection(true)` antes de ser exibida, usando `WDA_EXCLUDEFROMCAPTURE` nas versões modernas do Windows. Isso exclui a janela de diversas APIs de captura do sistema, **mas não de todas as ferramentas ou fotografias**. O navegador não é o Chrome oficial e pode ter diferenças de compatibilidade.

**Importante:** não há necessidade de administrador, injeção em outros processos ou modificação do Chrome tradicional. A versão prévia não é assinada digitalmente e o Windows pode mostrar alertas. Confira o hash SHA-256 fornecido no mesmo release antes de executar.

[Documentação e limitações da versão protegida](../../protected-browser/README.md)

Se encontrar um erro, informe apenas o código entre colchetes, nunca `TUNNEL_TOKEN`, cookies ou URLs privadas.
