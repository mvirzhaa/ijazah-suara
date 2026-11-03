#!/usr/bin/env bash
# ==============================================================================
# Script Otomasi Deployment Ijazah Bersuara ke Server
# Target URL: https://vr.ti.fts.uika-bogor.ac.id/ijazah-bersuara
# ==============================================================================
set -euo pipefail

echo "=========================================================="
echo "  Deploying Ijazah Bersuara ke Server"
echo "=========================================================="

# 1. Pastikan docker & docker compose tersedia
if ! command -v docker &>/dev/null; then
  echo "[ERROR] Docker belum terinstal. Silakan instal Docker terlebih dahulu."
  exit 1
fi

# Cek docker compose (v2) atau docker-compose (v1)
DOCKER_COMPOSE="docker compose"
if ! docker compose version &>/dev/null; then
  if command -v docker-compose &>/dev/null; then
    DOCKER_COMPOSE="docker-compose"
  else
    echo "[ERROR] Docker Compose belum terinstal."
    exit 1
  fi
fi

# 2. Cek berkas .env
if [ ! -f .env ]; then
  echo "[INFO] Berkas .env tidak ditemukan. Menyalin dari .env.example..."
  cp .env.example .env
  echo "[PERINGATAN] Silakan edit .env dan sesuaikan POSTGRES_PASSWORD, ADMIN_TOKEN, dan identitas institusi."
  echo "Jalankan: nano .env"
  exit 1
fi

# 3. Pull update terbaru dari git jika di repo git
if [ -d .git ]; then
  echo "[INFO] Menarik perubahan terbaru dari repository git..."
  git pull origin main || echo "[WARNING] Gagal git pull (mungkin ada konflik lokal atau belum set remote). Melanjutkan build..."
fi

# 4. Bangun dan jalankan container
echo "[INFO] Membangun dan menyalakan container (db, voice, web)..."
$DOCKER_COMPOSE down --remove-orphans || true
$DOCKER_COMPOSE up -d --build

# 5. Cek status container
echo "[INFO] Menunggu container siap..."
sleep 5
$DOCKER_COMPOSE ps

echo ""
echo "=========================================================="
echo "  Deployment selesai!"
echo "  Container berjalan di port 3000 (127.0.0.1:3000)."
echo "  Pastikan konfigurasi Nginx sudah diarahkan ke 127.0.0.1:3000"
echo "  Lihat contoh konfigurasi Nginx di: nginx/nginx-subpath.conf"
echo "=========================================================="

