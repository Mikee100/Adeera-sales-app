param(
  [int]$KeepVersions = 2
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$salesAppRoot = Resolve-Path (Join-Path $scriptDir '..')
$releaseDir = Join-Path $salesAppRoot 'release'
$targetDir = Resolve-Path (Join-Path $salesAppRoot '..\backend\uploads\pos-updates') -ErrorAction SilentlyContinue

if (-not $targetDir) {
  $targetDir = Join-Path $salesAppRoot '..\backend\uploads\pos-updates'
}

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

$latestYmlPath = Join-Path $releaseDir 'latest.yml'
if (-not (Test-Path $latestYmlPath)) {
  throw "Missing release metadata: $latestYmlPath"
}

$latestYmlContent = Get-Content -Path $latestYmlPath -Raw
$versionMatch = [regex]::Match($latestYmlContent, '(?m)^version:\s*"?(?<version>[^"\r\n]+)"?\s*$')
if (-not $versionMatch.Success) {
  throw 'Could not parse version from release/latest.yml'
}

$latestVersion = $versionMatch.Groups['version'].Value.Trim()
$latestExe = "AdeeraPOS-$latestVersion-Setup.exe"
$latestBlockmap = "$latestExe.blockmap"

$latestExePath = Join-Path $releaseDir $latestExe
$latestBlockmapPath = Join-Path $releaseDir $latestBlockmap

if (-not (Test-Path $latestExePath)) {
  throw "Missing latest installer: $latestExePath"
}
if (-not (Test-Path $latestBlockmapPath)) {
  throw "Missing latest blockmap: $latestBlockmapPath"
}

Copy-Item -Path $latestYmlPath -Destination (Join-Path $targetDir 'latest.yml') -Force
Copy-Item -Path $latestExePath -Destination (Join-Path $targetDir $latestExe) -Force
Copy-Item -Path $latestBlockmapPath -Destination (Join-Path $targetDir $latestBlockmap) -Force

$artifactPattern = '^AdeeraPOS-(?<version>[0-9]+(\.[0-9]+){1,3})-Setup\.exe(\.blockmap)?$'
$allArtifacts = Get-ChildItem -Path $targetDir -File | Where-Object { $_.Name -match $artifactPattern }

if ($allArtifacts.Count -eq 0) {
  Write-Host 'No POS update artifacts found to retain.'
  exit 0
}

$versions = $allArtifacts |
  ForEach-Object {
    if ($_.Name -match $artifactPattern) {
      [pscustomobject]@{
        VersionString = $matches['version']
        Version = [version]$matches['version']
      }
    }
  } |
  Sort-Object -Property Version -Descending |
  Select-Object -ExpandProperty VersionString -Unique

$keepVersionSet = @{}
$versions | Select-Object -First ([Math]::Max($KeepVersions, 1)) | ForEach-Object {
  $keepVersionSet[$_] = $true
}

$toDelete = $allArtifacts | Where-Object {
  $_.Name -match $artifactPattern -and -not $keepVersionSet.ContainsKey($matches['version'])
}

foreach ($file in $toDelete) {
  Remove-Item -Path $file.FullName -Force
}

$kept = $allArtifacts | Where-Object {
  $_.Name -match $artifactPattern -and $keepVersionSet.ContainsKey($matches['version'])
} | Sort-Object Name

Write-Host "POS update deploy complete. Kept versions: $($keepVersionSet.Keys -join ', ')"
Write-Host "Files kept:"
$kept | ForEach-Object { Write-Host " - $($_.Name)" }
if ($toDelete.Count -gt 0) {
  Write-Host "Files removed: $($toDelete.Count)"
}
