# foreground-watch.ps1 — prints the foreground window's process name on every
# change (one per line). Electron reads this to show overlays only while Forza
# is the active window (hide on alt-tab). Runs hidden; exits when its stdout closes.
param([int]$ParentPid = 0)   # Electron PID — exit if it dies (covers Task-Manager/SIGKILL where stdout never closes)
$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$lastHwnd = [IntPtr]::Zero
$last = [string]::Empty
while ($true) {
  if ($ParentPid -ne 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit }   # parent gone → don't orphan
  $h = [Fg]::GetForegroundWindow()
  if ($h -ne $lastHwnd) {                 # only resolve the process when the window actually changes
    $lastHwnd = $h
    $procId = [uint32]0
    [void][Fg]::GetWindowThreadProcessId($h, [ref]$procId)   # $procId, not $pid (reserved)
    $name = ''
    if ($procId -ne 0) {
      $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($p) { $name = $p.ProcessName }
    }
    if ($name -ne $last) {
      $last = $name
      try { [Console]::Out.WriteLine($name); [Console]::Out.Flush() } catch { exit }
    }
  }
  Start-Sleep -Milliseconds 100           # snappy alt-tab detection; the 100ms loop is near-free
}
