# Sync Grok CLI brain (~/.grok) into Grok Desktop project layout — skills, memory, clients.
# Does NOT import chat history.

$ErrorActionPreference = 'Stop'
$userHome = $env:USERPROFILE
$grok = Join-Path $userHome '.grok'
$verstak = Join-Path $userHome '.verstak'
$project = $userHome

function Ensure-Junction($link, $target) {
    if (Test-Path $link) {
        $item = Get-Item $link -Force
        if ($item.LinkType -eq 'Junction' -and $item.Target -eq $target) { return }
        if ($item.LinkType -eq 'Junction') { Remove-Item $link -Force }
        elseif ($item.PSIsContainer) {
            Write-Host "  skip $link (exists, not a junction)"
            return
        }
    }
    New-Item -ItemType Junction -Path $link -Target $target -Force | Out-Null
    Write-Host "  junction $link -> $target"
}

function Sync-File($src, $dst) {
    if (-not (Test-Path $src)) { return }
    $srcFull = (Resolve-Path $src).Path
    $dstFull = [System.IO.Path]::GetFullPath($dst)
    if ($srcFull -eq $dstFull) { return }
    $dir = Split-Path $dst -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Copy-Item -Path $src -Destination $dst -Force
    Write-Host "  copied $(Split-Path $src -Leaf)"
}

function Ensure-HardLink($src, $dst) {
    if (-not (Test-Path $src)) { return }
    $dir = Split-Path $dst -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if (Test-Path $dst) {
        $item = Get-Item $dst -Force
        if ($item.LinkType -eq 'HardLink') { return }
        Remove-Item $dst -Force
    }
    New-Item -ItemType HardLink -Path $dst -Target $src -Force | Out-Null
    Write-Host "  hardlink $(Split-Path $dst -Leaf)"
}

Write-Host "[sync] ~/.grok -> Desktop brain"

if (-not (Test-Path $verstak)) { New-Item -ItemType Directory -Path $verstak -Force | Out-Null }

Write-Host "Global ~/.verstak"
Sync-File (Join-Path $grok 'memory\MEMORY.md') (Join-Path $verstak 'MEMORY.md')
Ensure-HardLink (Join-Path $grok 'memory\RAYNER-glossary.md') (Join-Path $verstak 'RAYNER-glossary.md')

$rulesSrc = Join-Path $verstak 'RULES.md'
if (-not (Test-Path $rulesSrc)) {
    @'
# Правила RAYNER (из Grok Build CLI)

Скиллы: ~/.grok/skills/ + ~/.grok/bundled/skills/
Глоссарий: .verstak/RAYNER-glossary.md
Клиенты Директа: clients/{slug}/AGENTS.md (pubg, stim, ostov, avtor).
'@ | Set-Content -Path $rulesSrc -Encoding UTF8
}

$userSrc = Join-Path $verstak 'USER.md'
if (-not (Test-Path $userSrc)) {
    @'
# RAYNER — предпочтения

- Язык: русский.
- Работать самому (команды, файлы), не давать инструкции «сделайте вы».
- Шорткаты клиентов: см. RAYNER-glossary.md.
'@ | Set-Content -Path $userSrc -Encoding UTF8
}

if ($project -ne $userHome) {
    Write-Host "Project $project\.verstak"
    $projVerstak = Join-Path $project '.verstak'
    if (-not (Test-Path $projVerstak)) { New-Item -ItemType Directory -Path $projVerstak -Force | Out-Null }
    Sync-File (Join-Path $grok 'memory\MEMORY.md') (Join-Path $projVerstak 'MEMORY.md')
    Ensure-HardLink (Join-Path $grok 'memory\RAYNER-glossary.md') (Join-Path $projVerstak 'RAYNER-glossary.md')
    Sync-File (Join-Path $verstak 'RULES.md') (Join-Path $projVerstak 'RULES.md')
    Sync-File (Join-Path $verstak 'USER.md') (Join-Path $projVerstak 'USER.md')
}

Write-Host "Junctions"
Ensure-Junction (Join-Path $userHome 'clients') (Join-Path $grok 'clients')
Ensure-Junction (Join-Path $verstak 'skills') (Join-Path $grok 'skills')

$skillCount = @(Get-ChildItem (Join-Path $grok 'skills') -Directory -ErrorAction SilentlyContinue).Count
$bundledCount = @(Get-ChildItem (Join-Path $grok 'bundled\skills') -Directory -ErrorAction SilentlyContinue).Count
Write-Host "[sync] done - $skillCount user skills, $bundledCount bundled from ~/.grok"