#Requires -Version 5.1
<#
  Records CPU and memory for Gridiron OC while it is running.
  Copy this one file to the other PC. No install.

  Terminal: PowerShell (non-Administrator)
  Run from: the folder that contains this script

  powershell -NoProfile -ExecutionPolicy Bypass -File .\measure-gridiron-usage.ps1

  While it records:
    1  idle          Gridiron is open and you are not speaking or capturing
    2  speak         Tap & Speak
    3  ocr           OCR capture
    q  stop and write the summary

  Leave Gridiron closed at the start if you want, then open it. The log
  folder is printed at the end. Copy that folder back for the estimate.
#>
[CmdletBinding()]
param(
  [double]$IntervalSeconds = 1,
  [int]$DurationSeconds = 0
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

if ($IntervalSeconds -lt 0.25) { $IntervalSeconds = 0.25 }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $env:TEMP ("GridironUsage\" + $stamp)
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Format-Num([double]$Value) {
  return $Value.ToString("0.0", [Globalization.CultureInfo]::InvariantCulture)
}

function Get-CimProcesses {
  $query = "SELECT ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime,CreationDate FROM Win32_Process"
  try {
    return @(Get-CimInstance -Query $query)
  } catch {
    $fallback = "SELECT ProcessId,ParentProcessId,Name,ExecutablePath,WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime,CreationDate FROM Win32_Process"
    return @(Get-CimInstance -Query $fallback)
  }
}

function Get-Prop($Object, [string]$Name) {
  if ($null -eq $Object) { return $null }
  if ($Object.PSObject.Properties.Name -contains $Name) { return $Object.$Name }
  return $null
}

function Test-GridironPath([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  return $Text -match "Gridiron|Play Advisor|ocr-sidecar|ocr_sidecar|capture-bridge"
}

$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpus = @(Get-CimInstance Win32_Processor)
$gpus = @(Get-CimInstance Win32_VideoController)
$logical = 0
foreach ($cpu in $cpus) { $logical += [int]$cpu.NumberOfLogicalProcessors }
if ($logical -lt 1) { $logical = 1 }

$machine = [ordered]@{
  capturedAt = (Get-Date).ToString("o")
  computer = [string]$cs.Model
  manufacturer = [string]$cs.Manufacturer
  os = [string]$os.Caption
  version = [string]$os.Version
  build = [string]$os.BuildNumber
  totalRamMB = [math]::Round(([double]$cs.TotalPhysicalMemory) / 1MB, 0)
  cpu = @($cpus | ForEach-Object { [string]$_.Name })
  cores = @($cpus | ForEach-Object { [int]$_.NumberOfCores })
  logicalProcessors = $logical
  maxClockMHz = @($cpus | ForEach-Object { [int]$_.MaxClockSpeed })
  gpu = @($gpus | ForEach-Object { [string]$_.Name })
}
$machine | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $outDir "machine.json") -Encoding UTF8

$samplePath = Join-Path $outDir "samples.csv"
$markerPath = Join-Path $outDir "markers.csv"
$sampleWriter = New-Object System.IO.StreamWriter($samplePath, $false, (New-Object System.Text.UTF8Encoding $false))
$markerWriter = New-Object System.IO.StreamWriter($markerPath, $false, (New-Object System.Text.UTF8Encoding $false))
$sampleWriter.AutoFlush = $true
$markerWriter.AutoFlush = $true
$sampleWriter.WriteLine("time,scenario,kind,name,pid,workingSetMB,privateMB,cpuPctOneCore,cpuPctOfMachine")
$markerWriter.WriteLine("time,scenario")

$gridironKinds = @("app", "ocr-sidecar", "capture-bridge", "whisper", "ffmpeg", "app-helper")
$scenario = "unmarked"
$previousCpu = @{}
$peaks = @{}
$sampleCount = 0
$started = Get-Date

function Touch-Peak([string]$Key, [double]$WorkingSetMB, [double]$PrivateMB, [double]$CpuPct) {
  if (-not $script:peaks.ContainsKey($Key)) {
    $script:peaks[$Key] = @{ WorkingSetMB = 0.0; PrivateMB = 0.0; CpuPctOneCore = 0.0; Samples = 0 }
  }
  $row = $script:peaks[$Key]
  if ($WorkingSetMB -gt $row.WorkingSetMB) { $row.WorkingSetMB = $WorkingSetMB }
  if ($PrivateMB -gt $row.PrivateMB) { $row.PrivateMB = $PrivateMB }
  if ($CpuPct -gt $row.CpuPctOneCore) { $row.CpuPctOneCore = $CpuPct }
  $row.Samples = [int]$row.Samples + 1
}

function Write-Marker([string]$Name) {
  $script:scenario = $Name
  $script:markerWriter.WriteLine(("{0},{1}" -f (Get-Date).ToString("o"), $Name))
  Write-Host ("Scenario: " + $Name)
}

function Get-Kind($Proc) {
  $name = [string](Get-Prop $Proc "Name")
  $path = [string](Get-Prop $Proc "ExecutablePath")
  $cmd = [string](Get-Prop $Proc "CommandLine")
  $blob = ($path + " " + $cmd)
  if ($name -eq "gridiron-ocr-sidecar.exe") { return "ocr-sidecar" }
  if ($name -eq "GridironCaptureBridge.exe") { return "capture-bridge" }
  if ($name -eq "whisper-cli.exe") { return "whisper" }
  if ($name -eq "ffmpeg.exe") { return "ffmpeg" }
  if ($name -eq "python.exe" -or $name -eq "py.exe") {
    if ($cmd -match "ocr_sidecar") { return "ocr-sidecar" }
  }
  if ($name -eq "Gridiron Play Advisor.exe" -or $name -eq "electron.exe") {
    if ($cmd -match "--type=") { return "app-helper" }
    return "app"
  }
  if ($blob -match "whisper-cli") { return "whisper" }
  return "app-helper"
}

function Test-Seed($Proc) {
  $name = [string](Get-Prop $Proc "Name")
  $path = [string](Get-Prop $Proc "ExecutablePath")
  $cmd = [string](Get-Prop $Proc "CommandLine")
  if ($name -eq "Gridiron Play Advisor.exe") { return $true }
  if ($name -eq "gridiron-ocr-sidecar.exe") { return $true }
  if ($name -eq "GridironCaptureBridge.exe") { return $true }
  if ($name -eq "electron.exe" -and (Test-GridironPath ($path + " " + $cmd))) { return $true }
  if (($name -eq "python.exe" -or $name -eq "py.exe") -and $cmd -match "ocr_sidecar") { return $true }
  return $false
}

function Read-ScenarioKey {
  try {
    if (-not [Console]::KeyAvailable) { return }
  } catch {
    return
  }
  $key = [Console]::ReadKey($true)
  switch ($key.KeyChar) {
    "1" { Write-Marker "idle" }
    "2" { Write-Marker "speak" }
    "3" { Write-Marker "ocr" }
    "q" { $script:stop = $true }
    "Q" { $script:stop = $true }
  }
}

$stop = $false
Write-Host ""
Write-Host "Recording Gridiron OC usage."
Write-Host ("Log folder: " + $outDir)
Write-Host ""
Write-Host "Open Gridiron OC on this PC, use it, and mark each stretch:"
Write-Host "  1 idle    2 speak    3 ocr    q stop"
Write-Host ""

try {
  while (-not $stop) {
    $tickStart = Get-Date
    Read-ScenarioKey
    if ($stop) { break }

    $procs = Get-CimProcesses
    $byId = @{}
    $children = @{}
    $madden = New-Object System.Collections.Generic.List[object]
    foreach ($proc in $procs) {
      $pidValue = [int](Get-Prop $proc "ProcessId")
      $parentValue = [int](Get-Prop $proc "ParentProcessId")
      $byId[$pidValue] = $proc
      if (-not $children.ContainsKey($parentValue)) {
        $children[$parentValue] = New-Object System.Collections.Generic.List[int]
      }
      $children[$parentValue].Add($pidValue)
      $procName = [string](Get-Prop $proc "Name")
      if ($procName -like "Madden*.exe") { $madden.Add($proc) }
    }

    $seen = @{}
    $queue = New-Object System.Collections.Generic.Queue[int]
    foreach ($proc in $procs) {
      if (Test-Seed $proc) {
        $seedId = [int](Get-Prop $proc "ProcessId")
        if (-not $seen.ContainsKey($seedId)) {
          $seen[$seedId] = $true
          $queue.Enqueue($seedId)
        }
      }
    }
    while ($queue.Count -gt 0) {
      $current = $queue.Dequeue()
      if (-not $children.ContainsKey($current)) { continue }
      foreach ($childId in $children[$current]) {
        if ($seen.ContainsKey($childId)) { continue }
        $seen[$childId] = $true
        $queue.Enqueue($childId)
      }
    }

    $now = Get-Date
    $timeText = $now.ToString("o")
    $freeMB = 0.0
    try {
      $mem = Get-CimInstance Win32_OperatingSystem
      $freeMB = ([double]$mem.FreePhysicalMemory) / 1024.0
    } catch {
      $freeMB = 0.0
    }
    $sampleWriter.WriteLine(("{0},{1},system,free-ram,,{2},{3},," -f $timeText, $scenario, (Format-Num $freeMB), (Format-Num ([double]$machine.totalRamMB))))

    $treeWorking = 0.0
    $treePrivate = 0.0
    $treeCpu = 0.0
    $alive = @{}
    $grouped = @{}

    foreach ($pidValue in @($seen.Keys)) {
      $proc = $byId[$pidValue]
      if ($null -eq $proc) { continue }
      $kind = Get-Kind $proc
      $working = ([double](Get-Prop $proc "WorkingSetSize")) / 1MB
      $private = ([double](Get-Prop $proc "PrivatePageCount")) / 1MB
      $ticks = ([double](Get-Prop $proc "KernelModeTime")) + ([double](Get-Prop $proc "UserModeTime"))
      $created = [string](Get-Prop $proc "CreationDate")
      $cpuPct = 0.0
      if ($previousCpu.ContainsKey($pidValue) -and $previousCpu[$pidValue].Created -eq $created) {
        $deltaTicks = $ticks - $previousCpu[$pidValue].Ticks
        $deltaSec = ($tickStart - $previousCpu[$pidValue].At).TotalSeconds
        if ($deltaSec -gt 0 -and $deltaTicks -ge 0) {
          $cpuPct = (($deltaTicks / 10000000.0) / $deltaSec) * 100.0
        }
      }
      $previousCpu[$pidValue] = @{ Ticks = $ticks; Created = $created; At = $tickStart }
      $alive[$pidValue] = $true
      $treeWorking += $working
      $treePrivate += $private
      $treeCpu += $cpuPct
      if (-not $grouped.ContainsKey($kind)) {
        $grouped[$kind] = @{ Working = 0.0; Private = 0.0; Cpu = 0.0 }
      }
      $grouped[$kind].Working += $working
      $grouped[$kind].Private += $private
      $grouped[$kind].Cpu += $cpuPct
      $name = [string](Get-Prop $proc "Name")
      $sampleWriter.WriteLine(("{0},{1},{2},{3},{4},{5},{6},{7},{8}" -f `
        $timeText, $scenario, $kind, $name, $pidValue, `
        (Format-Num $working), (Format-Num $private), (Format-Num $cpuPct), (Format-Num ($cpuPct / $logical))))
    }

    $maddenWorking = 0.0
    foreach ($proc in $madden) {
      $working = ([double](Get-Prop $proc "WorkingSetSize")) / 1MB
      $private = ([double](Get-Prop $proc "PrivatePageCount")) / 1MB
      $maddenWorking += $working
      $name = [string](Get-Prop $proc "Name")
      $pidValue = [int](Get-Prop $proc "ProcessId")
      $sampleWriter.WriteLine(("{0},{1},madden,{2},{3},{4},{5},,," -f `
        $timeText, $scenario, $name, $pidValue, (Format-Num $working), (Format-Num $private)))
    }

    $sampleWriter.WriteLine(("{0},{1},gridiron-total,all,,{2},{3},{4},{5}" -f `
      $timeText, $scenario, (Format-Num $treeWorking), (Format-Num $treePrivate), `
      (Format-Num $treeCpu), (Format-Num ($treeCpu / $logical))))

    $scenarioKey = "scenario:" + $scenario
    Touch-Peak $scenarioKey $treeWorking $treePrivate $treeCpu
    Touch-Peak "all" $treeWorking $treePrivate $treeCpu
    foreach ($kind in $grouped.Keys) {
      $bucket = $grouped[$kind]
      Touch-Peak ("kind:" + $kind) $bucket.Working $bucket.Private $bucket.Cpu
    }
    if ($maddenWorking -gt 0) {
      Touch-Peak "kind:madden" $maddenWorking $maddenWorking 0
    }

    $stale = @($previousCpu.Keys | Where-Object { -not $alive.ContainsKey($_) })
    foreach ($dead in $stale) { $previousCpu.Remove($dead) }

    $sampleCount += 1
    if (($sampleCount % 5) -eq 0) {
      $gridironText = if ($seen.Count -eq 0) { "not running" } else { (Format-Num $treeWorking) + " MB" }
      $maddenText = if ($maddenWorking -gt 0) { (Format-Num $maddenWorking) + " MB" } else { "not running" }
      Write-Host ("{0}s  scenario={1}  gridiron={2}  cpu={3}% of one core  madden={4}  freeRam={5} MB" -f `
        [int]((Get-Date) - $started).TotalSeconds, $scenario, $gridironText, (Format-Num $treeCpu), $maddenText, (Format-Num $freeMB))
    }

    if ($DurationSeconds -gt 0 -and ((Get-Date) - $started).TotalSeconds -ge $DurationSeconds) {
      $stop = $true
      break
    }

    $spent = ((Get-Date) - $tickStart).TotalSeconds
    $sleep = $IntervalSeconds - $spent
    $slices = [math]::Ceiling($sleep / 0.2)
    if ($slices -lt 1) { $slices = 1 }
    for ($i = 0; $i -lt $slices -and -not $stop; $i++) {
      Read-ScenarioKey
      if ($stop) { break }
      $remaining = $IntervalSeconds - ((Get-Date) - $tickStart).TotalSeconds
      if ($remaining -le 0) { break }
      $nap = 0.2
      if ($remaining -lt $nap) { $nap = $remaining }
      Start-Sleep -Milliseconds ([int][math]::Round($nap * 1000))
    }
  }
} finally {
  if ($sampleWriter) { $sampleWriter.Dispose() }
  if ($markerWriter) { $markerWriter.Dispose() }

  $summary = New-Object System.Collections.Generic.List[string]
  $summary.Add("Gridiron OC usage summary")
  $summary.Add("Machine: " + [string]$machine.cpu + "  RAM " + $machine.totalRamMB + " MB  " + $machine.os + " build " + $machine.build)
  $summary.Add("Samples: " + $sampleCount + "   interval: " + $IntervalSeconds + "s")
  $summary.Add("")
  $summary.Add("Peaks are sums of process memory, so shared libraries are counted once per process.")
  $summary.Add("cpuPctOneCore: 100 means one logical processor was full.")
  $summary.Add("")
  $summary.Add("key,peakWorkingSetMB,peakPrivateMB,peakCpuPctOneCore,samples")
  foreach ($key in ($peaks.Keys | Sort-Object)) {
    $row = $peaks[$key]
    $summary.Add(("{0},{1},{2},{3},{4}" -f $key, (Format-Num $row.WorkingSetMB), (Format-Num $row.PrivateMB), (Format-Num $row.CpuPctOneCore), $row.Samples))
  }
  $summaryPath = Join-Path $outDir "summary.txt"
  $summary -join "`r`n" | Set-Content -LiteralPath $summaryPath -Encoding UTF8
  Write-Host ""
  Write-Host "Stopped."
  Write-Host ("Copy this folder back: " + $outDir)
  Write-Host ("Summary: " + $summaryPath)
}
