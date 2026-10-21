param([ValidateSet('add','read','delete')][string]$Action, [string]$Reference, [switch]$TokenFromPipe)
$ErrorActionPreference = 'Stop'
$stage = 'INPUT'
try {
  if ($TokenFromPipe -and $Action -ne 'add') { exit 2 }
  if ($Reference -notmatch '^Shot2Agent-Gateway-[0-9a-f-]{36}$') { exit 2 }
  $stage = 'NATIVE_TYPE'
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShotCredential {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL {
  public uint Flags, Type; public string TargetName, Comment; public long LastWritten;
  public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist, AttributeCount;
  public IntPtr Attributes; public string TargetAlias, UserName;
 }
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredWrite(ref CREDENTIAL c, uint flags);
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target,uint type,uint flags,out IntPtr p);
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredDelete(string target,uint type,uint flags);
 [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr p);
 // Capture last error inside the same managed call; PowerShell/.NET can overwrite thread last-error between statements.
 public static int ReadStatus(string target, out IntPtr p) { return CredRead(target,1,0,out p) ? 0 : Marshal.GetLastWin32Error(); }
 public static int WriteStatus(ref CREDENTIAL c) { return CredWrite(ref c,0) ? 0 : Marshal.GetLastWin32Error(); }
 public static int DeleteStatus(string target) { return CredDelete(target,1,0) ? 0 : Marshal.GetLastWin32Error(); }
}
'@
  if ($Action -eq 'delete') {
    $code = [ShotCredential]::DeleteStatus($Reference)
    if ($code -eq 1168) { exit 0 }
    if ($code -ne 0) { [Console]::Error.WriteLine('GATEWAY_SECURE_STORE_ERROR_' + $code); exit 3 }; exit 0
  }
  $ptr = [IntPtr]::Zero
  $stage = 'READ'
  $readError = [ShotCredential]::ReadStatus($Reference,[ref]$ptr)
  $exists = $readError -eq 0
  if ($Action -eq 'read') {
    if (-not $exists) { [Console]::Error.WriteLine('GATEWAY_SECURE_STORE_ERROR_' + $readError); exit 3 }
    try {
      $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][ShotCredential+CREDENTIAL])
      $secret = [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, $credential.CredentialBlobSize / 2)
      [Console]::Out.Write($secret)
    } finally { [ShotCredential]::CredFree($ptr) }
    exit 0
  }
  # References are immutable. Replace by adding a NEW reference and approving a NEW Profile.
  if ($exists) { [ShotCredential]::CredFree($ptr); exit 4 }
  if ($readError -ne 1168) { [Console]::Error.WriteLine('GATEWAY_SECURE_STORE_ERROR_' + $readError); exit 3 }
  $stage = 'PROMPT'
  if ($TokenFromPipe) {
    # Private redirected stdin for internal/native tests or a future masked caller.
    # Never a token argument, environment variable, file or diagnostic.
    $stage = 'PIPE_CHECK'
    if (-not [Console]::IsInputRedirected) { exit 2 }
    $stage = 'PIPE_READ'
    $secure = New-Object System.Security.SecureString
    while ($secure.Length -le 2048) {
      $next = [Console]::In.Read()
      if ($next -lt 0 -or $next -eq 10 -or $next -eq 13) { break }
      if ($next -lt 33 -or $next -gt 126) { $secure.Dispose(); exit 2 }
      $secure.AppendChar([char]$next)
    }
    if ($secure.Length -lt 8 -or $secure.Length -gt 2048) { $secure.Dispose(); exit 2 }
    $secure.MakeReadOnly()
  } else {
    $stage = 'INTERACTIVE_PROMPT'
    $secure = Read-Host 'Gateway API Token (hidden; never saved as plaintext)' -AsSecureString
  }
  $stage = 'SECURE_BUFFER'
  $blob = [Runtime.InteropServices.Marshal]::SecureStringToCoTaskMemUnicode($secure)
  try {
    if ($secure.Length -lt 8 -or $secure.Length -gt 2048) { exit 2 }
    $stage = 'WRITE'
    $credential = New-Object ShotCredential+CREDENTIAL
    $credential.Type=1; $credential.TargetName=$Reference; $credential.UserName='Shot2Agent'; $credential.Persist=2
    $credential.CredentialBlob=$blob; $credential.CredentialBlobSize=$secure.Length*2
    $code = [ShotCredential]::WriteStatus([ref]$credential)
    if ($code -ne 0) { [Console]::Error.WriteLine('GATEWAY_SECURE_STORE_ERROR_' + $code); exit 3 }
  } finally { [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($blob); $secure.Dispose() }
  exit 0
} catch { [Console]::Error.WriteLine('GATEWAY_SECURE_STORE_EXCEPTION_' + $stage + '_' + $_.Exception.HResult + '_' + $_.Exception.GetType().Name); exit 3 }
