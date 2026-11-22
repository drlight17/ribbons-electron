#!/usr/bin/env bash
set -euo pipefail

# Ribbons Screensaver — Tauri build prerequisites
# Run with: chmod +x prepare.sh && ./prepare.sh
# On Windows run it from Git Bash or MSYS2.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

platform="unknown"
case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux*) platform="linux" ;;
  Darwin*) platform="macos" ;;
  MINGW*|MSYS*|CYGWIN*) platform="windows" ;;
esac

cargo_needs_restart=0

echo "Detected platform: $platform"

install_linux_packages() {
  if command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --needed --noconfirm \
      base-devel curl wget file openssl \
      webkit2gtk-4.1 libayatana-appindicator gtk3 libsoup3 dbus \
      libx11 libxi libxtst xorg-xprop pipewire libpulse
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y \
      build-essential curl wget file libssl-dev pkg-config \
      libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
      libx11-dev libxi-dev libxtst-dev x11-utils libdbus-1-dev \
      libpipewire-0.3-dev libpulse-dev pulseaudio-utils
  else
    echo "Install the Tauri 2 Linux prerequisites for your distribution:" >&2
    echo "https://v2.tauri.app/start/prerequisites/" >&2
    exit 1
  fi
}

check_macos_packages() {
  if ! xcode-select -p >/dev/null 2>&1; then
    echo "Xcode Command Line Tools are required to build Tauri apps on macOS." >&2
    echo "Install them with:" >&2
    echo "  xcode-select --install" >&2
    echo "Then rerun ./prepare.sh." >&2
    exit 1
  fi
}

find_vswhere() {
  local candidates=()
  local program_files_x86 program_files

  if command -v cygpath >/dev/null 2>&1; then
    program_files_x86="$(printenv 'ProgramFiles(x86)' 2>/dev/null || true)"
    program_files="$(printenv 'ProgramFiles' 2>/dev/null || true)"
    if [ -n "$program_files_x86" ]; then
      candidates+=("$(cygpath -u "$program_files_x86")/Microsoft Visual Studio/Installer/vswhere.exe")
    fi
    if [ -n "$program_files" ]; then
      candidates+=("$(cygpath -u "$program_files")/Microsoft Visual Studio/Installer/vswhere.exe")
    fi
  fi

  candidates+=(
    "/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
    "/c/Program Files/Microsoft Visual Studio/Installer/vswhere.exe"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

check_windows_packages() {
  echo "Windows builds require Microsoft C++ Build Tools (MSVC + Windows SDK) and WebView2."
  echo "See: https://v2.tauri.app/start/prerequisites/#windows"

  local vswhere
  if vswhere="$(find_vswhere)"; then
    local install_path
    install_path="$("$vswhere" -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>/dev/null || true)"
    if [ -z "$install_path" ]; then
      echo "Warning: MSVC C++ build tools were not found." >&2
      echo "Install the 'Desktop development with C++' workload in Visual Studio Build Tools." >&2
    fi
  else
    echo "Warning: Visual Studio Build Tools could not be detected." >&2
    echo "Install them from https://visualstudio.microsoft.com/visual-cpp-build-tools/" >&2
  fi
}

ensure_cargo() {
  if command -v cargo >/dev/null 2>&1; then
    return 0
  fi

  local cargo_bin="$HOME/.cargo/bin"
  if [ -x "$cargo_bin/cargo" ] || [ -x "$cargo_bin/cargo.exe" ]; then
    export PATH="$cargo_bin:$PATH"
    cargo_needs_restart=1
    return 0
  fi

  echo "Rust/Cargo was not found. Installing Rust with rustup..."

  if [ "$platform" = "windows" ]; then
    if ! command -v curl >/dev/null 2>&1; then
      echo "curl is required to download rustup-init.exe." >&2
      return 1
    fi

    local rustup_url="https://win.rustup.rs/x86_64"
    case "$(uname -m 2>/dev/null || echo unknown)" in
      aarch64|arm64) rustup_url="https://win.rustup.rs/aarch64" ;;
    esac

    local rustup_init
    rustup_init="${TEMP:-${TMP:-/tmp}}/rustup-init-$$.exe"
    if ! curl -fsSL "$rustup_url" -o "$rustup_init"; then
      echo "Failed to download rustup-init.exe." >&2
      return 1
    fi
    if ! "$rustup_init" -y --profile minimal --default-toolchain stable; then
      echo "Rust installation failed." >&2
      return 1
    fi
    rm -f "$rustup_init" 2>/dev/null || true
  else
    if ! command -v curl >/dev/null 2>&1; then
      echo "curl is required to install Rust from https://sh.rustup.rs" >&2
      return 1
    fi
    if ! curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal; then
      echo "Rust installation failed." >&2
      return 1
    fi
  fi

  if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck disable=SC1090
    . "$HOME/.cargo/env"
  fi
  export PATH="$cargo_bin:$PATH"
  cargo_needs_restart=1

  if command -v cargo >/dev/null 2>&1; then
    return 0
  fi

  echo "Rust was installed, but cargo is still not on PATH." >&2
  echo "Restart your terminal and rerun ./prepare.sh." >&2
  return 1
}

case "$platform" in
  linux)
    install_linux_packages
    ;;
  macos)
    check_macos_packages
    ;;
  windows)
    check_windows_packages
    ;;
  *)
    echo "Unsupported platform: $(uname -s 2>/dev/null || echo unknown)" >&2
    echo "Install the Tauri 2 prerequisites manually: https://v2.tauri.app/start/prerequisites/" >&2
    exit 1
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required for the Tauri CLI: https://nodejs.org/" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required for the Tauri CLI: https://nodejs.org/" >&2
  exit 1
fi

if ! ensure_cargo; then
  echo "Install Rust from https://rustup.rs/ and rerun ./prepare.sh." >&2
  exit 1
fi

if [ "$platform" = "linux" ]; then
  current_user="$(id -un 2>/dev/null || echo "${USER:-user}")"
  if ! id -nG "$current_user" 2>/dev/null | tr ' ' '\n' | grep -qx input; then
    echo "Add the user to the 'input' group for screensaver activity detection:"
    echo "  sudo usermod -aG input $current_user"
    echo "Then log out and back in."
  fi

  for helper in wctx parec pactl; do
    if ! command -v "$helper" >/dev/null 2>&1; then
      echo "Warning: optional runtime helper '$helper' was not found."
    fi
  done
fi

echo "Installing npm dependencies..."
npm install

echo "Prerequisites installed."

if [ "$cargo_needs_restart" = "1" ]; then
  echo
  echo "Rust was added to PATH for this script, but your current terminal may not see it yet."
  echo "Open a new terminal, or run:"
  echo "  export PATH=\"\$HOME/.cargo/bin:\$PATH\""
  echo "Then start the app with: npm run dev"
else
  echo "Run: npm run dev"
fi
