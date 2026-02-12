#!/usr/bin/env bash
# Download static FFmpeg and FFprobe builds for bundling in the app.
# Usage: ./scripts/download-ffmpeg.sh [arm64|x64|all]
#
# Downloads from evermeet.cx (macOS static builds by Helmut K. C. Tessarek).
# These are the most widely used macOS static FFmpeg builds.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENDOR_DIR="$SCRIPT_DIR/../vendor/bin/mac"
ARCH="${1:-all}"

download_for_arch() {
  local arch="$1"
  local dest="$VENDOR_DIR/$arch"

  echo "==> Downloading FFmpeg + FFprobe for macOS $arch..."
  mkdir -p "$dest"

  # Download latest static builds
  if [ "$arch" = "arm64" ]; then
    local ffmpeg_url="https://evermeet.cx/ffmpeg/ffmpeg-arm64.zip"
    local ffprobe_url="https://evermeet.cx/ffmpeg/ffprobe-arm64.zip"
  else
    local ffmpeg_url="https://evermeet.cx/ffmpeg/ffmpeg.zip"
    local ffprobe_url="https://evermeet.cx/ffmpeg/ffprobe.zip"
  fi

  echo "    Downloading ffmpeg..."
  curl -sL "$ffmpeg_url" -o "/tmp/ffmpeg-$arch.zip"
  unzip -qo "/tmp/ffmpeg-$arch.zip" -d "$dest"
  rm "/tmp/ffmpeg-$arch.zip"

  echo "    Downloading ffprobe..."
  curl -sL "$ffprobe_url" -o "/tmp/ffprobe-$arch.zip"
  unzip -qo "/tmp/ffprobe-$arch.zip" -d "$dest"
  rm "/tmp/ffprobe-$arch.zip"

  chmod +x "$dest/ffmpeg" "$dest/ffprobe"

  echo "    Verifying..."
  "$dest/ffmpeg" -version | head -1
  "$dest/ffprobe" -version | head -1
  echo "    Done: $dest"
}

case "$ARCH" in
  arm64)
    download_for_arch arm64
    ;;
  x64)
    download_for_arch x64
    ;;
  all)
    download_for_arch arm64
    download_for_arch x64
    ;;
  *)
    echo "Usage: $0 [arm64|x64|all]"
    exit 1
    ;;
esac

echo ""
echo "==> FFmpeg binaries ready in $VENDOR_DIR"
echo "    Run 'npx electron-builder --mac --arm64' to build the DMG."
