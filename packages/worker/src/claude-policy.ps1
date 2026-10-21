# Fixed read-only preflight. No provider/user input, profile loading or policy mutation.
$ErrorActionPreference = 'Stop'
try {
  foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, [Microsoft.Win32.RegistryView]::Registry64)
    try {
      $key = $base.OpenSubKey('SOFTWARE\Policies\ClaudeCode')
      if ($null -ne $key) { $key.Dispose(); exit 1 }
    } finally { $base.Dispose() }
  }
  Write-Output 'absent'
  exit 0
} catch { exit 2 }
