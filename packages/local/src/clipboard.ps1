$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class ShotClipboard {
  [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern bool EmptyClipboard();
  [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
  [DllImport("user32.dll")] static extern IntPtr SetClipboardData(uint format, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint format);
  [DllImport("user32.dll")] static extern uint RegisterClipboardFormat(string name);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr data);
  [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr data);
  [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr data);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags, UIntPtr size);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
  static readonly IntPtr Owner = CreateWindowEx(0, "STATIC", "Shot2Agent Clipboard", 0, 0, 0, 0, 0, new IntPtr(-3), IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
  static void Lock() { if (Owner == IntPtr.Zero || !OpenClipboard(Owner)) throw new Exception("CLIPBOARD_BUSY"); }
  static byte[] Bytes(uint format, ulong max) {
    IntPtr handle = GetClipboardData(format); ulong size = GlobalSize(handle).ToUInt64();
    if (handle == IntPtr.Zero || size == 0 || size > max) throw new Exception("CLIPBOARD_SIZE");
    IntPtr ptr = GlobalLock(handle); if (ptr == IntPtr.Zero) throw new Exception("CLIPBOARD_BUSY");
    try { byte[] bytes = new byte[(int)size]; Marshal.Copy(ptr, bytes, 0, bytes.Length); return bytes; }
    finally { GlobalUnlock(handle); }
  }
  public static string ReadImage() {
    Lock();
    try {
      uint png = RegisterClipboardFormat("PNG");
      if (IsClipboardFormatAvailable(png)) return Convert.ToBase64String(Bytes(png, 60 * 1024 * 1024));
      uint dib = IsClipboardFormatAvailable(17) ? 17U : 8U;
      if (!IsClipboardFormatAvailable(dib)) return null;
      // CF_BITMAP normally has Windows synthesized CF_DIB available on demand.
      byte[] data = Bytes(dib, 256UL * 1024 * 1024 + 65536);
      if (data.Length < 40) throw new Exception("CLIPBOARD_FORMAT");
      int header = BitConverter.ToInt32(data, 0), width = BitConverter.ToInt32(data, 4), height = BitConverter.ToInt32(data, 8);
      int bpp = BitConverter.ToUInt16(data, 14), compression = BitConverter.ToInt32(data, 16);
      if (header < 40 || header > data.Length || width <= 0 || height == Int32.MinValue || height == 0 || width > 32768 || Math.Abs(height) > 32768 || (long)width * Math.Abs(height) > 64000000) throw new Exception("CLIPBOARD_PIXELS");
      if (compression != 0 && compression != 3 && compression != 6) throw new Exception("CLIPBOARD_FORMAT");
      if (bpp != 1 && bpp != 4 && bpp != 8 && bpp != 16 && bpp != 24 && bpp != 32) throw new Exception("CLIPBOARD_FORMAT");
      uint colors = BitConverter.ToUInt32(data, 32); if (colors == 0 && bpp <= 8) colors = (uint)(1 << bpp);
      long offset = 14L + header + colors * 4L + (header == 40 && compression == 3 ? 12 : header == 40 && compression == 6 ? 16 : 0);
      if (offset > data.Length + 14L) throw new Exception("CLIPBOARD_FORMAT");
      using (MemoryStream bmp = new MemoryStream()) {
        using (BinaryWriter writer = new BinaryWriter(bmp, Encoding.UTF8, true)) {
          writer.Write((ushort)0x4d42); writer.Write(data.Length + 14); writer.Write(0); writer.Write((int)offset); writer.Write(data);
        }
        bmp.Position = 0;
        using (Image image = Image.FromStream(bmp, true, true))
        using (MemoryStream result = new MemoryStream()) {
          image.Save(result, ImageFormat.Png);
          if (result.Length > 60 * 1024 * 1024) throw new Exception("CLIPBOARD_SIZE");
          return Convert.ToBase64String(result.ToArray());
        }
      }
    } finally { CloseClipboard(); }
  }
  public static bool WriteFiles(string[] paths, string expected) {
    if (paths == null || paths.Length < 1 || paths.Length > 5) throw new Exception("INVALID_CLIPBOARD_FILES");
    foreach (string path in paths) if (!Path.IsPathRooted(path) || !File.Exists(path) || path.IndexOf('\0') >= 0 || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new Exception("INVALID_CLIPBOARD_FILES");
    byte[] names = Encoding.Unicode.GetBytes(String.Join("\0", paths) + "\0\0");
    byte[] bytes = new byte[20 + names.Length];
    BitConverter.GetBytes(20).CopyTo(bytes, 0); // DROPFILES.pFiles
    BitConverter.GetBytes(1).CopyTo(bytes, 16); // DROPFILES.fWide
    names.CopyTo(bytes, 20);
    return WritePayload(bytes, 15, expected); // CF_HDROP
  }
  public static bool WriteText(string text, string expected) {
    return WritePayload(Encoding.Unicode.GetBytes(text + "\0"), 13, expected);
  }
  static bool WritePayload(byte[] bytes, uint format, string expected) {
    // Observe sequence changes even while another writer owns the lock, then recheck
    // under our lock before modifying anything. Never refresh the caller's baseline.
    if (!String.IsNullOrEmpty(expected) && GetClipboardSequenceNumber().ToString() != expected) return false;
    // Allocate before clearing. Comparison and write share one native clipboard lock.
    IntPtr handle = GlobalAlloc(0x42, (UIntPtr)bytes.Length);
    if (handle == IntPtr.Zero) throw new Exception("CLIPBOARD_ALLOC");
    bool owned = true;
    try {
      IntPtr ptr = GlobalLock(handle); if (ptr == IntPtr.Zero) throw new Exception("CLIPBOARD_ALLOC");
      try { Marshal.Copy(bytes, 0, ptr, bytes.Length); } finally { GlobalUnlock(handle); }
      Lock();
      try {
        // PowerShell coerces $null to an empty string for a C# string parameter.
        if (!String.IsNullOrEmpty(expected) && GetClipboardSequenceNumber().ToString() != expected) return false;
        if (!EmptyClipboard() || SetClipboardData(format, handle) == IntPtr.Zero) throw new Exception("CLIPBOARD_WRITE_AMBIGUOUS");
        owned = false; return true;
      } finally { CloseClipboard(); }
    } finally { if (owned) GlobalFree(handle); }
  }
}
'@
$notificationIcon = $null
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    $response = $null
    for ($attempt = 0; $attempt -lt 6; $attempt++) {
      try {
        switch ($request.op) {
          'sequence' { $response = @{sequence=[ShotClipboard]::GetClipboardSequenceNumber().ToString()}; break }
          'read' {
            $before = [ShotClipboard]::GetClipboardSequenceNumber().ToString()
            $data = [ShotClipboard]::ReadImage()
            $after = [ShotClipboard]::GetClipboardSequenceNumber().ToString()
            if ($before -ne $after) { throw 'CLIPBOARD_CHANGED' }
            $response = @{sequence=$after; data=$data}; break
          }
          'notify' {
            if (-not [Environment]::UserInteractive) { throw 'NATIVE_NOTIFICATION_UNAVAILABLE' }
            if ($null -eq $notificationIcon) {
              Add-Type -AssemblyName System.Windows.Forms
              $notificationIcon = New-Object System.Windows.Forms.NotifyIcon
              $notificationIcon.Icon = [System.Drawing.SystemIcons]::Information
              $notificationIcon.Text = 'Shot2Agent'
              $notificationIcon.Visible = $true
            }
            $notificationIcon.ShowBalloonTip(5000, 'Shot2Agent', 'Screenshot complete. View the result in Shot2Agent history.', [System.Windows.Forms.ToolTipIcon]::Info)
            $response = @{notified=$true}; break
          }
          'files' { $response = @{written=[ShotClipboard]::WriteFiles([string[]]$request.paths, $request.expected)}; break }
          'write' { $response = @{written=[ShotClipboard]::WriteText($request.text, $request.expected); sequence=[ShotClipboard]::GetClipboardSequenceNumber().ToString()}; break }
          default { throw 'INVALID_OPERATION' }
        }
        break
      } catch {
        if ($request.op -in @('write','files','notify') -or $attempt -eq 5 -or $_.Exception.ToString() -notmatch 'CLIPBOARD_BUSY') { throw }
        Start-Sleep -Milliseconds (30 * ($attempt + 1))
      }
    }
    [Console]::WriteLine(($response | ConvertTo-Json -Compress))
  } catch {
    # Whitelisted phase codes only. Never emit clipboard data or exception text.
    $code = 'CLIPBOARD_UNAVAILABLE_OR_OVERSIZED'
    foreach ($safe in @('CLIPBOARD_BUSY','CLIPBOARD_ALLOC','CLIPBOARD_WRITE_AMBIGUOUS','NATIVE_NOTIFICATION_UNAVAILABLE')) {
      if ($_.Exception.ToString().Contains($safe)) { $code = $safe; break }
    }
    [Console]::WriteLine((@{error=$code} | ConvertTo-Json -Compress))
  }
}

if ($null -ne $notificationIcon) { $notificationIcon.Dispose() }
