$ErrorActionPreference = 'Stop'
# Creates or updates the desktop shortcut for the portable TubeStudio.
#   Create: environment variable TS_PROGRAM_DIR = the unpacked program folder.
#   Read:   environment variable TS_LNK_READ = path of a .lnk; prints its fields as ASCII-only JSON.
# Uses the Unicode shell API (IShellLinkW): WScript.Shell shortcuts turn non-ANSI characters
# (for example a Cyrillic folder name on an English Windows) into question marks.
if (-not ('TubeStudioShortcut.Lnk' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
namespace TubeStudioShortcut {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  public class CShellLink { }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
  public interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cch, IntPtr pfd, uint fFlags);
    void GetIDList(out IntPtr ppidl);
    void SetIDList(IntPtr pidl);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cch);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cch);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cch);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
    void GetHotkey(out ushort pwHotkey);
    void SetHotkey(ushort wHotkey);
    void GetShowCmd(out int piShowCmd);
    void SetShowCmd(int iShowCmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cch, out int piIcon);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
    void Resolve(IntPtr hwnd, uint fFlags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
  }
  public static class Lnk {
    public static void Write(string file, string target, string args, string wd, string icon, string desc, int show) {
      IShellLinkW link = (IShellLinkW)new CShellLink();
      try {
        link.SetPath(target);
        link.SetArguments(args);
        link.SetWorkingDirectory(wd);
        link.SetIconLocation(icon, 0);
        link.SetDescription(desc);
        link.SetShowCmd(show);
        ((IPersistFile)link).Save(file, true);
      } finally { Marshal.ReleaseComObject(link); }
    }
    public static string[] Read(string file) {
      IShellLinkW link = (IShellLinkW)new CShellLink();
      try {
        ((IPersistFile)link).Load(file, 0);
        StringBuilder t = new StringBuilder(4096), a = new StringBuilder(4096), w = new StringBuilder(4096), i = new StringBuilder(4096);
        int idx, show;
        link.GetPath(t, t.Capacity, IntPtr.Zero, 4);
        link.GetArguments(a, a.Capacity);
        link.GetWorkingDirectory(w, w.Capacity);
        link.GetIconLocation(i, i.Capacity, out idx);
        link.GetShowCmd(out show);
        return new string[] { t.ToString(), a.ToString(), w.ToString(), i.ToString() + "," + idx, show.ToString() };
      } finally { Marshal.ReleaseComObject(link); }
    }
  }
}
'@
}
function Read-Link([string]$file) {
  $r = [TubeStudioShortcut.Lnk]::Read($file)
  return [ordered]@{ target = $r[0]; args = $r[1]; wd = $r[2]; icon = $r[3]; show = [int]$r[4] }
}
function Write-AsciiJson($value) {
  $json = $value | ConvertTo-Json -Compress
  # Non-ASCII as \uXXXX: the output survives any console code page.
  [regex]::Replace($json, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
}

if ($env:TS_LNK_READ) {
  if (-not (Test-Path -LiteralPath $env:TS_LNK_READ -PathType Leaf)) { throw 'Shortcut not found' }
  Write-AsciiJson (Read-Link $env:TS_LNK_READ)
  exit 0
}

$program = $env:TS_PROGRAM_DIR
if (-not $program -or -not (Test-Path -LiteralPath $program -PathType Container)) { throw 'TS_PROGRAM_DIR is not a folder' }
$candidates = @([Environment]::GetFolderPath('DesktopDirectory'))
try { $candidates += [string](New-Object -ComObject WScript.Shell).SpecialFolders.Item('Desktop') } catch { }
$desktop = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -First 1
if (-not $desktop) { throw 'Desktop folder not found' }
$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$script = Join-Path $program 'app\windows\start-hidden.ps1'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'start-hidden.ps1 not found' }
$icon = Join-Path $program 'app\windows\tubestudio.ico'
$lnk = Join-Path $desktop 'TubeStudio.lnk'
$arguments = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '"'
# 7 = start minimized without focus: the PowerShell window does not flash before it hides itself.
[TubeStudioShortcut.Lnk]::Write($lnk, $ps, $arguments, $program, $icon, 'TubeStudio', 7)
$check = Read-Link $lnk
if ($check.args -cne $arguments -or $check.target -ine $ps -or $check.wd -cne $program -or $check.icon -cne ($icon + ',0')) {
  throw ('Shortcut verification failed: ' + (Write-AsciiJson $check))
}
Write-AsciiJson ([ordered]@{ lnk = $lnk; program = $program })
