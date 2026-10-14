$ErrorActionPreference='Stop'
$key=Get-Content -Raw -LiteralPath "$PSScriptRoot\data\supervisor-token"
Invoke-RestMethod 'http://127.0.0.1:8766/stop' -Method Post -ContentType 'application/json' -Body '{}' -Headers @{Authorization=('Bearer '+$key)} | Out-Null
Write-Output 'Saving the test world and stopping the agent services.'
for($attempt=0;$attempt -lt 120;$attempt++) {
    try {Invoke-RestMethod 'http://127.0.0.1:8766/status' -Headers @{Authorization=('Bearer '+$key)} -TimeoutSec 1 | Out-Null} catch {break}
    Start-Sleep -Milliseconds 500
}
