param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\dist\windows-portable')
)

$ErrorActionPreference = 'Stop'
$project = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$electronDist = Join-Path $project 'node_modules\electron\dist'
$out = Join-Path $project 'out'
$tools = Join-Path $project 'resources\video-tools'
if (-not (Test-Path $electronDist)) { throw 'Electron distribution is not installed.' }
if (-not (Test-Path $out)) { throw 'Run npm run build before packaging.' }
if (-not (Test-Path (Join-Path $tools 'ffmpeg.exe')) -or -not (Test-Path (Join-Path $tools 'ffprobe.exe'))) {
  throw 'Prepare resources/video-tools before packaging.'
}

$destination = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path $destination) { Remove-Item $destination -Recurse -Force }
New-Item -ItemType Directory -Path $destination | Out-Null
Copy-Item (Join-Path $electronDist '*') $destination -Recurse -Force

$electronExe = Join-Path $destination 'electron.exe'
$appExe = Join-Path $destination 'Gacha Nymi V5.exe'
if (-not (Test-Path $electronExe)) { throw 'electron.exe was not found in Electron dist.' }
Move-Item $electronExe $appExe

$resources = Join-Path $destination 'resources'
$appRoot = Join-Path $resources 'app'
if (Test-Path $appRoot) { Remove-Item $appRoot -Recurse -Force }
New-Item -ItemType Directory -Path $appRoot | Out-Null
Copy-Item $out (Join-Path $appRoot 'out') -Recurse -Force
Copy-Item (Join-Path $project 'package.json') (Join-Path $appRoot 'package.json')
Copy-Item (Join-Path $project 'node_modules') (Join-Path $appRoot 'node_modules') -Recurse -Force

$toolDestination = Join-Path $resources 'video-tools'
if (Test-Path $toolDestination) { Remove-Item $toolDestination -Recurse -Force }
Copy-Item $tools $toolDestination -Recurse -Force
Copy-Item (Join-Path $project 'resources\video-tools.manifest.json') (Join-Path $toolDestination 'MANIFEST.json')

$notices = Join-Path $resources 'THIRD_PARTY_NOTICES'
New-Item -ItemType Directory -Path $notices -Force | Out-Null
@"
Gacha Nymi V5 - bundled media runtime

FFmpeg
License: LGPL-2.1-or-later (selected build; configure flags are validated by CI)
Upstream: https://ffmpeg.org/
Build provider: BtbN/FFmpeg-Builds
The exact downloaded package, SHA-256, version and encoder set are recorded in:
  resources/video-tools/BUILD_INFO.json
and the pinned source manifest in:
  resources/video-tools/MANIFEST.json

This portable package does not rely on an FFmpeg installation from the user's PATH.
For release distribution, preserve this notice and the upstream LGPL license/source-compliance information.
"@ | Set-Content -LiteralPath (Join-Path $notices 'VIDEO_TOOLS.txt') -Encoding UTF8

$packageInfo = [ordered]@{
  schemaVersion = 1
  kind = 'windows-portable'
  executable = 'Gacha Nymi V5.exe'
  appMain = 'resources/app/out/main/main.js'
  videoTools = @('resources/video-tools/ffmpeg.exe','resources/video-tools/ffprobe.exe')
  generatedAtUtc = [DateTime]::UtcNow.ToString('o')
}
$packageInfo | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $resources 'GACHA_PACKAGE.json') -Encoding UTF8
Write-Host ($packageInfo | ConvertTo-Json -Compress)
