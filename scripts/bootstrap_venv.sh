#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(dirname -- "$script_dir")
venv_dir="$repo_dir/.venv"
uv_cache_dir="$venv_dir/.uv-cache"

is_supported_python() {
  "$1" -c 'import sys; raise SystemExit(0 if (3, 12) <= sys.version_info[:2] < (3, 14) else 1)' \
    >/dev/null 2>&1
}

find_python() {
  if [ -n "${BOOTSTRAP_PYTHON:-}" ]; then
    if command -v "$BOOTSTRAP_PYTHON" >/dev/null 2>&1 && is_supported_python "$BOOTSTRAP_PYTHON"; then
      command -v "$BOOTSTRAP_PYTHON"
      return 0
    fi
    echo "BOOTSTRAP_PYTHON must point to Python >=3.12,<3.14: $BOOTSTRAP_PYTHON" >&2
    return 1
  fi

  for candidate in python3.13 python3.12 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && is_supported_python "$candidate"; then
      command -v "$candidate"
      return 0
    fi
  done

  echo "Python >=3.12,<3.14 is required. Install Python 3.12 or set BOOTSTRAP_PYTHON." >&2
  return 1
}

cd "$repo_dir"

if [ -x "$venv_dir/bin/python" ]; then
  if ! is_supported_python "$venv_dir/bin/python"; then
    echo "Existing .venv uses an unsupported Python; remove or relocate it explicitly, then rerun." >&2
    exit 1
  fi
  echo "Reusing $venv_dir ($("$venv_dir/bin/python" --version 2>&1))"
else
  python_executable=$(find_python)
  echo "Creating $venv_dir with $("$python_executable" --version 2>&1)"
  "$python_executable" -m venv "$venv_dir"
fi

if [ ! -x "$venv_dir/bin/uv" ]; then
  "$venv_dir/bin/python" -m pip install --disable-pip-version-check uv
fi

# --active selects this exact venv. --inexact keeps uv itself installed while
# project and dev dependencies are resolved strictly from the frozen lockfile.
VIRTUAL_ENV="$venv_dir" UV_CACHE_DIR="$uv_cache_dir" \
  "$venv_dir/bin/uv" sync --frozen --dev --active --inexact

"$venv_dir/bin/python" -c 'import fastapi, httpx, openai, pydantic; print("core imports: ok")'
"$venv_dir/bin/python" --version
"$venv_dir/bin/uv" --version
