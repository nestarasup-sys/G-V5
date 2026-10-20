param(
  [switch]$Include15Min,
  [switch]$IncludeExperiments,
  [string]$ReportPath = (Join-Path $PSScriptRoot '..\..\video-studio-hardware-report.json')
)

$ErrorActionPreference='Stop'
$project=Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $project

function Run-Step([string]$name,[string]$command){
  $started=[Diagnostics.Stopwatch]::StartNew()
  $output = cmd /d /s /c "$command 2>&1"
  $code=$LASTEXITCODE
  $started.Stop()
  $text=($output | Out-String)
  if($code -ne 0){ throw ("["+$name+"] failed ("+$code+"):"+[Environment]::NewLine+$text) }
  return [ordered]@{name=$name;elapsedMs=$started.ElapsedMilliseconds;output=$text.Trim()}
}

$ffmpeg = $env:GACHA_FFMPEG_PATH
$ffprobe = $env:GACHA_FFPROBE_PATH
if(-not $ffmpeg -or -not $ffprobe){
  $preparedFfmpeg=Join-Path $project 'resources\video-tools\ffmpeg.exe'
  $preparedFfprobe=Join-Path $project 'resources\video-tools\ffprobe.exe'
  if(-not (Test-Path $preparedFfmpeg) -or -not (Test-Path $preparedFfprobe)){
    & (Join-Path $project 'scripts\video-studio\prepare-ffmpeg-lgpl.ps1')
  }
  $ffmpeg=(Resolve-Path $preparedFfmpeg).Path
  $ffprobe=(Resolve-Path $preparedFfprobe).Path
}
$env:GACHA_FFMPEG_PATH=$ffmpeg
$env:GACHA_FFPROBE_PATH=$ffprobe

$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1
$computer=Get-CimInstance Win32_ComputerSystem
$os=Get-CimInstance Win32_OperatingSystem
$gpu=Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion
$encoderText=(& $ffmpeg -hide_banner -encoders 2>&1 | Out-String)
$encoders=@('h264_mf','h264_nvenc','h264_qsv','h264_amf') | Where-Object {$encoderText -match ("\b"+[regex]::Escape($_)+"\b")}

$steps=@()
$steps+=Run-Step 'typecheck' 'npm run typecheck'
$steps+=Run-Step 'build' 'npm run build'
$steps+=Run-Step 'character-media-oracle' 'npm run test:video:character-media-oracle'
$steps+=Run-Step 'serial-turbo-benchmark' 'npm run bench:video:workers'
$steps+=Run-Step 'cold-warm-cache-benchmark' 'npm run bench:video:cache'
$steps+=Run-Step 'full-engine-soak-90' 'npm run test:export:full-engine-soak:90'
if($Include15Min){$steps+=Run-Step 'full-engine-soak-900' 'npm run test:export:full-engine-soak:900'}
if($IncludeExperiments){
  $steps+=Run-Step 'install-render-experiments' 'npm install --no-save --ignore-scripts pixi.js@8.21.0 mediabunny@1.61.6'
  $steps+=Run-Step 'pixi-webgl-ab' 'npx electron scripts/video-studio/pixi-webgl-ab.cjs'
  $steps+=Run-Step 'mediabunny-webcodecs-ab' 'npx electron scripts/video-studio/mediabunny-webcodecs-ab.cjs'
}

$report=[ordered]@{
  schemaVersion=1
  generatedAt=(Get-Date).ToUniversalTime().ToString('o')
  branch='master-desenvolvimento'
  commit=(git rev-parse HEAD).Trim()
  hardware=[ordered]@{
    cpu=$cpu.Name
    logicalProcessors=$computer.NumberOfLogicalProcessors
    totalMemoryBytes=[int64]$computer.TotalPhysicalMemory
    os=$os.Caption
    osVersion=$os.Version
    gpu=@($gpu)
  }
  videoTools=[ordered]@{
    ffmpeg=$ffmpeg
    ffprobe=$ffprobe
    encoders=@($encoders)
    version=(& $ffmpeg -hide_banner -version 2>&1 | Select-Object -First 1)
  }
  include15Min=[bool]$Include15Min
  includeExperiments=[bool]$IncludeExperiments
  steps=$steps
}
$absolute=[IO.Path]::GetFullPath($ReportPath)
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $absolute -Encoding UTF8
Write-Host "Hardware report: $absolute"
Write-Host ($report | ConvertTo-Json -Depth 4)
