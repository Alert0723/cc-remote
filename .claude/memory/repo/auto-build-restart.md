---
name: auto-build-restart
description: 代码修改后自动执行 pnpm build 并重启开发服务
metadata:
  type: project
---

# 代码修改后自动构建并重启服务

聪少偏好：在 cc-remote 项目中，每次代码修改完成后，自动执行构建（`pnpm build` 或项目对应的构建命令）并重启开发服务，而非仅修改文件后等待用户手动构建。

## 适用场景

- 修改 `packages/web/src/` 下的前端代码后
- 修改 `packages/server/` 下的后端代码后
- 任何需要构建才能生效的代码变更

## 执行方式

1. 代码修改完成并通过 code-review 后
2. 运行项目构建命令（如 `pnpm build`）
3. 重启开发服务（如 `pnpm dev` 或对应命令）
4. 确认服务正常启动无报错

## 注意

- 构建失败时应先修复构建错误，再重启服务
- 如项目使用 HMR（热模块替换），前端代码可能无需完整重启，但仍需确认构建通过
