Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class RhineWindowProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x,y; }
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(IntPtr c,string t);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint f);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$lyricHandle=[RhineWindowProbe]::FindWindow([IntPtr]::Zero,'RhineMusic Lyrics')
$mainHandle=[RhineWindowProbe]::FindWindow([IntPtr]::Zero,'Rhine Music')
$rect=New-Object RhineWindowProbe+RECT
[void][RhineWindowProbe]::GetWindowRect($lyricHandle,[ref]$rect)
$point=New-Object RhineWindowProbe+POINT
$point.x=$rect.left+24
$point.y=[int](($rect.top+$rect.bottom)/2)
$rootAtPoint=[RhineWindowProbe]::GetAncestor([RhineWindowProbe]::WindowFromPoint($point),2)
@{mainNotForeground=[RhineWindowProbe]::GetForegroundWindow() -ne $mainHandle;lyricsFound=$lyricHandle -ne [IntPtr]::Zero;lyricsUnoccluded=$rootAtPoint -eq $lyricHandle;lyricsNotForeground=[RhineWindowProbe]::GetForegroundWindow() -ne $lyricHandle;rect=@{x=$rect.left;y=$rect.top;width=$rect.right-$rect.left;height=$rect.bottom-$rect.top}} | ConvertTo-Json -Compress
