#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/env/stack.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  printf '%s' "${line#*=}"
}

normalize_bool() {
  case "${1:-}" in
    1|true|TRUE|True|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

TRAEFIK_TLS_ENABLED="${TRAEFIK_TLS_ENABLED:-$(read_env_value TRAEFIK_TLS_ENABLED || true)}"
if ! normalize_bool "${TRAEFIK_TLS_ENABLED:-true}"; then
  echo "Traefik TLS disabled; skipping certificate bootstrap."
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "Missing openssl; cannot generate Traefik TLS certificates." >&2
  exit 1
fi

LA_DATA_ROOT="${LA_DATA_ROOT:-$(read_env_value LA_DATA_ROOT || true)}"
if [[ -z "$LA_DATA_ROOT" ]]; then
  LA_DATA_ROOT="/data/localagent"
fi

TLS_CA_NAME="${TLS_CA_NAME:-$(read_env_value TLS_CA_NAME || true)}"
if [[ -z "$TLS_CA_NAME" ]]; then
  TLS_CA_NAME="LocalAgent Internal CA"
fi

TLS_CA_DAYS="${TLS_CA_DAYS:-$(read_env_value TLS_CA_DAYS || true)}"
if [[ -z "$TLS_CA_DAYS" ]]; then
  TLS_CA_DAYS="3650"
fi

TLS_CERT_DAYS="${TLS_CERT_DAYS:-$(read_env_value TLS_CERT_DAYS || true)}"
if [[ -z "$TLS_CERT_DAYS" ]]; then
  TLS_CERT_DAYS="825"
fi

declare -a host_keys=(
  TRAEFIK_DASHBOARD_HOST
  OMNIROUTE_HOST
  OMNIROUTE_API_HOST
  OPENWEBUI_HOST
  OPENCLAW_HOST
  MINIO_API_HOST
  MINIO_CONSOLE_HOST
)

declare -a hosts=()
for key in "${host_keys[@]}"; do
  value="$(read_env_value "$key" || true)"
  if [[ -z "$value" ]]; then
    continue
  fi
  already_seen="0"
  if [[ "${#hosts[@]}" -gt 0 ]]; then
    for existing in "${hosts[@]}"; do
      if [[ "$existing" == "$value" ]]; then
        already_seen="1"
        break
      fi
    done
  fi
  if [[ "$already_seen" == "1" ]]; then
    continue
  fi
  hosts+=("$value")
done

if [[ "${#hosts[@]}" -eq 0 ]]; then
  echo "No TLS hosts found in $ENV_FILE" >&2
  exit 1
fi

tls_root="$LA_DATA_ROOT/platform/proxy/traefik"
ca_dir="$tls_root/ca"
cert_dir="$tls_root/certs"
manifest_file="$cert_dir/hosts.txt"
ca_key="$ca_dir/ca.key"
ca_crt="$ca_dir/ca.crt"
server_key="$cert_dir/tls.key"
server_crt="$cert_dir/tls.crt"

mkdir -p "$ca_dir" "$cert_dir"
umask 077

if [[ ! -f "$ca_key" || ! -f "$ca_crt" ]]; then
  echo "Generating LocalAgent CA: $ca_crt"
  openssl req -x509 -newkey rsa:4096 -sha256 -days "$TLS_CA_DAYS" -nodes \
    -subj "/CN=$TLS_CA_NAME" \
    -keyout "$ca_key" \
    -out "$ca_crt" >/dev/null 2>&1
  chmod 600 "$ca_key"
  chmod 644 "$ca_crt"
fi

sorted_hosts="$(printf '%s\n' "${hosts[@]}" | LC_ALL=C sort)"
current_hosts="$(cat "$manifest_file" 2>/dev/null || true)"
needs_regen="0"

if [[ ! -f "$server_key" || ! -f "$server_crt" ]]; then
  needs_regen="1"
elif [[ "$current_hosts" != "$sorted_hosts" ]]; then
  needs_regen="1"
fi

if [[ "$needs_regen" != "1" ]]; then
  echo "Traefik TLS certificate already matches configured hosts."
  echo "CA certificate: $ca_crt"
  echo "Server certificate: $server_crt"
  exit 0
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat >"$tmp_dir/openssl.cnf" <<EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = ${hosts[0]}

[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
EOF

idx=1
for host in "${hosts[@]}"; do
  printf 'DNS.%s = %s\n' "$idx" "$host" >>"$tmp_dir/openssl.cnf"
  idx=$((idx + 1))
done

echo "Generating Traefik TLS leaf certificate for: ${hosts[*]}"
openssl req -new -newkey rsa:2048 -nodes \
  -keyout "$server_key" \
  -out "$tmp_dir/server.csr" \
  -config "$tmp_dir/openssl.cnf" >/dev/null 2>&1

openssl x509 -req \
  -in "$tmp_dir/server.csr" \
  -CA "$ca_crt" \
  -CAkey "$ca_key" \
  -CAcreateserial \
  -out "$server_crt" \
  -days "$TLS_CERT_DAYS" \
  -sha256 \
  -extfile "$tmp_dir/openssl.cnf" \
  -extensions v3_req >/dev/null 2>&1

printf '%s\n' "$sorted_hosts" >"$manifest_file"
chmod 600 "$server_key"
chmod 644 "$server_crt" "$manifest_file"

echo "Traefik TLS bootstrap complete."
echo "CA certificate: $ca_crt"
echo "Server certificate: $server_crt"
