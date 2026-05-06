"""Force-delete the recursive cdk.out.tmp3 directory on Windows.

Walks down the symlink/junction chain to find the actual leaf, deletes contents,
then recursively unwinds. Uses ctypes to call DeleteFileW / RemoveDirectoryW
with the \\?\ long-path prefix so MAX_PATH (260) doesn't apply.
"""
import os
import sys
import ctypes
from ctypes import wintypes

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.RemoveDirectoryW.argtypes = [wintypes.LPCWSTR]
kernel32.RemoveDirectoryW.restype = wintypes.BOOL
kernel32.DeleteFileW.argtypes = [wintypes.LPCWSTR]
kernel32.DeleteFileW.restype = wintypes.BOOL
kernel32.GetFileAttributesW.argtypes = [wintypes.LPCWSTR]
kernel32.GetFileAttributesW.restype = wintypes.DWORD

INVALID_FILE_ATTRIBUTES = 0xFFFFFFFF
FILE_ATTRIBUTE_DIRECTORY = 0x10
FILE_ATTRIBUTE_REPARSE_POINT = 0x400
FILE_ATTRIBUTE_READONLY = 0x1

def lp(p):
    p = os.path.abspath(p)
    if not p.startswith("\\\\?\\"):
        p = "\\\\?\\" + p
    return p

def attrs(p):
    return kernel32.GetFileAttributesW(lp(p))

def is_dir(p):
    a = attrs(p)
    return a != INVALID_FILE_ATTRIBUTES and (a & FILE_ATTRIBUTE_DIRECTORY)

def is_reparse(p):
    a = attrs(p)
    return a != INVALID_FILE_ATTRIBUTES and (a & FILE_ATTRIBUTE_REPARSE_POINT)

def listdir_long(p):
    # Use FindFirstFileW / FindNextFileW for long paths
    import glob
    # os.scandir works with \\?\ on modern Windows
    try:
        return [e.name for e in os.scandir(lp(p))]
    except Exception as e:
        return []

def delete_file(p):
    if not kernel32.DeleteFileW(lp(p)):
        # Try clearing read-only
        try:
            ctypes.windll.kernel32.SetFileAttributesW(lp(p), 0x80)  # NORMAL
            kernel32.DeleteFileW(lp(p))
        except Exception:
            pass

def remove_dir(p):
    return bool(kernel32.RemoveDirectoryW(lp(p)))

def nuke(root):
    # Iteratively descend to the deepest dir, then walk back up deleting
    stack = [root]
    visited = set()
    max_depth = 0
    # Build the chain by descending
    cur = root
    chain = [cur]
    for _ in range(50000):
        if not is_dir(cur):
            break
        # If reparse point, just remove it without recursing in
        if is_reparse(cur):
            break
        kids = listdir_long(cur)
        sub = None
        for k in kids:
            full = os.path.join(cur, k)
            if is_dir(full) and not is_reparse(full):
                sub = full
                break
        if sub is None:
            break
        cur = sub
        chain.append(cur)
        max_depth = len(chain)
    print(f"chain depth: {max_depth}")
    print(f"deepest len: {len(cur)}")
    # Now unwind: at each level, delete files then the directory
    for d in reversed(chain):
        try:
            kids = listdir_long(d)
            for k in kids:
                full = os.path.join(d, k)
                if is_dir(full) and not is_reparse(full):
                    # leftover dir at this level — recurse
                    nuke(full)
                else:
                    delete_file(full)
            ok = remove_dir(d)
            if not ok:
                err = ctypes.get_last_error()
                print(f"failed to remove {d[-100:]}: err {err}")
        except Exception as e:
            print(f"err at {d[-100:]}: {e}")

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\benst\Desktop\percy\infra\cdk.out.tmp3"
    if not os.path.exists(target):
        print("target does not exist")
        sys.exit(0)
    nuke(target)
    if os.path.exists(target):
        # Try one more top-level remove
        if remove_dir(target):
            print("removed at top level after nuke")
        else:
            print(f"STILL EXISTS: err={ctypes.get_last_error()}")
            sys.exit(1)
    print("GONE")
