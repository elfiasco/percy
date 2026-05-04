# Percy dev startup — kills old servers and starts backend + frontend cleanly
param([switch]$BackendOnly, [switch]$FrontendOnly)

$BackendPort  = 8000
$FrontendPort = 5173

Write-Host ""
Write-Host "Percy Dev Startup" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan

# Kill ALL python processes (uvicorn instances) and node (vite)
if (-not $FrontendOnly) {
    $pythons = Get-Process -Name python -ErrorAction SilentlyContinue
    if ($pythons) {
        $pythons | Stop-Process -Force
        Write-Host "  Killed $($pythons.Count) Python process(es)" -ForegroundColor Yellow
    }
}
if (-not $BackendOnly) {
    $nodes = Get-Process -Name node -ErrorAction SilentlyContinue
    if ($nodes) {
        $nodes | Stop-Process -Force
        Write-Host "  Killed $($nodes.Count) Node process(es)" -ForegroundColor Yellow
    }
}
Start-Sleep 2

$root     = $PSScriptRoot
$frontend = Join-Path $root "frontend"

if (-not $FrontendOnly) {
    Write-Host "  Starting backend on http://localhost:$BackendPort ..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command",
        "cd '$root'; python -m uvicorn app.backend.main:app --reload --port $BackendPort --log-level info; Read-Host 'Press Enter to exit'"
    Start-Sleep 3
}

if (-not $BackendOnly) {
    Write-Host "  Starting frontend on http://localhost:$FrontendPort ..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command",
        "cd '$frontend'; npm run dev -- --port $FrontendPort; Read-Host 'Press Enter to exit'"
}

Write-Host ""
Write-Host "Backend:  http://localhost:$BackendPort" -ForegroundColor Cyan
Write-Host "Frontend: http://localhost:$FrontendPort" -ForegroundColor Cyan
Write-Host ""
Write-Host "Both servers are starting in their own windows." -ForegroundColor Gray
Write-Host "Close those windows (or Ctrl+C inside them) to stop." -ForegroundColor Gray
Write-Host "Run './start.ps1 -BackendOnly' or './start.ps1 -FrontendOnly' to start just one." -ForegroundColor Gray
