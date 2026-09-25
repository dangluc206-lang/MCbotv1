$ErrorActionPreference = "Stop"

Write-Host "Checking MCbotv1 UI kit..." -ForegroundColor Cyan

$required = @(
  ".cline/skills/mcbot-ui/SKILL.md",
  "mcp/playwright-cline-settings.json"
)

foreach ($path in $required) {
  if (-not (Test-Path $path)) {
    throw "Missing: $path"
  }
  Write-Host "OK  $path" -ForegroundColor Green
}

if (Test-Path "src/desktop/renderer/index.html") {
  Write-Host "OK  MCbotv1 renderer detected" -ForegroundColor Green
} else {
  Write-Warning "Renderer path not found. Run this from MCbotv1 repository root."
}

Write-Host "Done." -ForegroundColor Green
