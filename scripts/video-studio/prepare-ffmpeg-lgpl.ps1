param(
  [string]$ManifestPath = (Join-Path $PSScriptRoot '..\..\resources\video-tools.manifest.json'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\resources\video-tools')
)

$ErrorActionPreference = 'Stop'
$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or -not $manifest.url -or -not $manifest.sha256) { throw 'Manifesto FFmpeg inválido.' }
if (-not $manifest.releaseTag -or [string]$manifest.releaseTag -eq 'latest') { throw 'Runtime FFmpeg precisa usar releaseTag imutável; alias latest é proibido.' }
if (-not ([string]$manifest.url).Contains('/' + [string]$manifest.releaseTag + '/')) { throw 'URL do runtime FFmpeg não corresponde ao releaseTag pinado.' }
if ([string]$manifest.assetName -match '(^|-)latest(-|\.)') { throw 'assetName do runtime FFmpeg precisa ser versionado, não um alias latest.' }

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("gacha-v5-ffmpeg-" + [guid]::NewGuid())
$zip = Join-Path $temp $manifest.assetName
$expanded = Join-Path $temp 'expanded'
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  Invoke-WebRequest -Uri $manifest.url -OutFile $zip -UseBasicParsing
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
  if ($actual -ne ([string]$manifest.sha256).ToLowerInvariant()) {
    throw "SHA-256 do pacote FFmpeg não confere. Esperado $($manifest.sha256), recebido $actual."
  }

  Expand-Archive -LiteralPath $zip -DestinationPath $expanded -Force
  $ffmpeg = Get-ChildItem -Path $expanded -Recurse -File -Filter 'ffmpeg.exe' | Select-Object -First 1
  $ffprobe = Get-ChildItem -Path $expanded -Recurse -File -Filter 'ffprobe.exe' | Select-Object -First 1
  if (-not $ffmpeg -or -not $ffprobe) { throw 'Pacote LGPL não contém ffmpeg.exe + ffprobe.exe.' }

  $buildconf = (& $ffmpeg.FullName -hide_banner -buildconf 2>&1 | Out-String)
  foreach ($flag in $manifest.forbiddenConfigureFlags) {
    if ($buildconf -match [regex]::Escape([string]$flag)) { throw "Build FFmpeg contém flag proibida: $flag" }
  }

  $encoders = (& $ffmpeg.FullName -hide_banner -encoders 2>&1 | Out-String)
  foreach ($encoder in $manifest.requiredEncoders) {
    if ($encoders -notmatch ("\b" + [regex]::Escape([string]$encoder) + "\b")) { throw "Encoder obrigatório ausente: $encoder" }
  }
  $h264 = @($manifest.acceptedH264Encoders | Where-Object { $encoders -match ("\b" + [regex]::Escape([string]$_) + "\b") })
  if ($h264.Count -eq 0) { throw 'Nenhum encoder H.264 aceito está presente no build LGPL.' }

  if (Test-Path -LiteralPath $OutputDirectory) { Remove-Item -LiteralPath $OutputDirectory -Recurse -Force }
  New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
  Copy-Item -LiteralPath $ffmpeg.FullName -Destination (Join-Path $OutputDirectory 'ffmpeg.exe')
  Copy-Item -LiteralPath $ffprobe.FullName -Destination (Join-Path $OutputDirectory 'ffprobe.exe')

  $license = Get-ChildItem $expanded -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|COPYING)(\.txt)?$' } | Select-Object -First 1
  if ($license) {
    Copy-Item -LiteralPath $license.FullName -Destination (Join-Path $OutputDirectory 'FFMPEG_LICENSE.txt')
  }

  @"
Pinned FFmpeg source/compliance information
Upstream source: https://ffmpeg.org/releases/
Build scripts/source provider: https://github.com/BtbN/FFmpeg-Builds
Pinned binary URL and SHA-256: see video-tools.manifest.json and BUILD_INFO.json.
A final release should preserve the applicable LGPL text/source-compliance information.
"@ | Set-Content -LiteralPath (Join-Path $OutputDirectory 'SOURCE_INFO.txt') -Encoding UTF8

  $version = (& $ffmpeg.FullName -hide_banner -version 2>&1 | Select-Object -First 1)
  $info = [ordered]@{
    schemaVersion = 1
    provider = $manifest.provider
    releaseTag = $manifest.releaseTag
    assetName = $manifest.assetName
    assetSha256 = $actual
    versionLine = [string]$version
    license = $manifest.license
    h264Encoders = $h264
    preparedAtUtc = [DateTime]::UtcNow.ToString('o')
    redistributionStatus = 'runtime validated; release still requires FFmpeg LGPL source/compliance checklist'
  }
  $info | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'BUILD_INFO.json') -Encoding UTF8
  Write-Host ($info | ConvertTo-Json -Compress)
}
finally {
  if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
