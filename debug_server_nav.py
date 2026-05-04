"""
Test navigation from the server's perspective — mimics what _smart_capture_all_tableau does.
Run this while uvicorn is NOT running (it opens Tableau itself).
"""
import ctypes, time, sys, subprocess
from ctypes import wintypes
from PIL import ImageGrab, Image, ImageChops, ImageStat
import pytesseract, pyautogui

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
TABLEAU_EXE = {"tableau.exe", "tableaupublic.exe"}

def get_exe(hwnd):
    pid = wintypes.DWORD(0)
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if not pid.value: return ""
    h = kernel32.OpenProcess(0x1000, False, pid.value)
    if not h: return ""
    buf = ctypes.create_unicode_buffer(512)
    sz = wintypes.DWORD(512)
    kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(sz))
    kernel32.CloseHandle(h)
    import pathlib
    return pathlib.Path(buf.value).name.lower() if buf.value else ""

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
                    wins.append({"hwnd": int(hwnd), "title": t, "exe": get_exe(hwnd)})
        return True
    user32.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)(cb), 0)
    return wins

def force_topmost(hwnd):
    HWND_TOPMOST = ctypes.c_void_p(-1)
    user32.SetWindowPos(wintypes.HWND(hwnd), HWND_TOPMOST, 0,0,0,0, 0x0003|0x0040)
    current_tid = kernel32.GetCurrentThreadId()
    fg = user32.GetForegroundWindow()
    fg_tid = user32.GetWindowThreadProcessId(fg, None)
    if fg_tid and fg_tid != current_tid:
        user32.AttachThreadInput(current_tid, fg_tid, True)
        user32.SetForegroundWindow(wintypes.HWND(hwnd))
        user32.AttachThreadInput(current_tid, fg_tid, False)
    else:
        user32.SetForegroundWindow(wintypes.HWND(hwnd))
    user32.BringWindowToTop(wintypes.HWND(hwnd))

# Kill existing Tableau instances
subprocess.run(["taskkill", "/F", "/IM", "tableau.exe"], capture_output=True)
time.sleep(1.5)

src = r"C:\Users\benst\Desktop\percy\outreach\tableau\Online Retail Dashboard.twbx"
import os
os.startfile(src)
print("Opened Tableau, waiting for window...")

# Wait for real window (not loading dialog)
hwnd = 0
target_stem = "online retail dashboard"
for _ in range(60):
    for w in get_windows():
        if w["exe"] not in TABLEAU_EXE: continue
        t = w["title"].lower()
        if target_stem not in t: continue
        if t.startswith("opening"): continue
        r = wintypes.RECT()
        user32.GetWindowRect(wintypes.HWND(w["hwnd"]), ctypes.byref(r))
        if r.right - r.left < 100: continue
        hwnd = w["hwnd"]
        print(f"Found window: hwnd={hwnd} title={w['title']!r}")
        break
    if hwnd: break
    time.sleep(1.5)

if not hwnd:
    print("ERROR: No Tableau window found"); sys.exit(1)

user32.ShowWindow(wintypes.HWND(hwnd), 3)
time.sleep(1.5)
force_topmost(hwnd)
time.sleep(1.5)

# Dismiss dialogs
for _ in range(5):
    force_topmost(hwnd)
    time.sleep(0.2)
    pyautogui.press("escape")
    time.sleep(0.3)
time.sleep(1.0)

rect = wintypes.RECT()
user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect))
win_l, win_t, win_r, win_b = rect.left, rect.top, rect.right, rect.bottom
print(f"Window bounds: {win_l},{win_t} -> {win_r},{win_b}")

sidebar_w, toolbar_h, tab_strip_h = 330, 120, 50
content_bbox = (win_l+sidebar_w, win_t+toolbar_h, win_r, win_b-tab_strip_h)
canvas_cx = win_l + sidebar_w + (win_r - win_l - sidebar_w)//2
canvas_cy = win_t + toolbar_h + (win_b - win_t - toolbar_h - tab_strip_h)//2
print(f"Content bbox: {content_bbox}")
print(f"Canvas center: ({canvas_cx}, {canvas_cy})")

# Grab and save tab strip to see what we actually get
tab_strip_img = ImageGrab.grab(bbox=(win_l, win_b-60, win_r, win_b))
tab_strip_img.save(r"C:\Users\benst\Desktop\srv_tab_strip.png")
content_img = ImageGrab.grab(bbox=content_bbox)
content_img.save(r"C:\Users\benst\Desktop\srv_content_before.png")
print("Saved srv_tab_strip.png and srv_content_before.png")

# OCR the tab strip
big = tab_strip_img.resize((tab_strip_img.width*2, tab_strip_img.height*2), Image.LANCZOS)
data = pytesseract.image_to_data(big, output_type=pytesseract.Output.DICT)
texts = [t.strip() for t in data["text"] if t and t.strip()]
print(f"OCR tab strip tokens: {texts}")

# Test navigation: single canvas click then multiple PgUp
print("\n--- Testing homing with single canvas click then 35x PgUp ---")
force_topmost(hwnd)
time.sleep(0.2)
pyautogui.click(canvas_cx, canvas_cy)
time.sleep(0.4)
for j in range(35):
    pyautogui.hotkey("ctrl", "pageup")
    time.sleep(0.12)
time.sleep(0.5)

img_after_home = ImageGrab.grab(bbox=content_bbox)
img_after_home.save(r"C:\Users\benst\Desktop\srv_after_home.png")
diff_home = ImageChops.difference(content_img.convert("L"), img_after_home.convert("L"))
rms_home = ImageStat.Stat(diff_home).rms[0]
print(f"RMS diff after 35x PgUp: {rms_home:.2f} (>1.0 = navigation happened)")

# Test 5 PgDn presses and capture each
print("\n--- Testing 5x PgDn ---")
prev = img_after_home
for j in range(5):
    pyautogui.hotkey("ctrl", "pagedown")
    time.sleep(0.4)
    curr = ImageGrab.grab(bbox=content_bbox)
    curr.save(fr"C:\Users\benst\Desktop\srv_pgdn_{j+1}.png")
    diff = ImageChops.difference(prev.convert("L"), curr.convert("L"))
    rms = ImageStat.Stat(diff).rms[0]
    print(f"  PgDn press {j+1}: RMS vs prev = {rms:.2f}")
    prev = curr

# Check tab strip after navigation
tab_after = ImageGrab.grab(bbox=(win_l, win_b-60, win_r, win_b))
tab_after.save(r"C:\Users\benst\Desktop\srv_tab_after.png")
big2 = tab_after.resize((tab_after.width*2, tab_after.height*2), Image.LANCZOS)
data2 = pytesseract.image_to_data(big2, output_type=pytesseract.Output.DICT)
texts2 = [t.strip() for t in data2["text"] if t and t.strip()]
print(f"\nOCR tab strip after navigation: {texts2}")

print("\nDone. Check srv_*.png files on Desktop.")
