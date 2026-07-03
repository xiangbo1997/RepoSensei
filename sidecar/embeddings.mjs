/**
 * Embedding 客户端：复用 BYOK 的 OpenAI 兼容 /embeddings 端点，为代码 chunk 与查询
 * 计算语义向量，支撑 Hybrid 检索（FTS5 精确 + 向量语义 + RRF 融合）。
 *
 * 设计：
 *   - 与 llm.rs 一致优先 OPENAI_BASE_URL（兼容代理）；凭据从 .env.local 读取。
 *   - Anthropic 原生无 embedding 端点 → 配置不可用时返回 null，检索自动降级纯 FTS5。
 *   - 裸 fetch，避免 SDK 指纹被反代 WAF 拦。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dotenvLoaded = false;
function loadDotEnv() {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  try {
    const raw = readFileSync(path.resolve(__dirname, "..", ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // 缺文件正常
  }
}

/**
 * 解析 embedding 配置。无 OpenAI 兼容端点时返回 null（→ 降级纯 FTS5）。
 * @returns {{baseUrl:string, apiKey:string, model:string} | null}
 */
export function embeddingConfig() {
  // 显式关闭开关：强制纯本地 FTS5（不发任何 embedding 请求）。
  // 用于离线/确定性测试，也给想要「绝不外发」的用户一个硬开关。
  if (process.env.RS_DISABLE_EMBEDDINGS === "1") return null;
  loadDotEnv();
  const base = process.env.OPENAI_BASE_URL;
  const key = process.env.OPENAI_API_KEY;
  if (!base || !key) return null;
  return {
    baseUrl: base.replace(/\/$/, ""),
    apiKey: key,
    model: process.env.RS_EMBED_MODEL ?? "text-embedding-3-small",
  };
}

/** embedding 是否可用（前端/索引据此决定是否建向量列）。 */
export function embeddingAvailable() {
  return embeddingConfig() !== null;
}

/**
 * 批量计算向量。失败/无配置返回 null（调用方据此降级）。
 * @param {string[]} texts
 * @returns {Promise<number[][] | null>}
 */
export async function embedBatch(texts) {
  const cfg = embeddingConfig();
  if (!cfg || texts.length === 0) return null;
  try {
    const resp = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, input: texts }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.warn(`[reposensei] embeddings ${resp.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = await resp.json();
    // 按 index 排序还原顺序（OpenAI 规范返回 data[].index）。
    const sorted = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = sorted.map((d) => d.embedding);
    if (vectors.length !== texts.length || vectors.some((v) => !Array.isArray(v))) {
      return null;
    }
    return vectors;
  } catch (e) {
    console.warn(`[reposensei] embeddings failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** 单条文本向量。 */
export async function embedOne(text) {
  const r = await embedBatch([text]);
  return r ? r[0] : null;
}

/** 余弦相似度（两向量需同维）。 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** float 数组 → Buffer（Float32 BLOB），存 SQLite。 */
export function vectorToBlob(vec) {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

/**
 * Buffer（Float32 BLOB）→ Float32Array 视图。
 * 直接返回 typed array 视图，省掉 Array.from 的装箱（余弦打分是热路径，
 * 每次检索对候选集逐块调用）。cosineSimilarity 按下标遍历，兼容 typed array。
 */
export function blobToVector(blob) {
  if (!blob) return null;
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}
