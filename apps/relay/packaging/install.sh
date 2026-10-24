#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: install.sh --role relay|connector|both [--prefix PATH] [--skip-deps]

Installs into a new private prefix. Existing prefixes are never overwritten.
The default prefix is ~/.local/lib/voxcode-relay.
EOF
  exit 2
}

role=''
prefix="${HOME}/.local/lib/voxcode-relay"
skip_deps=0
while (($#)); do
  case "$1" in
    --role) [[ $# -ge 2 ]] || usage; role="$2"; shift 2 ;;
    --prefix) [[ $# -ge 2 ]] || usage; prefix="$2"; shift 2 ;;
    --skip-deps) skip_deps=1; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done
[[ "$role" == relay || "$role" == connector || "$role" == both ]] || usage
[[ "$prefix" = /* ]] || prefix="$PWD/$prefix"
[[ ! -e "$prefix" ]] || { echo "Refusing to overwrite existing prefix: $prefix" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'Node.js >=22 is required' >&2; exit 1; }
node_major="$(node -p 'process.versions.node.split(".")[0]')"
(( node_major >= 22 )) || { echo "Node.js >=22 is required (found $(node --version))" >&2; exit 1; }

package_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$prefix" "$prefix/config" "$prefix/log" "$prefix/run"
cp -R "$package_dir/app" "$prefix/app"
cp -R "$package_dir/bin" "$prefix/bin"
cp -R "$package_dir/systemd" "$prefix/systemd"
chmod 0755 "$prefix/bin" "$prefix/bin"/*
printf '%s\n' "$role" > "$prefix/role"

copy_config() {
  local role_name="$1"
  local target="$prefix/config/${role_name}.env"
  cp "$package_dir/templates/${role_name}.env.example" "$target"
  chmod 0600 "$target"
  echo "Created $target; edit it before starting ${role_name}."
}
case "$role" in
  relay) copy_config relay ;;
  connector) copy_config connector ;;
  both) copy_config relay; copy_config connector ;;
esac

if (( ! skip_deps )); then
  (cd "$prefix/app" && npm ci --omit=dev --ignore-scripts)
else
  [[ -d "$prefix/app/node_modules/ws" ]] || { echo 'Bundled ws dependency is missing' >&2; exit 1; }
fi

cat > "$prefix/README.txt" <<EOF
VoxCode Relay ${role} installed at $prefix

Edit config/*.env, then run:
  $prefix/bin/start-relay
  $prefix/bin/start-connector
  $prefix/bin/status
  $prefix/bin/stop

The start scripts run in the foreground. Add --daemon for a user-owned process.
Systemd user unit templates are in $prefix/systemd; installing them is manual.
EOF
chmod 0644 "$prefix/README.txt"
echo "Installed VoxCode Relay package at $prefix"
