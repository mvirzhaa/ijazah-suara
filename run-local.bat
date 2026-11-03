@echo off
echo ==========================================================
echo   Menjalankan Ijazah Bersuara secara Lokal (Docker)
echo ==========================================================

if not exist .env (
    echo [INFO] Membuat file .env dari .env.example...
    copy .env.example .env
    echo [PERHATIAN] File .env telah dibuat. Silakan periksa kembali jika ingin menyesuaikan pengaturan.
)

echo [INFO] Menyalakan Docker Compose...
docker compose up -d --build

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [GALAT] Gagal menjalankan Docker Compose.
    echo Pastikan Docker Desktop sudah aktif (Running) di komputer Anda.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [BERHASIL] Aplikasi berjalan!
echo Buka di browser: http://localhost:3000
echo Untuk melihat log: docker compose logs -f
echo Untuk mematikan: docker compose down
echo.
pause

