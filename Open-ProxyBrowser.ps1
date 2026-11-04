param(
    [Parameter(Mandatory=$true)][string]$ProxyHost,
    [ValidateRange(1,65535)][int]$Port = 8443
)
$ErrorActionPreference = 'Stop'
if ($ProxyHost.Length -gt 253 -or ($ProxyHost.Split('.') | Where-Object { $_ -notmatch '^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$' })) { throw 'Informe um nome DNS válido para o proxy.' }
$candidates = @()
foreach ($base in @(${env:ProgramFiles}, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
    if ($base) {
        $candidates += Join-Path $base 'Google\Chrome\Application\chrome.exe'
        $candidates += Join-Path $base 'Chromium\Application\chrome.exe'
    }
}
$browser = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $browser) { $cmd = Get-Command chrome.exe, chromium.exe -ErrorAction SilentlyContinue | Select-Object -First 1; if ($cmd) { $browser = $cmd.Source } }
if (-not $browser) { throw 'Chrome ou Chromium não encontrado.' }
$profile = Join-Path $env:LOCALAPPDATA 'PrivateCloudProxy\BrowserProfile'
Write-Host 'O navegador solicitará credenciais se o proxy usar autenticação compatível. Verifique erros de conexão no navegador.'
Start-Process -FilePath $browser -ArgumentList @("--user-data-dir=`"$profile`"", "--proxy-server=https://${ProxyHost}:$Port", '--no-first-run')
