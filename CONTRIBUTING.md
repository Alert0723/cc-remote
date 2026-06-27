# Contributing to CC Remote

感谢你的贡献兴趣！这份指南会帮你快速上手。

## 环境搭建

### 前提条件

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 9+
- [Claude Code](https://claude.ai/code) CLI（用于本地调试）

### 克隆并安装

```bash
git clone https://github.com/conghuang/cc-remote.git
cd cc-remote
pnpm install
```

### 开发命令

```bash
pnpm dev        # 开发模式（热重载）
pnpm build      # 构建所有包
pnpm test       # 运行测试
pnpm lint       # 代码检查
pnpm typecheck  # 类型检查
```

## 项目结构

CC Remote 是一个 pnpm monorepo，使用 Turborepo 编排：

```
packages/
├── shared/     # 通信协议类型（@cc-remote/shared）
├── server/     # Node.js 服务端（@cc-remote/server）
└── web/        # React 移动端前端（@cc-remote/web）
```

详见 [README.md](./README.md#项目结构) 中的完整文件说明。

## 开发流程

1. **Fork** 本仓库
2. 从 `main` 分支创建你的 Feature 分支：`git checkout -b feature/my-feature`
3. 编写代码，确保：
   - `pnpm typecheck` 通过
   - `pnpm lint` 通过
   - `pnpm test` 通过
   - 新增功能有对应的测试覆盖
4. 提交 PR 到 `main` 分支

## 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
type(scope): description

feat(server): 新增 MCP 工具审批提示
fix(web): 修复 iOS Safari 主题切换白屏
refactor(shared): 提取 AskUserQuestion 检测函数
test(server): 补充 SessionManager 单元测试
docs: 更新 README 安装说明
```

## 代码风格

- **语言**：注释和文档使用中文，标识符和 API 名称保留英文
- **类型**：所有公共接口必须有 TypeScript 类型定义
- **格式化**：使用 Prettier（已配置）
- **命名**：跟随 TypeScript 惯例（camelCase / PascalCase）

## 测试

```bash
# 运行所有测试
pnpm test

# 运行单个包的测试
cd packages/server && npx vitest run
cd packages/shared && npx vitest run

# 监视模式
cd packages/server && npx vitest
```

## 本地调试

1. 在 PC 端启动服务：
```bash
cd packages/server && npx tsx src/index.ts
```

2. 在手机浏览器中打开 PC 端显示的 URL（或扫码）

3. 查看控制台日志确认连接状态

## 提问

如有任何问题，请在 [GitHub Issues](https://github.com/conghuang/cc-remote/issues) 中提出。
