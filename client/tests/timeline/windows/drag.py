"""向明确独立验收窗口发送Windows鼠标拖动，结果仍由原生脚本读取Rust偏好确认。"""

import argparse
import ctypes
import json
import os
from pathlib import Path
import subprocess
import time


class Point(ctypes.Structure):
    """Windows物理屏幕坐标。"""

    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class Rect(ctypes.Structure):
    """当前目标窗口客户区范围。"""

    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long), ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


class MouseInput(ctypes.Structure):
    """SendInput鼠标数据，使用原生指针宽度保存附加信息。"""

    _fields_ = [("dx", ctypes.c_long), ("dy", ctypes.c_long), ("data", ctypes.c_ulong), ("flags", ctypes.c_ulong), ("time", ctypes.c_ulong), ("extra", ctypes.c_size_t)]


class Input(ctypes.Structure):
    """本驱动仅发送鼠标INPUT，布局与Win32的鼠标联合成员一致。"""

    _fields_ = [("type", ctypes.c_ulong), ("mouse", MouseInput)]


def send_drag(ready: Path, activate=False):
    """只操作同目录独立EXE的指定PID，不向被遮挡的其他应用发送输入。"""
    info = json.loads(ready.read_text(encoding="utf-8"))
    expected = (ready.parent / "app/wow-recorder-client.exe").resolve()
    assert b"com.wow.recorder.cloudvalidation20261017" in expected.read_bytes()
    kernel, windows = ctypes.windll.kernel32, ctypes.windll.user32
    kernel.OpenProcess.restype = ctypes.c_void_p
    handle = kernel.OpenProcess(0x1000, False, info["nativePid"])
    assert handle, "独立验收进程已退出"
    try:
        path, size = ctypes.create_unicode_buffer(32768), ctypes.c_ulong(32768)
        assert kernel.QueryFullProcessImageNameW(ctypes.c_void_p(handle), 0, path, ctypes.byref(size))
        assert Path(path.value).resolve() == expected, "拒绝操作其他应用进程"
    finally:
        kernel.CloseHandle(ctypes.c_void_p(handle))
    windows.SetProcessDPIAware()
    matches = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def visit(hwnd, _):
        """仅读取已确认进程的验收窗口，不读取其他应用内容。"""
        pid = ctypes.c_ulong()
        windows.GetWindowThreadProcessId(ctypes.c_void_p(hwnd), ctypes.byref(pid))
        if pid.value == info["nativePid"]:
            title = ctypes.create_unicode_buffer(256)
            windows.GetWindowTextW(ctypes.c_void_p(hwnd), title, 256)
            if title.value == "Replay Validation":
                matches.append(hwnd)
        return True

    windows.EnumWindows(visit, 0)
    assert len(matches) == 1, "找不到唯一独立验收窗口"
    hwnd = ctypes.c_void_p(matches[0])
    windows.ShowWindow(hwnd, 5)
    # 仅把本次独立窗口临时置前；坐标保护不允许输入落在遮挡它的其他应用上。
    windows.SetWindowPos(hwnd, ctypes.c_void_p(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
    windows.SetForegroundWindow(hwnd)
    time.sleep(0.2)
    if activate:
        print(json.dumps({"nativePid": info["nativePid"], "windowShown": True}))
        return
    rect, origin = Rect(), Point(0, 0)
    windows.GetClientRect(hwnd, ctypes.byref(rect))
    windows.ClientToScreen(hwnd, ctypes.byref(origin))
    scale_x, scale_y = rect.right / info["viewport"]["width"], rect.bottom / info["viewport"]["height"]

    def center(box):
        """将刚读取的网页客户区坐标换算为物理屏幕坐标。"""
        return (int(origin.x + (box["x"] + box["width"] / 2) * scale_x), int(origin.y + (box["y"] + box["height"] / 2) * scale_y))

    projection = {"from": center(info["source"]), "to": center(info["target"])}
    # 使用原生可访问性元素的物理矩形，避免WebView2原生拖放与网页坐标缩放不一致。
    script = r"""
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
$request = Get-Content -LiteralPath $env:WOW_NATIVE_DRAG_REQUEST -Raw -Encoding UTF8 | ConvertFrom-Json
$root = [System.Windows.Automation.AutomationElement]::FromHandle([intptr]::new([long]$env:WOW_NATIVE_DRAG_WINDOW))
$observed = @()
foreach ($item in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    $current = $item.Current
    if ($current.Name -like '*标准*' -or $current.Name -like '*跳转*' -or $current.Name -eq '回放') {
        $r = $current.BoundingRectangle
        $observed += @{name=$current.Name; offscreen=$current.IsOffscreen; x=$r.X; y=$r.Y; width=$r.Width; height=$r.Height}
    }
}
[IO.File]::WriteAllText((Join-Path (Split-Path $env:WOW_NATIVE_DRAG_REQUEST) 'windows-accessibility.json'), ($observed | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
$frames = @{}
foreach ($pair in @(@('source', $request.sourceLabel), @('target', $request.targetLabel))) {
    $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, [string]$pair[1])
    $element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -eq $element -or $element.Current.IsOffscreen) { throw ('Unavailable ' + $pair[0]) }
    $rect = $element.Current.BoundingRectangle
    $frames[$pair[0]] = @{x=$rect.X; y=$rect.Y; width=$rect.Width; height=$rect.Height}
}
$frames | ConvertTo-Json -Compress
"""
    environment = {**os.environ, "WOW_NATIVE_DRAG_REQUEST": str(ready), "WOW_NATIVE_DRAG_WINDOW": str(matches[0])}
    query = subprocess.run(["powershell", "-NoProfile", "-Command", script], env=environment, capture_output=True, encoding="utf-8", timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
    assert query.returncode == 0, query.stderr
    frames = json.loads(query.stdout)

    def physical_center(frame):
        """可访问性矩形已经是物理屏幕坐标，不再次应用DPI变换。"""
        assert frame["width"] > 0 and frame["height"] > 0
        return int(frame["x"] + frame["width"] / 2), int(frame["y"] + frame["height"] / 2)

    start, end = physical_center(frames["source"]), physical_center(frames["target"])
    windows.WindowFromPoint.argtypes, windows.WindowFromPoint.restype = [Point], ctypes.c_void_p
    windows.GetAncestor.argtypes, windows.GetAncestor.restype = [ctypes.c_void_p, ctypes.c_uint], ctypes.c_void_p
    hit_tests = []
    for label, point in [("source", start), ("target", end)]:
        hit = windows.GetAncestor(windows.WindowFromPoint(Point(*point)), 2)
        pid = ctypes.c_ulong()
        windows.GetWindowThreadProcessId(ctypes.c_void_p(hit), ctypes.byref(pid))
        hit_tests.append({"point": label, "coordinates": point, "rootWindow": hit, "rootPid": pid.value, "expectedWindow": matches[0]})
    (ready.parent / "windows-hit-test.json").write_text(json.dumps(hit_tests, indent=2), encoding="utf-8")
    assert all(item["rootWindow"] == matches[0] for item in hit_tests), "验收窗口被其他应用遮挡，未发送输入"
    windows.SendInput.argtypes = [ctypes.c_uint, ctypes.POINTER(Input), ctypes.c_int]
    desktop = [windows.GetSystemMetrics(index) for index in (76, 77, 78, 79)]

    def send(flags, x=0, y=0):
        """统一通过真实OS输入队列发送动作，避免仅改光标位置而保留旧鼠标事件坐标。"""
        packet = Input(0, MouseInput(x, y, 0, flags, 0, 0))
        assert windows.SendInput(1, ctypes.byref(packet), ctypes.sizeof(Input)) == 1

    def move(x, y):
        """绝对坐标覆盖整个虚拟桌面，不受鼠标速度及加速设置影响。"""
        send(0x0001 | 0x2000 | 0x4000 | 0x8000, round((x - desktop[0]) * 65535 / (desktop[2] - 1)), round((y - desktop[1]) * 65535 / (desktop[3] - 1)))

    move(*start)
    move(*start)
    before_window = Rect()
    windows.GetWindowRect(hwnd, ctypes.byref(before_window))
    send(2)
    try:
        for index in range(1, 31):
            move(int(start[0] + (end[0] - start[0]) * index / 30), int(start[1] + (end[1] - start[1]) * index / 30))
            time.sleep(0.015)
        # WebView2的原生OLE拖放需在目标上完成进入／悬停处理，再释放鼠标。
        move(end[0] - 2, end[1])
        time.sleep(0.15)
        move(*end)
        time.sleep(0.2)
    finally:
        send(4)
        windows.SetWindowPos(hwnd, ctypes.c_void_p(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
    actual = Point()
    windows.GetCursorPos(ctypes.byref(actual))
    after_window = Rect()
    windows.GetWindowRect(hwnd, ctypes.byref(after_window))
    result = {"nativePid": info["nativePid"], "from": start, "to": end, "actualEnd": [actual.x, actual.y], "windowBefore": [before_window.left, before_window.top, before_window.right, before_window.bottom],
        "windowAfter": [after_window.left, after_window.top, after_window.right, after_window.bottom], "coordinateSource": "Windows UI Automation", "webProjection": projection, "inputSent": True}
    (ready.parent / "windows-mouse-drag.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ready", type=Path, required=True)
    parser.add_argument("--activate", action="store_true")
    args = parser.parse_args()
    send_drag(args.ready.resolve(), args.activate)
