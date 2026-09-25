$ErrorActionPreference = "Stop"

$paths = @(
  ".cline/skills/mcbot-ui/SKILL.md",
  ".better-web-ui.md",
  ".cline/mcp.json"
)

foreach ($p in $paths) {
  if (-not (Test-Path $p)) { throw "Missing: $p" }
  Write-Host "OK  $p" -ForegroundColor Green
}

$expectedSkills = @(
  ".cline/skills/frontend-design/SKILL.md",
  ".cline/skills/critique/SKILL.md",
  ".cline/skills/audit/SKILL.md",
  ".cline/skills/polish/SKILL.md",
  ".cline/skills/quieter/SKILL.md"
)

foreach ($p in $expectedSkills) {
  if (Test-Path $p) {
    Write-Host "OK  $p" -ForegroundColor Green
  } else {
    Write-Warning "Not installed yet: $p"
  }
}

$mcp = Get-Content ".cline/mcp.json" -Raw | ConvertFrom-Json
if ($null -eq $mcp.mcpServers.playwright) {
  throw "Playwright MCP entry is missing."
}
Write-Host "OK  .cline/mcp.json -> playwright" -ForegroundColor Green

if (Test-Path ".cline/context-index.json") {
  $ctx = Get-Content ".cline/context-index.json" -Raw | ConvertFrom-Json
  if ($null -eq $ctx.taskMap.ui) { throw "UI task routing was not added." }
  if ($null -eq $ctx.skillRouting.'mcbot-ui') { throw "mcbot-ui skill routing was not added." }
  Write-Host "OK  context-index UI routing" -ForegroundColor Green
}

Write-Host "Verification complete." -ForegroundColor Green
