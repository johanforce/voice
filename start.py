"""
VietDub AI - Bộ khởi động hợp nhất (Unified Launcher)
Khởi chạy đồng thời cả Python Local Engine (cổng 8000) và Web GUI (cổng 3000)
Chỉ bằng 1 lệnh duy nhất:
    python start.py
"""

import os
import sys
import time
import shutil
import subprocess
import webbrowser
import threading

def run_backend():
    """Chạy Python Local Engine (xử lý FFmpeg, VieNeu, Whisper) trên cổng 8000"""
    print("[1/2] 🚀 Đang khởi chạy Python Local Backend Engine (Port 8000)...")
    subprocess.run([sys.executable, "local_backend.py"])

def run_frontend():
    """Chạy Web GUI (Vite/Node server) trên cổng 3000"""
    print("[2/2] 🌐 Đang khởi chạy Web GUI (Port 3000)...")
    
    # Kiểm tra lệnh npm / npx
    npm_cmd = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm_cmd:
        print("[!] Không tìm thấy lệnh npm. Bạn có thể mở giao diện trên cloud:")
        print("    👉 https://ais-dev-z76su2hf3oez255j4znbqy-339852008380.asia-southeast1.run.app")
        return

    # Chạy npm run dev
    try:
        subprocess.run([npm_cmd, "run", "dev"], check=True)
    except Exception as e:
        print(f"[!] Lỗi khi chạy npm: {e}")

def main():
    print("=" * 65)
    print("  🚀 VIETDUB AI - BỘ KHỞI ĐỘNG HỢP NHẤT (PORT 8000 + PORT 3000)")
    print("  Điều khiển trực tiếp FFmpeg & VieNeu Neural TTS Local")
    print("=" * 65)

    # 1. Khởi chạy luồng Backend (Cổng 8000)
    backend_thread = threading.Thread(target=run_backend, daemon=True)
    backend_thread.start()

    # Chờ 1.5 giây để backend cổng 8000 sẵn sàng
    time.sleep(1.5)

    # 2. Mở trình duyệt web tự động
    def open_browser():
        time.sleep(2.5)
        print("\n✨ Đang tự động mở giao diện Web trên trình duyệt...")
        webbrowser.open("http://localhost:3000")

    browser_thread = threading.Thread(target=open_browser, daemon=True)
    browser_thread.start()

    # 3. Chạy Frontend trên luồng chính (Cổng 3000)
    run_frontend()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[+] Đã dừng tất cả các dịch vụ. Tạm biệt!")
