#!/usr/bin/env node
/**
 * RepoSensei 激活码生成器（卖家私用，切勿随包分发给买家）。
 *
 * 必须与 src-tauri/src/license.rs 的校验算法逐位一致：
 *   HMAC-SHA256(secret, payload) → base32 大写 → 取前 16 位；激活码 = `payload.signature`。
 *
 * 两种码：
 *  - 通用码 V1:<序号>   任意机器可激活（会被重复使用），仅用序号区分卖给谁。
 *  - 绑定码 V2:<机器码> 只有该机器能激活（换机失效），机器码来自买家 App 里显示的
 *    「本机识别码」。防止一码多机复用，推荐用它。
 *
 * 用法：
 *   # 通用码
 *   RS_LICENSE_SECRET='与打包时相同的强随机串' node deploy/gen-license.mjs 0001
 *   RS_LICENSE_SECRET='...' node deploy/gen-license.mjs --batch 20   # 0001..0020
 *   # 绑定码（把买家发来的本机识别码填进去）
 *   RS_LICENSE_SECRET='...' node deploy/gen-license.mjs --machine U7L3O5HG2W7RWXQSUXOA
 *
 * 关键约束：这里的 RS_LICENSE_SECRET 必须和你构建 App 时注入的 RS_LICENSE_SECRET
 * 完全相同（见 deploy/build-macos.sh），否则生成的码 App 认不出。
 */

import { createHmac } from "node:crypto";

const DEV_FALLBACK_SECRET = "reposensei-dev-secret-do-not-ship";
const SECRET =
  (process.env.RS_LICENSE_SECRET ?? "").trim() || DEV_FALLBACK_SECRET;
const SIGNATURE_LEN = 16;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 与 license.rs 的 to_base32 逐位一致的实现。 */
function toBase32(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** 对 payload 签名，产出 `payload.signature`（大写，与 Rust 校验前的 to_uppercase 对齐）。 */
function sign(payload) {
  const mac = createHmac("sha256", SECRET).update(payload).digest();
  const signature = toBase32(new Uint8Array(mac)).slice(0, SIGNATURE_LEN);
  return `${payload}.${signature}`;
}

/** 通用码 V1:<序号>（任意机器可激活）。 */
function makeCode(serial) {
  return sign(`V1:${String(serial).toUpperCase()}`);
}

/** 绑定码 V2:<机器码>（只有该机器能激活）。机器码即买家 App 显示的本机识别码。 */
function makeMachineCode(machine) {
  return sign(`V2:${String(machine).trim().toUpperCase()}`);
}

function main() {
  const args = process.argv.slice(2);
  if (SECRET === DEV_FALLBACK_SECRET) {
    console.error(
      "⚠️  正在使用【开发默认密钥】。对外销售前请：export RS_LICENSE_SECRET='你的强随机串'\n",
    );
  }

  if (args[0] === "--machine") {
    const machine = args[1];
    if (!machine) {
      console.error("用法：--machine <买家的本机识别码>");
      console.error(
        "例：  node deploy/gen-license.mjs --machine U7L3O5HG2W7RWXQSUXOA",
      );
      process.exit(1);
    }
    console.log(makeMachineCode(machine));
    return;
  }

  if (args[0] === "--batch") {
    const n = Number(args[1] ?? "10");
    if (!Number.isInteger(n) || n <= 0) {
      console.error("用法：--batch <正整数>");
      process.exit(1);
    }
    for (let i = 1; i <= n; i++) {
      console.log(makeCode(String(i).padStart(4, "0")));
    }
    return;
  }

  const serial = args[0];
  if (!serial) {
    console.error(
      "用法：node deploy/gen-license.mjs <序号|--batch N|--machine 机器码>",
    );
    console.error("例：  node deploy/gen-license.mjs 0001");
    console.error(
      "      node deploy/gen-license.mjs --machine U7L3O5HG2W7RWXQSUXOA",
    );
    process.exit(1);
  }
  console.log(makeCode(serial));
}

main();
