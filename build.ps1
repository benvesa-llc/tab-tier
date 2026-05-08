# =============================================================================
# Tab Tier — Web Store package builder
#
# Reads the version from manifest.json, copies only the runtime files into a
# staging folder, and produces dist/tabtier-X.Y.Z.zip ready to upload to the
# Chrome Web Store dashboard. Excludes dev tooling (tools/), generated assets
# (store-assets/), markdown docs, the .git folder, node_modules, and build.ps1
# itself — anything not actually loaded by the browser.
#
# Usage (from the repo root):
#   .\build.ps1
# =============================================================================

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# --- Read version --------------------------------------------------------------
$manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
$version = $manifest.version
if ([string]::IsNullOrWhiteSpace($version)) {
    throw "Could not read version from manifest.json"
}

# --- Paths ---------------------------------------------------------------------
$distDir    = Join-Path $PSScriptRoot "dist"
$stagingDir = Join-Path $distDir "_staging"
$zipPath    = Join-Path $distDir "tabtier-$version.zip"

if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force }
if (Test-Path $zipPath)    { Remove-Item $zipPath -Force }
New-Item -ItemType Directory -Path $distDir    -Force | Out-Null
New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

# --- What to include -----------------------------------------------------------
# Single root files (always copied verbatim)
$rootFiles = @(
    "manifest.json"
)
# Root-level glob patterns
$rootGlobs = @(
    "*.html",
    "*.js",
    "*.css"
)
# Whole directories copied recursively
$includeDirs = @(
    "_locales",
    "icons",
    "data"
)

# --- Copy --------------------------------------------------------------------
$copiedFiles = 0

foreach ($f in $rootFiles) {
    if (-not (Test-Path $f)) { throw "Required file missing: $f" }
    Copy-Item $f (Join-Path $stagingDir $f) -Force
    $copiedFiles++
}

foreach ($pattern in $rootGlobs) {
    Get-ChildItem -Path . -Filter $pattern -File | ForEach-Object {
        # EN: Skip build.ps1 (not an extension file) — defensive, the patterns above don't match it anyway
        if ($_.Name -ieq "build.ps1") { return }
        Copy-Item $_.FullName (Join-Path $stagingDir $_.Name) -Force
        $script:copiedFiles++
    }
}

foreach ($d in $includeDirs) {
    if (-not (Test-Path $d)) {
        Write-Warning "Directory not found, skipped: $d"
        continue
    }
    Copy-Item $d (Join-Path $stagingDir $d) -Recurse -Force
    $copiedFiles += (Get-ChildItem -Path (Join-Path $stagingDir $d) -Recurse -File).Count
}

# --- Compress ------------------------------------------------------------------
Compress-Archive -Path "$stagingDir\*" -DestinationPath $zipPath -Force
Remove-Item $stagingDir -Recurse -Force

# --- Report --------------------------------------------------------------------
$zipSizeKB = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host ""
Write-Host "Built v$version" -ForegroundColor Green
Write-Host "  Files:  $copiedFiles" -ForegroundColor Gray
Write-Host "  Output: $zipPath" -ForegroundColor Gray
Write-Host "  Size:   $zipSizeKB KB" -ForegroundColor Gray
Write-Host ""
Write-Host "Upload at: Chrome Web Store dashboard -> Package -> Upload new package" -ForegroundColor Cyan
