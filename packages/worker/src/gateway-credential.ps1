param([ValidateSet('add','read','delete')][string]$Action, [string]$Reference)
$ErrorActionPreference = 'Stop'
try {
  if ($Reference -notmatch '^Shot2Agent-Gateway-[0-9a-f-]{36}$') { exit 2 }
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
}
'@
  if ($Action -eq 'delete') {
    if (-not [ShotCredential]::CredDelete($Reference,1,0)) { exit 3 }; exit 0
  }
  $ptr = [IntPtr]::Zero
  $exists = [ShotCredential]::CredRead($Reference,1,0,[ref]$ptr)
  if ($Action -eq 'read') {
    if (-not $exists) { exit 3 }
    try {
      $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][ShotCredential+CREDENTIAL])
      $secret = [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, $credential.CredentialBlobSize / 2)
      [Console]::Out.Write($secret)
    } finally { [ShotCredential]::CredFree($ptr) }
    exit 0
  }
  # References are immutable. Replace by adding a NEW reference and approving a NEW Profile.
  if ($exists) { [ShotCredential]::CredFree($ptr); exit 4 }
  if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) { exit 3 }
  $secure = Read-Host 'Gateway API Token (hidden; never saved as plaintext)' -AsSecureString
  $blob = [Runtime.InteropServices.Marshal]::SecureStringToCoTaskMemUnicode($secure)
  try {
    if ($secure.Length -lt 8 -or $secure.Length -gt 2048) { exit 2 }
    $credential = New-Object ShotCredential+CREDENTIAL
    $credential.Type=1; $credential.TargetName=$Reference; $credential.UserName='Shot2Agent'; $credential.Persist=2
    $credential.CredentialBlob=$blob; $credential.CredentialBlobSize=$secure.Length*2
    if (-not [ShotCredential]::CredWrite([ref]$credential,0)) { exit 3 }
  } finally { [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($blob); $secure.Dispose() }
  exit 0
} catch { exit 3 }
