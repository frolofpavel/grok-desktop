# Локальный деплой Grok Desktop → %LOCALAPPDATA%\Programs\Grok Desktop
# Запуск: npm run deploy:local
#         npm run deploy:local -- -SkipTests  (только пересборка, без тестов)

param(
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$Source = Join-Path $ProjectRoot 'release\win-unpacked'
$Target = Join-Path $env:LOCALAPPDATA 'Programs\Grok Desktop'

if (Get-Process -Name 'Grok Desktop' -ErrorAction SilentlyContinue) {
  Write-Error 'Grok Desktop запущен. Закройте приложение и повторите деплой.'
  exit 1
}

$env:Path = "C:\Program Files\nodejs;" + $env:Path
Set-Location $ProjectRoot

if (-not $SkipTests) {
  Write-Host 'Тесты…'
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host 'Сборка dist:win…'
& npm.cmd run dist:win
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Test-Path (Join-Path $Source 'Grok Desktop.exe'))) {
  Write-Error "Сборка не найдена: $Source"
  exit 1
}

Write-Host "Копирование → $Target"
& robocopy $Source $Target /MIR /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) {
  Write-Error "robocopy завершился с кодом $LASTEXITCODE"
  exit $LASTEXITCODE
}

$ts = Get-Date -Format 'dd.MM.yyyy HH:mm'
Write-Host ''
Write-Host "OK: задеплоено ($ts)"
Write-Host 'Журнал: обновите deployed в scripts/sync-desktop-changelog.cjs → node scripts/sync-desktop-changelog.cjs'