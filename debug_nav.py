"""Test: click canvas center first, then Ctrl+PgDn/PgUp."""
import ctypes, time
from ctypes import wintypes
from PIL import ImageGrab
import pyautogui

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
TABLEAU_EXE = {'tableau.exe', 'tableaupublic.exe'}

def get_exe(hwnd):
    pid = wintypes.DWORD(0)
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if not pid.value: return ''
    h = kernel32.OpenProcess(0x1000, False, pid.value)
    if not h: return ''
    buf = ctypes.create_unicode_buffer(512)
    sz = wintypes.DWORD(512)
    kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(sz))
    kernel32.CloseHandle(h)
    import pathlib
    return pathlib.Path(buf.value).name.lower() if buf.value else ''

def get_windows():
    wins = []
    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            l = user32.GetWindowTextLengthW(hwnd)
            if l > 0:
                b = ctypes.create_unicode_buffer(l+1)
                user32.GetWindowTextW(hwnd, b, l+1)
                t = b.value.strip()
                if t:
                    wins.append({'hwnd': int(hwnd), 'title': t, 'exe': get_exe(hwnd)})
        return True
    user32.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)(cb), 0)
    return wins

def force_topmost(hwnd):
    HWND_TOPMOST = ctypes.c_void_p(-1)
    user32.SetWindowPos(wintypes.HWND(hwnd), HWND_TOPMOST, 0, 0, 0, 0, 0x0003|0x0040)
    current_tid = kernel32.GetCurrentThreadId()
    fg_hwnd = user32.GetForegroundWindow()
    fg_tid = user32.GetWindowThreadProcessId(fg_hwnd, None)
    if fg_tid and fg_tid != current_tid:
        user32.AttachThreadInput(current_tid, fg_tid, True)
        user32.SetForegroundWindow(wintypes.HWND(hwnd))
        user32.AttachThreadInput(current_tid, fg_tid, False)
    else:
        user32.SetForegroundWindow(wintypes.HWND(hwnd))
    user32.BringWindowToTop(wintypes.HWND(hwnd))

tableau_wins = [w for w in get_windows() if w['exe'] in TABLEAU_EXE]
target = next((w for w in tableau_wins if 'online retail' in w['title'].lower()), None)
if not target:
    print("No Tableau window found"); exit(1)

hwnd = target['hwnd']
print(f"hwnd={hwnd}")

user32.ShowWindow(wintypes.HWND(hwnd), 3)
time.sleep(0.5)
force_topmost(hwnd)
time.sleep(0.5)

rect = wintypes.RECT()
user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect))
win_l, win_t, win_r, win_b = rect.left, rect.top, rect.right, rect.bottom
print(f"Bounds: {win_l},{win_t} -> {win_r},{win_b}")

# Canvas center (skip left panel ~330px, top toolbar ~120px, right panel ~250px, bottom tab ~50px)
cx = win_l + 330 + (win_r - win_l - 330 - 250) // 2
cy = win_t + 120 + (win_b - win_t - 120 - 50) // 2
print(f"Canvas click target: ({cx}, {cy})")

# Click canvas to give Tableau keyboard focus
force_topmost(hwnd)
time.sleep(0.3)
pyautogui.click(cx, cy)
time.sleep(0.5)

# Screenshot before
img_before = ImageGrab.grab(bbox=(win_l, win_b-50, win_r, win_b))
img_before.save(r'C:\Users\benst\Desktop\tabs_before.png')
print("Saved tabs_before.png")

print("Sending Ctrl+PgDn...")
force_topmost(hwnd)
time.sleep(0.2)
pyautogui.hotkey('ctrl', 'pagedown')
time.sleep(0.8)

img_after = ImageGrab.grab(bbox=(win_l, win_b-50, win_r, win_b))
img_after.save(r'C:\Users\benst\Desktop\tabs_after_pgdn.png')
print("Saved tabs_after_pgdn.png")

# Compare
from PIL import ImageChops, ImageStat
diff = ImageChops.difference(img_before.convert('L'), img_after.convert('L'))
rms = ImageStat.Stat(diff).rms[0]
print(f"RMS diff after Ctrl+PgDn: {rms:.2f}  (>1.0 = navigation worked)")

# Now try Ctrl+PgUp
print("\nSending Ctrl+PgUp x5...")
for i in range(5):
    force_topmost(hwnd)
    time.sleep(0.1)
    pyautogui.click(cx, cy)
    time.sleep(0.1)
    pyautogui.hotkey('ctrl', 'pageup')
    time.sleep(0.4)
    img = ImageGrab.grab(bbox=(win_l, win_b-50, win_r, win_b))
    img.save(fr'C:\Users\benst\Desktop\tabs_pgup_{i+1}.png')
    diff = ImageChops.difference(img_before.convert('L'), img.convert('L'))
    rms2 = ImageStat.Stat(diff).rms[0]
    print(f"  Press {i+1}: tab strip rms vs original = {rms2:.2f}")
    img_before = img

print("Done - check C:/Users/benst/Desktop/tabs_*.png")
