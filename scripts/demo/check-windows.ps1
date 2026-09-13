param([Parameter(Mandatory=$true)][string]$DemoRoot)
$ErrorActionPreference='Stop'
$tokens=$null
$parseErrors=$null
$script=Join-Path $DemoRoot 'runtime/bootstrap.ps1'
$ast=[System.Management.Automation.Language.Parser]::ParseFile($script,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count -ne 0){$parseErrors | ForEach-Object {Write-Error $_};exit 1}
if($ast.ParamBlock.Parameters.Count -ne 3){throw 'Unexpected Windows launcher parameters.'}
foreach($action in @('Install','Start','Verify')){
 $cmd=Get-Content -LiteralPath (Join-Path $DemoRoot "$action-Windows.cmd") -Raw
 if(-not $cmd.Contains('"%~dp0runtime\bootstrap.ps1"')){throw 'Missing quoted script-relative path.'}
 if(-not $cmd.Contains("-Action $($action.ToLower())")){throw 'Wrong launcher action.'}
 if(-not $cmd.Contains('exit /b %SOMA_EXIT%')){throw 'Launcher does not preserve exit status.'}
}
Write-Output 'PASS PowerShell syntax, launcher actions, quoted paths and exit propagation.'
Write-Output 'This is not a Windows runtime test; run Verify-Windows.cmd on Windows 11.'
