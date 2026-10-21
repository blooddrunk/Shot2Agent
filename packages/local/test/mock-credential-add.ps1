param([string]$Script, [string]$Reference)
# Load the utility cmdlets before installing the synthetic prompt, so child-script
# module autoload cannot shadow it with the noninteractive built-in Read-Host.
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
# Test only: synthetic token, unique disposable target. Never reads operator credentials.
function global:Read-Host { param([string]$Prompt, [switch]$AsSecureString)
  ConvertTo-SecureString 'synthetic-fixture-only-credential' -AsPlainText -Force
}
& $Script -Action add -Reference $Reference
exit $LASTEXITCODE
