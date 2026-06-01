# RepoSensei — 常用命令聚合
# 降低贡献者入门成本，统一 pnpm / cargo / tauri 调用入口。

.PHONY: help install dev build test test-front test-rust lint fix verify verify-quick e2e clean

help: ## 显示可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## 安装依赖
	pnpm install

dev: ## 启动开发模式（Tauri + Next.js）
	pnpm dev

build: ## 构建生产包
	pnpm build

test: test-front test-rust ## 跑全部测试（前端 + Rust）

test-front: ## 前端测试（vitest）
	pnpm test

test-rust: ## Rust 测试（cargo）
	cd src-tauri && cargo test --lib

lint: ## 静态检查（biome）
	pnpm lint

fix: ## 自动修复（biome）
	pnpm fix

verify: ## 一键多阶段验证（前端 + Rust）
	bash scripts/verify.sh

verify-quick: ## 快速验证（跳过 clippy）
	bash scripts/verify.sh --quick

e2e: ## 无 Tauri 跑端到端链路（需 PATH 参数：make e2e PATH=/repo）
	pnpm e2e $(PATH)

clean: ## 清理构建产物
	rm -rf .next dist src-tauri/target/debug/build
