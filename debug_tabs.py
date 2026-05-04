import ctypes, time, sys
from ctypes import wintypes
from PIL import ImageGrab, Image
import pytesseract, pyautogui

pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

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

def get_title(hwnd):
    l = user32.GetWindowTextLengthW(wintypes.HWND(hwnd))
    if l <= 0: return ''
    b = ctypes.create_unicode_buffer(l+1)
    user32.GetWindowTextW(wintypes.HWND(hwnd), b, l+1)
    return b.value

def force_topmost(hwnd):
    HWND_TOPMOST = ctypes.c_void_p(-1)
    SWP_FLAGS = 0x0003 | 0x0040
    user32.SetWindowPos(wintypes.HWND(hwnd), HWND_TOPMOST, 0, 0, 0, 0, SWP_FLAGS)
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

# Find the right Tableau window
tableau_wins = [w for w in get_windows() if w['exe'] in TABLEAU_EXE]
print(f"Found {len(tableau_wins)} Tableau windows:")
for w in tableau_wins:
    print(f"  hwnd={w['hwnd']} title={w['title']!r}")

target = next((w for w in tableau_wins if 'online retail' in w['title'].lower()), None)
if not target:
    print("No Online Retail window found")
    sys.exit(1)

hwnd = target['hwnd']
print(f"\nUsing hwnd={hwnd}")

# Force topmost and maximize
user32.ShowWindow(wintypes.HWND(hwnd), 3)
time.sleep(0.5)
force_topmost(hwnd)
time.sleep(1.0)

# Verify foreground
fg = user32.GetForegroundWindow()
print(f"Foreground hwnd={fg}, our hwnd={hwnd}, match={fg==hwnd}")

# Get window bounds
rect = wintypes.RECT()
user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect))
win_l, win_t, win_r, win_b = rect.left, rect.top, rect.right, rect.bottom
print(f"Window: {win_l},{win_t} -> {win_r},{win_b}  ({win_r-win_l}x{win_b-win_t})")

# Save full window screenshot
full_img = ImageGrab.grab(bbox=(win_l, win_t, win_r, win_b))
full_img.save(r'C:\Users\benst\Desktop\tableau_full.png')
print("Saved full window screenshot")

# Save tab strip
for strip_h in [40, 60, 80]:
    tab_img = ImageGrab.grab(bbox=(win_l, win_b - strip_h, win_r, win_b))
    tab_img.save(f'C:\\Users\\benst\\Desktop\\tab_strip_{strip_h}px.png')
print("Saved tab strip screenshots (40, 60, 80px)")

# Run OCR on 60px strip
tab_img = ImageGrab.grab(bbox=(win_l, win_b - 60, win_r, win_b))
big = tab_img.resize((tab_img.width*2, tab_img.height*2), Image.LANCZOS)
data = pytesseract.image_to_data(big, output_type=pytesseract.Output.DICT)
texts = [t.strip() for t in data['text'] if t and t.strip()]
print(f"OCR tokens ({len(texts)} found): {texts}")

# Test keyboard navigation: record title before and after
title_before = get_title(hwnd)
print(f"\nTitle BEFORE Ctrl+PgDn: {title_before!r}")

# Try pyautogui hotkey
force_topmost(hwnd)
time.sleep(0.3)
pyautogui.hotkey('ctrl', 'pagedown')
time.sleep(0.8)

title_after = get_title(hwnd)
print(f"Title AFTER  Ctrl+PgDn (pyautogui): {title_after!r}")
print(f"Navigation worked: {title_before != title_after}")

# Try again with another method
force_topmost(hwnd)
time.sleep(0.3)
pyautogui.hotkey('ctrl', 'pagedown')
time.sleep(0.8)
title_after2 = get_title(hwnd)
print(f"Title AFTER  Ctrl+PgDn (2nd press): {title_after2!r}")
