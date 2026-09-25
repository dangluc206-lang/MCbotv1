$ErrorActionPreference = "Stop"

Write-Host "MCbotv1 UI Kit v2" -ForegroundColor Cyan
Write-Host "Run this script from the MCbotv1 repository root." -ForegroundColor Cyan

if (-not (Test-Path "package.json") -or -not (Test-Path "src/desktop/renderer/index.html")) {
  throw "MCbotv1 repository root was not detected."
}

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw "npx was not found. Install Node.js 22+ first."
}

# Project-specific skill: already included in this package.
Write-Host "OK  mcbot-ui project skill"

# Install official Cline frontend-design directly into this project.
# --agent cline => .cline/skills
# --copy prevents symlink surprises on Windows
# --yes makes the install non-interactive
Write-Host "Installing Cline frontend-design..."
npx skills add https://github.com/cline/skills --agent cline --skill frontend-design --copy --yes

# Install only the selected better-web-ui skills.
Write-Host "Installing selected better-web-ui skills..."
npx skills add https://github.com/aladicf/better-web-ui --agent cline --skill critique --skill audit --skill polish --skill quieter --copy --yes

Write-Host "Merging project MCP configuration..."
$mcpPath = ".cline/mcp.json"
if (Test-Path $mcpPath) {
  $raw = Get-Content $mcpPath -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) {
    $existing = @{ mcpServers = @{} }
  } else {
    $existing = $raw | ConvertFrom-Json
  }

  if ($null -eq $existing.mcpServers) {
    $existing | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) -Force
  }

  $servers = @{}
  foreach ($p in $existing.mcpServers.PSObject.Properties) {
    $servers[$p.Name] = $p.Value
  }

  if (-not $servers.ContainsKey("playwright")) {
    $servers["playwright"] = [pscustomobject]@{
      type = "stdio"
      command = "npx"
      timeout = 30
      args = @("-y", "@playwright/mcp@latest")
      disabled = $false
    }
  } else {
    Write-Warning "Existing playwright MCP entry found; leaving it unchanged."
  }

  $out = [ordered]@{ mcpServers = [pscustomobject]$servers }
  ($out | ConvertTo-Json -Depth 20) + "`n" | Set-Content $mcpPath -Encoding utf8
}

Write-Host "Updating .cline/context-index.json..."
$contextPath = ".cline/context-index.json"
if (Test-Path $contextPath) {
  $ctx = Get-Content $contextPath -Raw | ConvertFrom-Json

  if ($null -eq $ctx.taskMap.ui) {
    $ctx.taskMap | Add-Member -NotePropertyName ui -NotePropertyValue ([pscustomobject]@{
      read = @(
        ".cline/routing.json#desktop",
        ".cline/architecture.json",
        "src/desktop/renderer/index.html",
        "src/desktop/renderer/styles.css",
        "src/desktop/renderer/app.js",
        "src/desktop/renderer/pages/PageCatalog.js",
        ".better-web-ui.md"
      )
    }) -Force
  }

  if ($null -eq $ctx.skillRouting.'mcbot-ui') {
    $ctx.skillRouting | Add-Member -NotePropertyName 'mcbot-ui' -NotePropertyValue ([pscustomobject]@{
      trigger = @(
        "UI", "renderer", "desktop UI", "Dev UI", "HTML", "CSS", "layout",
        "styling", "visual", "interface", "dashboard", "accessibility"
      )
      beforeEdit = $true
      skill = ".cline/skills/mcbot-ui/SKILL.md"
    }) -Force
  }

  ($ctx | ConvertTo-Json -Depth 30) + "`n" | Set-Content $contextPath -Encoding utf8
}

Write-Host ""
Write-Host "DONE. Restart Cline." -ForegroundColor Green
Write-Host "Skills should now be present under .cline/skills/."
Write-Host "Playwright project config: .cline/mcp.json"
