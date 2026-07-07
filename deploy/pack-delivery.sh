#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RepoSensei — 买家交付包打包脚本（咸鱼 BYOK 版）
#
# 作用：把「已构建好的 .dmg + 买家说明 +（可选）激活码」收拢成一个可直接发给
#       单个买家的文件夹（并可选压缩成 zip）。一个买家一个交付包。
#
# 前置：先跑过 ./deploy/build-macos.sh 产出 .dmg。
#       生成激活码用的密钥须与构建 App 时的 RS_LICENSE_SECRET 一致（读 deploy/.env）。
#
# 用法：
#   ./deploy/pack-delivery.sh 0001                      # 默认：V1 码随包直接交付（开箱即激活）
#   BIND_MACHINE=<识别码> ./deploy/pack-delivery.sh 0001 # V2 绑定码：买家已发来识别码时用
#   NO_CODE=1 ./deploy/pack-delivery.sh 0001            # 不带码：走「先发识别码再换码」流程
#   ZIP=1 ./deploy/pack-delivery.sh 0001                # 顺带压缩成 .zip
#
# 取舍说明：V1 码任意机器可激活（买家体验最顺，零来回），码内含订单序号可追溯泄露源；
#           若发现某单的码被公开传播，后续单改用 BIND_MACHINE 的 V2 绑定码即可。
#
# 产物：deploy/delivery/<序号>/
#   ├── RepoSensei_<版本>_<架构>.dmg
#   ├── 买家必读-如何打开与配置.md
#   └── 激活码.txt（默认）或 如何激活.txt（NO_CODE=1）
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

log()  { printf '\033[1;34m[pack]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[err ]\033[0m %s\n' "$*" >&2; exit 1; }

# 载入 deploy/.env（若存在），复用其中的 RS_LICENSE_SECRET。
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a; # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"; set +a
fi

SERIAL="${1:-}"
[[ -n "${SERIAL}" ]] || die "用法：./deploy/pack-delivery.sh <序号|买家名>（例：0001）"

# ── 1. 定位最新构建出的 .dmg ─────────────────────────────────────────────────
DMG_DIR="${ROOT_DIR}/src-tauri/target/release/bundle/dmg"
[[ -d "${DMG_DIR}" ]] || die "未找到 ${DMG_DIR}。请先运行 ./deploy/build-macos.sh 构建。"
DMG_PATH="$(find "${DMG_DIR}" -maxdepth 1 -name '*.dmg' -print0 | xargs -0 ls -t 2>/dev/null | head -1 || true)"
[[ -n "${DMG_PATH}" ]] || die "在 ${DMG_DIR} 未找到任何 .dmg。"
log "使用 dmg：$(basename "${DMG_PATH}")"

# ── 2. 买家说明文件必须存在 ──────────────────────────────────────────────────
README_SRC="${ROOT_DIR}/deploy/买家必读-如何打开与配置.md"
[[ -f "${README_SRC}" ]] || die "缺少买家说明：${README_SRC}"

# ── 3. 准备激活码（三种模式）─────────────────────────────────────────────────
if [[ -z "${RS_LICENSE_SECRET:-}" ]]; then
  warn "未设置 RS_LICENSE_SECRET —— 生成的激活码用【开发默认密钥】，只能被同样用默认密钥构建的 App 认可。"
  warn "  正式销售请在 deploy/.env 设置与构建时一致的密钥。"
fi

LICENSE_CODE=""
CODE_KIND="none"
if [[ -n "${BIND_MACHINE:-}" ]]; then
  LICENSE_CODE="$(node "${ROOT_DIR}/deploy/gen-license.mjs" --machine "${BIND_MACHINE}" 2>/dev/null | tail -1)"
  [[ -n "${LICENSE_CODE}" ]] || die "生成绑定码失败（--machine ${BIND_MACHINE}）。"
  CODE_KIND="v2"
  log "V2 绑定码（绑定机器 ${BIND_MACHINE}）：${LICENSE_CODE}"
elif [[ "${NO_CODE:-0}" == "1" ]]; then
  log "NO_CODE 流程：交付包不含激活码，买家打开后发本机识别码给你再生成。"
else
  # 默认：V1 码随包直接交付。码内含订单序号（可追溯），请勿公开展示。
  LICENSE_CODE="$(node "${ROOT_DIR}/deploy/gen-license.mjs" "${SERIAL}" 2>/dev/null | tail -1)"
  [[ -n "${LICENSE_CODE}" ]] || die "生成 V1 激活码失败。"
  CODE_KIND="v1"
  log "V1 激活码（序号 ${SERIAL}，随包交付）：${LICENSE_CODE}"
fi

# ── 4. 组装交付目录 ──────────────────────────────────────────────────────────
OUT_DIR="${ROOT_DIR}/deploy/delivery/${SERIAL}"
rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"
cp "${DMG_PATH}" "${OUT_DIR}/"
cp "${README_SRC}" "${OUT_DIR}/"

if [[ "${CODE_KIND}" == "none" ]]; then
  cat > "${OUT_DIR}/如何激活.txt" <<EOF
RepoSensei — 如何激活
================================

本 App 一机一码，激活码需要根据你这台电脑单独生成，步骤：

1. 双击 .dmg，把「RepoSensei」拖进「应用程序」。
2. 打开 App（首次打开方法见「买家必读」文件第 2 步）。
3. 首屏「激活」界面会显示一串【本机识别码】（20 位字母数字），点「复制」。
4. 把这串识别码发给卖家（闲鱼私聊）。
5. 卖家生成你的专属激活码发回给你，粘贴进激活框、点「激活」即可。
6. 激活后按「买家必读」配置你自己的 API Key，开始分析项目。

激活码与你这台电脑绑定，换电脑需重新获取（正版换机卖家一般都支持）。
交付序号：${SERIAL}
EOF
else
  # 尾注按码型区分：V1 换机可复用同一码；V2 与机器绑定，换机需找卖家换码。
  if [[ "${CODE_KIND}" == "v1" ]]; then
    CODE_NOTE="激活后永久可用、无需联网。换电脑重装后用同一个码再激活一次即可。
此码与你的订单绑定（序号 ${SERIAL}），请勿公开外传——外传可追溯到本单。"
  else
    CODE_NOTE="激活后永久可用、无需联网。此码与你这台电脑绑定，换电脑请联系卖家换码。
交付序号：${SERIAL}"
  fi
  cat > "${OUT_DIR}/激活码.txt" <<EOF
RepoSensei — 你的专属激活码
================================

激活码（打开 App 后粘贴到激活框，勿手打）：

    ${LICENSE_CODE}

使用步骤：
1. 双击 .dmg，把「RepoSensei」拖进「应用程序」。
2. 打开 App（首次打开方法见「买家必读」文件第 2 步）。
3. 在激活界面粘贴上面的激活码，点「激活」。
4. 进入后按「买家必读」配置你自己的 API Key，即可开始使用。

${CODE_NOTE}
EOF
fi

log "交付包已生成：${OUT_DIR}"
ls -1 "${OUT_DIR}"

# ── 5. 可选压缩（ditto 正确处理中文文件名，产出干净 zip）─────────────────────
if [[ "${ZIP:-0}" == "1" ]]; then
  ZIP_PATH="${ROOT_DIR}/deploy/delivery/RepoSensei_交付_${SERIAL}.zip"
  rm -f "${ZIP_PATH}"
  ditto -c -k --norsrc --noextattr --keepParent "${OUT_DIR}" "${ZIP_PATH}"
  log "已压缩：${ZIP_PATH}"
fi

log "完成。把该文件夹（或 zip）发给买家即可。"
