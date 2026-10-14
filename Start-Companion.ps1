param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
& "$PSScriptRoot\Start-Agent.ps1" -NoBrowser
$key=Get-Content -Raw -LiteralPath "$PSScriptRoot\data\supervisor-token"
Invoke-RestMethod 'http://127.0.0.1:8766/companion/start' -Method Post -ContentType 'application/json' -Body '{}' -Headers @{Authorization=('Bearer '+$key)} | Out-Null
if (!$NoBrowser) {Start-Sleep -Seconds 3; Start-Process 'http://localhost:8080'}
Write-Output 'Mindcraft companion Andy is starting. Owner chat name: SH1FU_01 (editable in vendor\mindcraft\settings.js).'
