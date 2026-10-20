$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $PSScriptRoot
$toolDir = Join-Path $base '.tools'
$sdkDir = Join-Path $toolDir 'dotnet'
$sdkVersion = '10.0.402'
$templatesVersion = '12.1.4'
$dotnet = Join-Path $sdkDir 'dotnet.exe'
New-Item -ItemType Directory -Force -Path $toolDir | Out-Null
if (!(Test-Path -LiteralPath $dotnet)) {
    $metadata = Invoke-RestMethod 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json'
    $sdk = @($metadata.releases | ForEach-Object { $_.sdks } | Where-Object { $_.version -eq $sdkVersion })[0]
    if (!$sdk) { throw "SDK $sdkVersion nao encontrado no manifesto oficial." }
    $file = $sdk.files | Where-Object { $_.rid -eq 'win-x64' -and $_.name -like '*.zip' } | Select-Object -First 1
    if (!$file) { throw 'Pacote Windows x64 nao encontrado.' }
    $archive = Join-Path $toolDir 'dotnet-sdk.zip'
    Write-Host "Baixando .NET SDK $sdkVersion..."
    Invoke-WebRequest -UseBasicParsing -Uri $file.url -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA512).Hash -ne $file.hash) { throw 'Hash do SDK incorreto.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $sdkDir -Force
}
$env:DOTNET_ROOT = $sdkDir
$env:DOTNET_CLI_HOME = Join-Path $toolDir 'cli-home'
$env:NUGET_PACKAGES = Join-Path $base '.packages'
$env:NUGET_HTTP_CACHE_PATH = Join-Path $toolDir 'nuget-http-cache'
$env:NUGET_PLUGINS_CACHE_PATH = Join-Path $toolDir 'nuget-plugins-cache'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
$env:DOTNET_CLI_UI_LANGUAGE = 'en-US'
$env:PATH = "$sdkDir;$env:PATH"
Push-Location $base
try {
    & $dotnet --version
    if ($LASTEXITCODE -ne 0) { throw 'SDK indisponivel ou versao diferente da fixada.' }
    $installed = (& $dotnet new uninstall | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao consultar templates locais.' }
    if ($installed -notmatch "Avalonia\.Templates[\s\S]*?Version:\s*$([regex]::Escape($templatesVersion))") {
        & $dotnet new install "Avalonia.Templates@$templatesVersion"
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar templates Avalonia.' }
    }
    Write-Host 'Ambiente local pronto. Visual Studio nao e necessario.'
} finally { Pop-Location }
