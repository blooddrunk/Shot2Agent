$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -ReferencedAssemblies System.Drawing,System,System.Core -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Collections.Generic;
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
  [StructLayout(LayoutKind.Sequential)] struct NativeMessage {
    public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam;
    public uint time; public int x; public int y; public uint privateData;
  }
  [DllImport("user32.dll")] static extern bool PeekMessage(out NativeMessage message, IntPtr hwnd, uint min, uint max, uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref NativeMessage message);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref NativeMessage message);
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)] static extern uint DragQueryFile(IntPtr drop, uint index, StringBuilder name, uint length);
  static readonly Queue<string> Requests = new Queue<string>();
  static readonly AutoResetEvent InputReady = new AutoResetEvent(false);
  static bool readerStarted, inputEnded;
  static void PumpMessages() {
    NativeMessage message;
    while (PeekMessage(out message, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref message); DispatchMessage(ref message); }
  }
  // The clipboard owner is a real HWND. Keep its STA responsive while awaiting pipe input.
  public static string NextRequest() {
    if (!readerStarted) {
      readerStarted = true;
      Thread reader = new Thread(delegate() {
        try {
          string line;
          while ((line = Console.ReadLine()) != null) {
            lock (Requests) { Requests.Enqueue(line); }
            InputReady.Set();
          }
        } finally { lock (Requests) { inputEnded = true; } InputReady.Set(); }
      });
      reader.IsBackground = true; reader.Start();
    }
    while (true) {
      PumpMessages();
      lock (Requests) { if (Requests.Count > 0) return Requests.Dequeue(); if (inputEnded) return null; }
      InputReady.WaitOne(20);
    }
  }
  public static void WaitResponsive(int milliseconds) {
    var timer = System.Diagnostics.Stopwatch.StartNew();
    while (timer.ElapsedMilliseconds < milliseconds) { PumpMessages(); Thread.Sleep(5); }
  }
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
  // Hold OpenClipboard across inspection and deletion: replacement cannot race cleanup.
  // Keep recent files too, allowing already-started Explorer copies to settle.
  public static int[] CleanCache(string directory) {
    if (!Path.IsPathRooted(directory) || Path.GetFileName(directory) != "file-clipboard") throw new Exception("UNSAFE_FILE_CACHE");
    string full = Path.GetFullPath(directory);
    for (DirectoryInfo d = new DirectoryInfo(full); d != null; d = d.Parent)
      if ((d.Attributes & FileAttributes.ReparsePoint) != 0) throw new Exception("UNSAFE_FILE_CACHE");
    Lock();
    try {
      HashSet<string> keep = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      if (IsClipboardFormatAvailable(15)) {
        IntPtr drop = GetClipboardData(15);
        if (drop == IntPtr.Zero) throw new Exception("FILE_CACHE_CLEANUP_FAILED");
        uint count = DragQueryFile(drop, 0xffffffff, null, 0);
        if (count == 0 || count > 1000) throw new Exception("FILE_CACHE_CLEANUP_FAILED");
        for (uint i = 0; i < count; i++) {
          uint size = DragQueryFile(drop, i, null, 0);
          if (size == 0 || size > 32767) throw new Exception("FILE_CACHE_CLEANUP_FAILED");
          StringBuilder name = new StringBuilder((int)size + 1);
          if (DragQueryFile(drop, i, name, size + 1) != size) throw new Exception("FILE_CACHE_CLEANUP_FAILED");
          keep.Add(Path.GetFullPath(name.ToString()));
        }
      }
      string[] paths = Directory.GetFileSystemEntries(full);
      if (paths.Length > 1100) throw new Exception("UNSAFE_FILE_CACHE");
      // Validate the whole set before any delete; never recurse or follow reparse points.
      foreach (string path in paths) {
        string name = Path.GetFileName(path);
        if ((File.GetAttributes(path) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0 ||
            !System.Text.RegularExpressions.Regex.IsMatch(name, @"^(?:[0-9a-f-]{36}\.md|\.[0-9a-f-]{36}-[0-9a-f-]{36}\.tmp)$")) throw new Exception("UNSAFE_FILE_CACHE");
      }
      int deleted = 0, retained = 0;
      DateTime cutoff = DateTime.UtcNow.AddMinutes(-10);
      foreach (string path in paths) {
        if (keep.Contains(path) || File.GetLastWriteTimeUtc(path) >= cutoff) { retained++; continue; }
        try { File.Delete(path); deleted++; } catch { throw new Exception("FILE_CACHE_CLEANUP_FAILED"); }
      }
      return new int[] { deleted, retained };
    } finally { CloseClipboard(); }
  }
  public static bool WriteFiles(string[] paths, string expected, int verifyMilliseconds) {
    if (paths == null || paths.Length < 1 || paths.Length > 5) throw new Exception("INVALID_CLIPBOARD_FILES");
    foreach (string path in paths) if (!Path.IsPathRooted(path) || !File.Exists(path) || path.IndexOf('\0') >= 0 || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new Exception("INVALID_CLIPBOARD_FILES");
    byte[] names = Encoding.Unicode.GetBytes(String.Join("\0", paths) + "\0\0");
    byte[] bytes = new byte[20 + names.Length];
    BitConverter.GetBytes(20).CopyTo(bytes, 0); // DROPFILES.pFiles
    BitConverter.GetBytes(1).CopyTo(bytes, 16); // DROPFILES.fWide
    names.CopyTo(bytes, 20);
    uint effect = RegisterClipboardFormat("Preferred DropEffect");
    if (effect == 0) throw new Exception("CLIPBOARD_ALLOC");
    if (!WritePayload(bytes, 15, expected, BitConverter.GetBytes(1U), effect)) return false;
    string sequence = GetClipboardSequenceNumber().ToString();
    WaitResponsive(Math.Max(0, Math.Min(150, verifyMilliseconds)));
    bool verified;
    try { verified = VerifyFiles(paths, sequence, effect); }
    catch { throw new Exception("CLIPBOARD_WRITE_AMBIGUOUS"); }
    if (!verified) throw new Exception("CLIPBOARD_REPLACED_AFTER_WRITE");
    return true;
  }
  static bool VerifyFiles(string[] paths, string expected, uint effect) {
    Lock();
    try {
      if (GetClipboardSequenceNumber().ToString() != expected || !IsClipboardFormatAvailable(15) || !IsClipboardFormatAvailable(effect)) return false;
      IntPtr drop = GetClipboardData(15);
      if (drop == IntPtr.Zero || DragQueryFile(drop, 0xffffffff, null, 0) != paths.Length || BitConverter.ToUInt32(Bytes(effect, 64), 0) != 1U) return false;
      for (uint index = 0; index < paths.Length; index++) {
        uint size = DragQueryFile(drop, index, null, 0);
        if (size == 0 || size > 2048) return false;
        StringBuilder name = new StringBuilder((int)size + 1); DragQueryFile(drop, index, name, size + 1);
        if (!String.Equals(name.ToString(), paths[index], StringComparison.OrdinalIgnoreCase)) return false;
      }
      return true;
    } finally { CloseClipboard(); }
  }
  public static bool WriteText(string text, string expected) {
    return WritePayload(Encoding.Unicode.GetBytes(text + "\0"), 13, expected, null, 0);
  }
  static IntPtr Allocate(byte[] bytes) {
    IntPtr handle = GlobalAlloc(0x42, (UIntPtr)bytes.Length);
    if (handle == IntPtr.Zero) throw new Exception("CLIPBOARD_ALLOC");
    IntPtr ptr = GlobalLock(handle);
    if (ptr == IntPtr.Zero) { GlobalFree(handle); throw new Exception("CLIPBOARD_ALLOC"); }
    try { Marshal.Copy(bytes, 0, ptr, bytes.Length); } finally { GlobalUnlock(handle); }
    return handle;
  }
  static bool WritePayload(byte[] bytes, uint format, string expected, byte[] extra, uint extraFormat) {
    if (!String.IsNullOrEmpty(expected) && GetClipboardSequenceNumber().ToString() != expected) return false;
    // Allocate every format before clearing; publish once under the same Smart lock.
    IntPtr primary = Allocate(bytes), secondary = IntPtr.Zero;
    bool primaryOwned = true, secondaryOwned = true;
    try {
      if (extra != null) secondary = Allocate(extra);
      Lock();
      try {
        if (!String.IsNullOrEmpty(expected) && GetClipboardSequenceNumber().ToString() != expected) return false;
        if (!EmptyClipboard() || SetClipboardData(format, primary) == IntPtr.Zero) throw new Exception("CLIPBOARD_WRITE_AMBIGUOUS");
        primaryOwned = false;
        if (secondary != IntPtr.Zero) {
          if (SetClipboardData(extraFormat, secondary) == IntPtr.Zero) throw new Exception("CLIPBOARD_WRITE_AMBIGUOUS");
          secondaryOwned = false;
        }
        return true;
      } finally { CloseClipboard(); }
    } finally { if (primaryOwned) GlobalFree(primary); if (secondaryOwned && secondary != IntPtr.Zero) GlobalFree(secondary); }
  }
}
'@
$notificationIcon = $null
while ($null -ne ($line = [ShotClipboard]::NextRequest())) {
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
          'clean-cache' { $counts = [ShotClipboard]::CleanCache([string]$request.directory); $response = @{deleted=$counts[0]; retained=$counts[1]}; break }
          'files' { $response = @{written=[ShotClipboard]::WriteFiles([string[]]$request.paths, $request.expected, [int]$request.verifyMilliseconds)}; break }
          'write' { $response = @{written=[ShotClipboard]::WriteText($request.text, $request.expected); sequence=[ShotClipboard]::GetClipboardSequenceNumber().ToString()}; break }
          default { throw 'INVALID_OPERATION' }
        }
        break
      } catch {
        if ($request.op -in @('write','files','notify','clean-cache') -or $attempt -eq 5 -or $_.Exception.ToString() -notmatch 'CLIPBOARD_BUSY') { throw }
        Start-Sleep -Milliseconds (30 * ($attempt + 1))
      }
    }
    [Console]::WriteLine(($response | ConvertTo-Json -Compress))
  } catch {
    # Whitelisted phase codes only. Never emit clipboard data or exception text.
    $code = 'CLIPBOARD_UNAVAILABLE_OR_OVERSIZED'
    foreach ($safe in @('CLIPBOARD_BUSY','CLIPBOARD_ALLOC','CLIPBOARD_WRITE_AMBIGUOUS','CLIPBOARD_REPLACED_AFTER_WRITE','NATIVE_NOTIFICATION_UNAVAILABLE','UNSAFE_FILE_CACHE','FILE_CACHE_CLEANUP_FAILED')) {
      if ($_.Exception.ToString().Contains($safe)) { $code = $safe; break }
    }
    [Console]::WriteLine((@{error=$code} | ConvertTo-Json -Compress))
  }
}

if ($null -ne $notificationIcon) { $notificationIcon.Dispose() }
