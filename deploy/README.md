# 销售运维手册 — RepoSensei（咸鱼 BYOK 版）

> 面向：**卖家本人**。终端买家怎么用，见 [`买家必读-如何打开与配置.md`](./买家必读-如何打开与配置.md)。

---

## 0. 商业模式一句话

**一次性买断 + BYOK（买家自带 AI Key）+ 一机一码激活。**
没有服务器、没有后端、没有订阅——你要维护的只有：构建 `.dmg`、发码、答疑。

| 常见概念 | 在本项目里对应什么 |
|---|---|
| 部署到服务器 | ❌ 不存在。产物是买家下载的 `.dmg` |
| 服务端密钥 | ❌ 不存在。买家的 API Key 存买家自己电脑 |
| 用户系统 / 订单系统 | ❌ 不存在。咸鱼私聊就是你的客服系统，`deploy/delivery/<序号>/` 就是你的订单记录 |
| 防盗版 | ✅ HMAC 激活码，V2 码绑定买家机器（详见 §2） |

---

## 1. 首次准备（只做一次）

### 1.1 生成并保存授权密钥

```bash
cp deploy/.env.example deploy/.env
# 编辑 deploy/.env，把 RS_LICENSE_SECRET 换成强随机串，例如：
openssl rand -hex 24
```

**这个密钥就是你的"印钞机"，务必：**
- ❌ 绝不提交进 git（已被 .gitignore 覆盖）
- ❌ 绝不发给任何买家
- ✅ 在密码管理器里备份一份——**丢了它，以后就无法给已售出的包发码**
- ✅ 构建 App 和生成激活码必须用**同一个**密钥，否则码无效

### 1.2 构建销售版 `.dmg`

```bash
./deploy/build-macos.sh
```

脚本流程：工具链自检 → 载入 `deploy/.env` → lint + 全部测试 →
`pnpm tauri build`（自动把 Node 运行时和 repomix 打进 app，买家无需装 Node）。

产物：`src-tauri/target/release/bundle/dmg/RepoSensei_<版本>_aarch64.dmg`

> ⚠️ 脚本若警告「未设置 RS_LICENSE_SECRET」，说明在用开发密钥构建——
> 这种包任何拿到源码的人都能自己发码，**不能对外销售**。

### 1.3 本机冒烟（发售前必做）

1. 双击 dmg → 拖进「应用程序」→ 打开（首次需右键打开）。
2. 确认出现**激活界面**，显示 20 位本机识别码。
3. 给自己发一个码验证全流程：
   ```bash
   # 把激活界面显示的识别码填进去（读 deploy/.env 里的密钥）
   set -a; source deploy/.env; set +a
   node deploy/gen-license.mjs --machine <识别码>
   ```
4. 粘贴激活 → 进入主界面 → 设置里填 Key → 测试连接 → 分析一个小项目跑通。

---

## 2. 激活码机制（你需要懂的全部）

```
激活码 = payload + "." + HMAC-SHA256(密钥, payload) 的 base32 前 16 位
```

| 码型 | payload | 特点 | 什么时候用 |
|---|---|---|---|
| **V2 绑定码**（默认） | `V2:<买家机器码>` | 只有那台机器能激活 | 正常销售，一单一码 |
| V1 通用码 | `V1:<序号>` | 任何机器都能激活 | 仅应急（如买家机器码反复出错），会被传播复用 |

- 校验逻辑在 `src-tauri/src/license.rs`（Rust 编译期注入密钥，买家改不了）；
  生成逻辑在 `deploy/gen-license.mjs`。两边算法逐位一致，有跨语言单测保底。
- 买家的「本机识别码」= 其 Mac 硬件 UUID 的 SHA-256 单向哈希前 20 位，不含隐私。
- 未激活时：前端全屏激活门 + **Rust 端拒绝执行所有 LLM 命令**（绕过界面也没用）。
- 激活状态存买家本机 `license.json`；复制给别人无效（V2 码校验机器不匹配）。
- 开发模式（`pnpm dev`）自动放行不挡开发；`RS_LICENSE_FORCE=1 pnpm dev` 可调试激活界面。

---

## 3. 日常卖一单的完整流程（SOP）

```
买家拍下
  │
  ▼
① 组装交付包（不含码）：
     ./deploy/pack-delivery.sh 0007        # 序号自定，建议递增或用买家昵称
     ZIP=1 ./deploy/pack-delivery.sh 0007  # 需要 zip 就加 ZIP=1
  │
  ▼
② 把 deploy/delivery/0007/（或 zip）发给买家
     内含：dmg + 买家必读 + 「如何激活.txt」
  │
  ▼
③ 买家打开 App，把「本机识别码」私聊发给你
  │
  ▼
④ 你生成绑定码发回：
     set -a; source deploy/.env; set +a
     node deploy/gen-license.mjs --machine <买家识别码>
  │
  ▼
⑤ 买家激活成功 → 引导按「买家必读」第 4 步配 Key → 成交好评
```

**记录**：`deploy/delivery/` 目录天然就是台账（一单一文件夹）。
建议再维护一个简单表格：序号 / 咸鱼ID / 机器码 / 发码日期，方便售后换机核对。

### 售后常见操作

| 场景 | 操作 |
|---|---|
| 买家换电脑 | 让买家发新识别码，重新 `--machine` 生成即可（口头约定次数，如一年 2 次） |
| 买家说码无效 | 让买家**截图激活界面**核对识别码，99% 是复制错/发错机器 |
| 买家打不开 App | 按买家必读第 2 步走 `xattr -cr`；再不行远程协助 |
| 忘了给谁发过码 | 看 `deploy/delivery/` 和你的台账 |

---

## 4. 版本更新怎么发

1. 改代码 → 三处版本号对齐（`package.json` / `tauri.conf.json` / `Cargo.toml`）。
2. `./deploy/build-macos.sh` 重新构建（**密钥不变**，老买家的激活码继续有效——
   激活状态存在买家本机，覆盖安装不丢）。
3. 把新 dmg 发给老买家即可，无需重新激活。

---

## 5. 安全红线（强制）

- ❌ `deploy/.env`（授权密钥）绝不入库、绝不外发。
- ❌ 激活码生成器 `gen-license.mjs` 不要放进交付包（`pack-delivery.sh` 不会拷它，
  手动打包时注意）。
- ❌ 仓库 / 交付包里绝不出现你自己的 LLM API Key（`.env.local` 已被 .gitignore 覆盖，
  且 noise-filter 会把它挡在打包/索引之外）。
- ✅ 卖的是**软件使用权**；买家的代码和 Key 都在买家本地，你无法也不应触碰。
- ✅ 咸鱼商品描述建议写清：仅支持 Apple 芯片 Mac、需自备 AI Key、一机一码。

---

## 6. 文件索引

| 文件 | 作用 | 给谁 |
|---|---|---|
| `build-macos.sh` | 质量门 + 注入密钥 + 出 dmg | 卖家 |
| `pack-delivery.sh` | 按单组装交付包 | 卖家 |
| `gen-license.mjs` | 生成激活码 | 卖家（**勿外发**） |
| `.env.example` → `.env` | 授权密钥配置 | 卖家（.env 不入库） |
| `买家必读-如何打开与配置.md` | 安装/激活/配置/使用全指引 | 随包发给买家 |
| `delivery/<序号>/` | 每单的交付包 = 台账 | 发给对应买家 |

---

*文档作者：Claude Code ｜ 日期：2026-07-04 ｜ 对应版本：RepoSensei 0.2.0*
