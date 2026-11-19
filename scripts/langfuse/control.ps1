# SP004 agent-observability §4.7.3：本机 Langfuse 启停控制。
# start 先初始化凭据，再 docker compose up -d；stop 仅停容器，保留数据卷与凭据。
# 禁止 down -v（会删除本实例数据）。Windows 无 Docker CLI 时走 WSL 并保活。
param(
  [ValidateSet('start', 'stop', 'status', 'logs')][string]$Action = 'start',
  [string]$Distro = 'Ubuntu',
  # 单机默认一个实例。若本机已有其他仓库的同名实例，用独立项目名隔离，
  # 避免重建/接管其他项目的容器与数据卷。
  [string]$Project = 'budingx-langfuse'
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))

if ($Action -eq 'start') {
  & node (Join-Path $PSScriptRoot 'init-local.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Local initialization failed' }
}

$composeArgs = @(
  'compose', '-p', $Project,
  '--env-file', '.runtime/langfuse/local.env',
  '-f', 'ops/langfuse/compose.yaml'
)
switch ($Action) {
  'start'  { $composeArgs += @('up', '-d') }
  'stop'   { $composeArgs += @('stop') }
  'status' { $composeArgs += @('ps') }
  'logs'   { $composeArgs += @('logs', '--tail', '100', 'langfuse-web', 'langfuse-worker') }
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
  Push-Location $repoRoot
  try { & docker @composeArgs } finally { Pop-Location }
} else {
  if ($Action -eq 'start') {
    # 隐藏的 WSL 保活进程让服务在启动器退出后继续可用；不改全局启动项。
    $keeperFile = Join-Path $repoRoot '.runtime/langfuse/wsl-keeper.json'
    $keeperValid = $false
    if (Test-Path -LiteralPath $keeperFile) {
      $saved = Get-Content -LiteralPath $keeperFile -Raw | ConvertFrom-Json
      $process = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
      $keeperValid = $process -and $process.ProcessName -eq 'wsl' -and
        $process.StartTime.ToUniversalTime().ToString('o') -eq $saved.started
    }
    if (-not $keeperValid) {
      $keeper = Start-Process -FilePath wsl.exe -ArgumentList @('-d', $Distro, '--', 'sleep', 'infinity') -WindowStyle Hidden -PassThru
      @{ pid = $keeper.Id; started = $keeper.StartTime.ToUniversalTime().ToString('o'); distro = $Distro } |
        ConvertTo-Json | Set-Content -LiteralPath $keeperFile
    }
  }
  $windowsRootForWsl = $repoRoot.Replace('\', '/')
  $pathOutput = & wsl -d $Distro --exec wslpath -a $windowsRootForWsl
  if ($LASTEXITCODE -ne 0) { throw 'WSL path lookup failed; ensure Docker is installed in the selected distro' }
  $linuxRoot = ($pathOutput -join '').Trim()
  & wsl -d $Distro --cd $linuxRoot -- docker @composeArgs
}
if ($LASTEXITCODE -ne 0) { throw "Langfuse $Action failed" }
