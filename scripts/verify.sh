#!/usr/bin/env bash
#
# verify.sh — 一条命令证明项目健康（多阶段验证）。
# 结构借鉴 RuView 的 verify 脚本：每阶段独立 PASS/FAIL/SKIP，最后汇总，退出码语义明确。
#
# 用法：
#   ./scripts/verify.sh              全量
#   ./scripts/verify.sh --quick      跳过较慢阶段（Tauri 构建检查）
#   ./scripts/verify.sh --rust-only  仅 Rust
#   ./scripts/verify.sh --front-only 仅前端
#
# 退出码：0=全通过  1=有失败
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

QUICK=0
RUST_ONLY=0
FRONT_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1 ;;
    --rust-only) RUST_ONLY=1 ;;
    --front-only) FRONT_ONLY=1 ;;
    *) echo "unknown flag: $arg"; exit 64 ;;
  esac
done

# 颜色（无 tty 时关闭）
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; BOLD='\033[1m'; NC='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; BOLD=''; NC=''
fi

declare -a RESULTS
FAILED=0

run_phase() {
  local name="$1"; shift
  printf "${BOLD}▶ %s${NC}\n" "$name"
  if "$@"; then
    printf "${GREEN}  ✓ PASS${NC}\n\n"
    RESULTS+=("PASS  $name")
  else
    printf "${RED}  ✗ FAIL${NC}\n\n"
    RESULTS+=("FAIL  $name")
    FAILED=1
  fi
}

skip_phase() {
  local name="$1"; local why="$2"
  printf "${YELLOW}▶ %s — SKIP (%s)${NC}\n\n" "$name" "$why"
  RESULTS+=("SKIP  $name")
}

# ── 前端 ─────────────────────────────────────────────────
if [ "$RUST_ONLY" -eq 0 ]; then
  run_phase "Frontend lint (biome)"      npx biome check src/
  run_phase "Frontend tests (vitest)"    npx vitest run
  run_phase "TypeScript typecheck (tsc)" npx tsc --noEmit
else
  skip_phase "Frontend" "--rust-only"
fi

# ── Rust ─────────────────────────────────────────────────
if [ "$FRONT_ONLY" -eq 0 ]; then
  # 与 CI 对齐：fmt --check 是 rust-lint workflow 的硬门禁。
  run_phase "Rust fmt (cargo)" bash -c "cd src-tauri && cargo fmt --all -- --check"
  run_phase "Rust check (cargo)" bash -c "cd src-tauri && cargo check"
  run_phase "Rust tests (cargo)" bash -c "cd src-tauri && cargo test --lib"
  if [ "$QUICK" -eq 1 ]; then
    skip_phase "Rust clippy" "--quick"
  else
    # 与 CI rust-lint 完全对齐：--all-targets --all-features（CI 把 clippy 警告当 error）。
    run_phase "Rust clippy" bash -c "cd src-tauri && cargo clippy --all-targets --all-features"
  fi
else
  skip_phase "Rust" "--front-only"
fi

# ── 汇总 ─────────────────────────────────────────────────
printf "${BOLD}═══════════ SUMMARY ═══════════${NC}\n"
for r in "${RESULTS[@]}"; do
  case "$r" in
    PASS*) printf "${GREEN}%s${NC}\n" "$r" ;;
    FAIL*) printf "${RED}%s${NC}\n" "$r" ;;
    SKIP*) printf "${YELLOW}%s${NC}\n" "$r" ;;
  esac
done
printf "${BOLD}═══════════════════════════════${NC}\n"

if [ "$FAILED" -eq 0 ]; then
  printf "${GREEN}${BOLD}ALL CHECKS PASSED${NC}\n"
  exit 0
else
  printf "${RED}${BOLD}SOME CHECKS FAILED${NC}\n"
  exit 1
fi
