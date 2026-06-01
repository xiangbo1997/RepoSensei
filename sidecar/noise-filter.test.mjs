import { describe, expect, test } from "vitest";
import {
  isGeneratedFile,
  isNoiseDir,
  repomixIgnoreGlobs,
} from "./noise-filter.mjs";

describe("isGeneratedFile", () => {
  test("识别常见生成文件后缀", () => {
    const generated = [
      "api/user.pb.go",
      "rpc/service_grpc.pb.go",
      "store/repo_mock.go",
      "mocks/expected_keeper_mocks.go",
      "src/mock_client.go",
      "graphql/schema.generated.ts",
      "types/api.gen.tsx",
      "proto/message.pb.ts",
      "gen/user_pb2.py",
      "gen/user_pb2_grpc.py",
      "proto/msg.pb.cc",
      "Models/User.g.cs",
      "Services/GreeterGrpc.cs",
      "java/HelloOuterClass.java",
      "java/GreeterGrpc.java",
      "Sources/message.pb.swift",
      "lib/model.freezed.dart",
      "lib/model.g.dart",
      "src/bindings.generated.rs",
    ];
    for (const f of generated) {
      expect(isGeneratedFile(f), `${f} 应判为生成文件`).toBe(true);
    }
  });

  test("不误伤手写源码", () => {
    const handwritten = [
      "src/user.go",
      "src/userService.ts",
      "lib/model.dart",
      "api/handler.py",
      "main.rs",
      "Services/Greeter.cs",
      // mock_ 仅在文件名开头（含路径分隔）才算 mockgen 输出
      "src/mockingbird.go",
    ];
    for (const f of handwritten) {
      expect(isGeneratedFile(f), `${f} 不应判为生成文件`).toBe(false);
    }
  });
});

describe("isNoiseDir", () => {
  test("识别依赖/构建目录", () => {
    for (const d of ["node_modules", ".next", "dist", "target", "__pycache__", "vendor", ".git"]) {
      expect(isNoiseDir(d)).toBe(true);
    }
  });

  test("不误伤业务目录", () => {
    for (const d of ["src", "components", "lib", "app", "tests"]) {
      expect(isNoiseDir(d)).toBe(false);
    }
  });
});

describe("repomixIgnoreGlobs", () => {
  test("产出 glob 含目录与生成文件规则", () => {
    const globs = repomixIgnoreGlobs();
    expect(globs).toContain("**/node_modules/**");
    expect(globs).toContain("**/*.pb.go");
    expect(globs).toContain("**/*.generated.*");
    expect(globs.every((g) => typeof g === "string" && g.length > 0)).toBe(true);
  });
});
