param([Parameter(Mandatory=$true)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
try {
  $taskRoot = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
  $taskMarker = Join-Path $taskRoot '.rhine-installer.ini'
  if (-not (Test-Path -LiteralPath $taskMarker) -or
      (Get-Content -LiteralPath $taskMarker -Raw) -notmatch '(?m)^Id=local\.rhine\.music\.windows\.preview\s*$') { exit 2 }
  $taskPaths = @((Join-Path $taskRoot 'Rhine Music.exe'), (Join-Path $taskRoot 'runtime\node.exe'))
  $taskTargets = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $taskPaths -contains $_.ExecutablePath })
  foreach ($taskTarget in $taskTargets) {
    if ($taskTarget.Name -eq 'Rhine Music.exe') {
      $taskApp = Get-Process -Id $taskTarget.ProcessId -ErrorAction SilentlyContinue
      if ($taskApp) { $null = $taskApp.CloseMainWindow() }
    }
  }
  if ($taskTargets.Count) { Start-Sleep -Seconds 3 }
  foreach ($taskTarget in $taskTargets) {
    # Recheck both identity and path before acting on a captured PID.
    $taskCurrent = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskTarget.ProcessId)"
    if ($taskCurrent -and $taskCurrent.CreationDate -eq $taskTarget.CreationDate -and
        $taskPaths -contains $taskCurrent.ExecutablePath) {
      & "$env:SystemRoot\System32\taskkill.exe" /PID $taskTarget.ProcessId /T /F *> $null
      if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $taskTarget.ProcessId -ErrorAction SilentlyContinue)) { exit 2 }
    }
  }
  exit 0
} catch { exit 2 }
