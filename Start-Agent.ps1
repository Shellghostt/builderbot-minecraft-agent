param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
$agentRoot=$PSScriptRoot
$supervisorUrl='http://127.0.0.1:8766'
function Get-AgentStatus {
    if (!(Test-Path -LiteralPath "$agentRoot\data\supervisor-token")) {return $null}
    try {Invoke-RestMethod "$supervisorUrl/status" -Headers @{Authorization=('Bearer '+(Get-Content -Raw -LiteralPath "$agentRoot\data\supervisor-token"))} -TimeoutSec 2} catch {return $null}
}
if (!(Get-AgentStatus)) {
    $pythonPath=(Get-Command python).Source
    Start-Process -FilePath $pythonPath -ArgumentList @('-u',('"'+$agentRoot+'\supervisor.py"')) -WorkingDirectory $agentRoot -WindowStyle Hidden -RedirectStandardOutput "$agentRoot\logs\supervisor.log" -RedirectStandardError "$agentRoot\logs\supervisor-error.log"
}
$config=Get-Content -Raw -LiteralPath "$agentRoot\config.json" | ConvertFrom-Json
$ready=$false
for($attempt=0;$attempt -lt 40;$attempt++) {
    if (Get-AgentStatus) {try {Invoke-WebRequest "http://127.0.0.1:$($config.dashboardPort)/" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ready=$true; break} catch {}}
    Start-Sleep -Milliseconds 500
}
if (!$ready) {throw 'Dashboard did not start. Check logs\supervisor-error.log and logs\dashboard.log.'}
$dashboardKey=Get-Content -Raw -LiteralPath "$agentRoot\data\dashboard-token"
$dashboardUrl="http://127.0.0.1:$($config.dashboardPort)/?token=$dashboardKey"
if (!$NoBrowser) {Start-Process $dashboardUrl}
Write-Output "Minecraft Agent is running. Dashboard: http://127.0.0.1:$($config.dashboardPort)"
Write-Output 'The model and test world may need a minute to finish starting.'
