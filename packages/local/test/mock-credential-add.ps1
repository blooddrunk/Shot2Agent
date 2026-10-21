param([string]$Script, [string]$Reference)
# Test only: synthetic token, unique disposable target. Never reads operator credentials.
function global:Read-Host { param([string]$Prompt, [switch]$AsSecureString)
  ConvertTo-SecureString 'synthetic-fixture-only-credential' -AsPlainText -Force
}
& $Script -Action add -Reference $Reference
exit $LASTEXITCODE
