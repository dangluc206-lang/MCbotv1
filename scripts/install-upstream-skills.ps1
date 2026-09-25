$ErrorActionPreference = "Stop"

Write-Host "MCbotv1 UI Kit - installing selected upstream skills..." -ForegroundColor Cyan

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw "npx was not found. Install Node.js first."
}

# Official Cline skill.
npx skills add https://github.com/cline/skills --skill frontend-design

# Selected skills only; do not install the entire better-web-ui collection.
npx skills add https://github.com/aladicf/better-web-ui --skill frontend-design --skill critique --skill audit --skill polish --skill quieter

Write-Host ""
Write-Host "Upstream skills installed. Project skill is already in .cline/skills/mcbot-ui." -ForegroundColor Green
Write-Host "Merge mcp/playwright-cline-settings.json into your existing cline_mcp_settings.json." -ForegroundColor Yellow
Write-Host "Restart Cline after the MCP change." -ForegroundColor Yellow
