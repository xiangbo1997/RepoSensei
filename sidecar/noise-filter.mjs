/**
 * 噪音过滤：识别「生成文件」与「依赖/构建目录」，让它们不污染送给 LLM 的代码上下文。
 *
 * 设计来源：codegraph 的 `generated-detection.ts`（生成文件正则）与
 * `extraction/index.ts` 的 `DEFAULT_IGNORE_DIRS`（噪音目录黑名单）。
 * 这些规则与具体语言/框架无关地大幅减少 protobuf stub、mock、codegen 输出
 * 和依赖目录混入「代码理解」上下文，对任意技术栈仓库都有效。
 *
 * 两类规则用途不同：
 *   - GENERATED_PATTERNS：按文件名后缀判定的「生成文件」，纯路径分类，不读内容。
 *   - NOISE_DIRS：依赖 / 构建产物 / 缓存目录，整目录排除。
 */

/**
 * 工具生成的源码文件后缀规则（protobuf / gRPC / codegen / mock 等）。
 * 这类文件没有手写业务逻辑，混入上下文只会稀释信号。
 */
export const GENERATED_PATTERNS = [
  // Go — protobuf / gRPC / pulsar
  /\.pb\.go$/,
  /\.pulsar\.go$/,
  /_grpc\.pb\.go$/,
  // Go — mockgen 输出（mock_<src>.go / *_mock.go / *_mocks.go）
  /_mock\.go$/,
  /_mocks\.go$/,
  /(^|\/)mock_[^/]+\.go$/,
  // TypeScript / JavaScript — Apollo/GraphQL codegen、Prisma、ts-proto、gRPC-web、swagger
  /\.generated\.[jt]sx?$/,
  /\.gen\.[jt]sx?$/,
  /\.pb\.[jt]s$/,
  /_pb\.[jt]s$/,
  /_grpc_pb\.[jt]s$/,
  // Python — protobuf / gRPC / openapi-codegen
  /_pb2(_grpc)?\.py$/,
  /_pb2\.pyi$/,
  // C++ — protobuf
  /\.pb\.(cc|h)$/,
  // C# — protobuf / gRPC
  /\.g\.cs$/,
  /Grpc\.cs$/,
  // Java — protobuf / gRPC
  /OuterClass\.java$/,
  /Grpc\.java$/,
  // Swift — protobuf
  /\.pb\.swift$/,
  // Dart — build_runner / freezed / json_serializable / chopper
  /\.g\.dart$/,
  /\.freezed\.dart$/,
  /\.pb\.dart$/,
  /\.pbgrpc\.dart$/,
  /\.chopper\.dart$/,
  // Rust — 在源码树内的生成文件
  /\.generated\.rs$/,
];

/**
 * 依赖目录 / 构建产物 / 缓存目录黑名单（跨生态）。
 * 提交进仓库的依赖目录依然不是项目代码，整目录排除。
 */
export const NOISE_DIRS = new Set([
  // JS / TS — 依赖目录
  "node_modules", "bower_components", "jspm_packages", "web_modules",
  ".yarn", ".pnpm-store",
  // JS / TS — 框架与打包器构建 / 缓存 / 部署产物
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".vite", ".parcel-cache",
  ".angular", ".docusaurus", "storybook-static", ".vinxi", ".nitro",
  "out-tsc", ".vercel", ".netlify", ".wrangler",
  // 跨生态构建产物
  "dist", "build", "out", ".output",
  // 测试 / 覆盖率
  "coverage", ".nyc_output",
  // Python
  "__pycache__", "__pypackages__", ".venv", "venv", ".pixi", ".pdm-build",
  ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox", ".nox",
  ".hypothesis", ".ipynb_checkpoints", ".eggs",
  // Rust / JVM（Maven、Gradle、Scala）
  "target", ".gradle",
  // .NET
  "obj",
  // Vendored 依赖（Go、PHP/Composer、Ruby/Bundler）
  "vendor",
  // Swift / iOS
  ".build", "Pods", "Carthage", "DerivedData", ".swiftpm",
  // Dart / Flutter
  ".dart_tool", ".pub-cache",
  // Native（Android NDK、C/C++ 依赖）
  ".cxx", ".externalNativeBuild", "vcpkg_installed",
  // Scala 工具链
  ".bloop", ".metals",
  // Lua / Luau（LuaRocks）
  "lua_modules", ".luarocks",
  // Delphi / RAD Studio IDE 备份（与 .pas 源码重复）
  "__history", "__recovery",
  // 通用缓存
  ".cache",
  // VCS / 编辑器
  ".git", ".idea", ".vscode",
]);

/** glob 形式的额外忽略规则（无法用单个目录名表达的）。 */
const EXTRA_GLOBS = [
  "*.egg-info/",    // Python 打包元数据
  "cmake-build-*/", // CLion / CMake 构建树
  "bazel-*/",       // Bazel 输出符号链接树
];

/**
 * 是否为工具生成的文件（纯路径判定）。
 * @param {string} filePath 相对或绝对路径
 * @returns {boolean}
 */
export function isGeneratedFile(filePath) {
  return GENERATED_PATTERNS.some((p) => p.test(filePath));
}

/**
 * 目录名是否属于噪音目录。
 * @param {string} dirName 单层目录名（非路径）
 * @returns {boolean}
 */
export function isNoiseDir(dirName) {
  return NOISE_DIRS.has(dirName);
}

/**
 * 构造传给 repomix `--ignore` 的 glob 模式列表（逗号分隔由调用方拼接）。
 * 含噪音目录（`<dir>/**`）+ 生成文件后缀 glob + 额外 glob。
 * @returns {string[]}
 */
export function repomixIgnoreGlobs() {
  const dirGlobs = Array.from(NOISE_DIRS, (d) => `**/${d}/**`);
  const generatedGlobs = [
    "**/*.pb.go", "**/*.pulsar.go", "**/*_grpc.pb.go",
    "**/*_mock.go", "**/*_mocks.go", "**/mock_*.go",
    "**/*.generated.*", "**/*.gen.ts", "**/*.gen.tsx",
    "**/*.gen.js", "**/*.gen.jsx", "**/*.pb.ts", "**/*.pb.js",
    "**/*_pb2.py", "**/*_pb2_grpc.py", "**/*_pb2.pyi",
    "**/*.pb.cc", "**/*.pb.h",
    "**/*.g.cs", "**/*Grpc.cs",
    "**/*OuterClass.java", "**/*Grpc.java",
    "**/*.pb.swift",
    "**/*.g.dart", "**/*.freezed.dart", "**/*.pb.dart",
    "**/*.pbgrpc.dart", "**/*.chopper.dart",
  ];
  return [...dirGlobs, ...generatedGlobs, ...EXTRA_GLOBS];
}
