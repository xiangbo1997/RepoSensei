#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RepoSensei — macOS 构建脚本（咸鱼 BYOK 销售版）
#
# 作用：质量门（lint + 测试）→ 注入授权密钥 → tauri build 出 .dmg。
# 前置：macOS + Node ≥ 22 + pnpm + Rust（rustup）。
#
# 用法：
#   ./deploy/build-macos.sh                 # 读 deploy/.env 里的 RS_LICENSE_SECRET
#   SKIP_CHECKS=1 ./deploy/build-macos.sh   # 跳过 lint/test（仅调试打包用）
#
# 关键：正式销售的包必须注入强随机 RS_LICENSE_SECRET（写在 deploy/.env，不入库）。
#       未注入时用开发密钥构建——任何人用仓库里的 gen-license.mjs 都能给自己发码，
#       等于没有防盗版，脚本会强提示。
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

log()  { printf '\033[1;34m[build]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn ]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[err  ]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 0. 平台与工具链自检 ─────────────────────────────────────────────────────
[[ "$(uname -s)" == "Darwin" ]] || die "macOS 应用只能在 macOS 上构建。"
command -v node  >/dev/null || die "缺少 Node.js（≥22）：https://nodejs.org"
command -v pnpm  >/dev/null || die "缺少 pnpm：npm i -g pnpm"
command -v cargo >/dev/null || die "缺少 Rust 工具链：https://rustup.rs"

# ── 1. 载入 deploy/.env（授权密钥 / 可选签名凭据；绝不入库）─────────────────
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a; # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"; set +a
  log "已载入 deploy/.env"
fi

if [[ -z "${RS_LICENSE_SECRET:-}" ]]; then
  warn "未设置 RS_LICENSE_SECRET —— 将用【开发默认密钥】构建！"
  warn "  这样的包等于没有防盗版。正式销售前请在 deploy/.env 写入："
  warn "  RS_LICENSE_SECRET='$(openssl rand -hex 24 2>/dev/null || echo '<强随机串>')'"
else
  log "授权密钥已注入（长度 ${#RS_LICENSE_SECRET}）"
fi

# ── 2. 依赖与质量门 ──────────────────────────────────────────────────────────
log "安装依赖…"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

if [[ "${SKIP_CHECKS:-0}" != "1" ]]; then
  log "质量门：biome lint…"
  pnpm lint
  log "质量门：vitest（前端 + sidecar）…"
  pnpm test
  log "质量门：cargo test（含激活码校验跨语言基准）…"
  (cd src-tauri && cargo test --quiet)
else
  warn "SKIP_CHECKS=1：跳过 lint / 测试。"
fi

# ── 3. 构建（tauri 自动执行 prepare:sidecar + build:next）───────────────────
# RS_LICENSE_SECRET 通过环境变量传给 cargo，license.rs 在编译期 option_env! 读取。
log "开始 tauri build（首次较慢，需下载 Node 运行时打进 app）…"
RS_LICENSE_SECRET="${RS_LICENSE_SECRET:-}" pnpm tauri build

# ── 4. 产物 ──────────────────────────────────────────────────────────────────
BUNDLE_DIR="${ROOT_DIR}/src-tauri/target/release/bundle"
log "构建完成，产物："
find "${BUNDLE_DIR}/macos" -maxdepth 1 -name '*.app' 2>/dev/null | sed 's/^/  /' || true
find "${BUNDLE_DIR}/dmg"   -maxdepth 1 -name '*.dmg' 2>/dev/null | sed 's/^/  /' || true
log "下一步：./deploy/pack-delivery.sh <序号> 组装买家交付包。"
