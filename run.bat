@echo off
chcp 65001 >nul
title VietDub AI - Unified Launcher
echo ====================================================================
echo   🚀 ĐANG KHỞI CHẠY VIETDUB AI (PORT 8000 + PORT 3000)
echo ====================================================================
echo.
echo [1/2] Đang bật Python Local Engine (FFmpeg + VieNeu) cổng 8000...
start "VietDub Local Engine (Port 8000)" cmd /k "python local_backend.py"

echo [2/2] Đang bật Web GUI cổng 3000...
start "VietDub Web GUI (Port 3000)" cmd /k "npm run dev"

echo.
echo Đang mở trình duyệt web...
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo Hoàn tất! Bạn có thể sử dụng giao diện trên trình duyệt web.
