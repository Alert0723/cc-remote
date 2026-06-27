# CC Remote

> 📱 在手机上远程控制你的 Claude Code 会话 —— 扫码即连，实时同步。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)

---

## 这是什么？

**CC Remote** 让你在手机上远程操控 PC 端运行的 Claude Code 会话。PC 端启动服务后会在终端显示一个 **二维码**，用手机相机扫码即自动连接。连接后，你可以：

- 💬 在手机上**发送消息**给 Claude Code，像聊天一样编程
- 👁️ **实时观看** Claude Code 的流式输出（代码、工具调用、思考过程）
- ✅ **远程审批** Bash 命令、文件写入等权限请求
- 📋 **回答提问** —— Claude Code 在手机上弹出选择题时，点一下即可选择
- 🔄 **多会话管理** —— 同时接管多个 Claude Code 对话，随时切换

## 快速开始

### 前提条件

- **PC 端**：已安装 [Claude Code](https://claude.ai/code) CLI
- **手机端**：现代浏览器（iOS Safari / Android Chrome 均可）
- PC 和手机在**同一局域网**内

### 1. 在 PC 端启动服务

```bash
cd your-project
npx cc-remote
```

终端会显示一个二维码：

```
=== CC Remote ===

手机端扫码连接：

  █████████████████████████████
  ████  ██  ████  ████  ██████
  ████  ██  ████  ████  ██████
  █████████████████████████████
  ...
  
或手动访问: http://192.168.1.100:8420?server=http://...
```

### 2. 手机扫码连接

用手机相机拍下终端里的二维码，点击链接在浏览器中打开即可自动连接。

### 3. 开始对话

连接成功后，你会看到：
- 顶部「**会话**」按钮 —— 管理多个 Claude Code 对话
- 中间**消息区** —— 实时显示 Claude Code 的流式输出
- 底部**输入框** —— 发送消息

### 从源码构建启动

> 如果你 clone 了本仓库但还没构建，使用项目根目录下的脚本即可一键搞定。

| 脚本 | 平台 | 说明 |
|------|------|------|
| `install-cc-remote.bat` / `.sh` | Windows / macOS & Linux | 检查 Node.js / pnpm → 安装依赖 → 构建 |
| `rebuild-cc-remote.bat` / `.sh` | Windows / macOS & Linux | 拉取最新代码 + 重新构建（用于更新） |
| `start-cc-remote.bat` / `.sh` | Windows / macOS & Linux | 启动服务（`node dist/startup.js`） |

**首次使用：**

```bash
# Windows：双击运行
install-cc-remote.bat
# 构建完成后启动
start-cc-remote.bat

# macOS / Linux：
bash install-cc-remote.sh
bash start-cc-remote.sh
```

后续更新只需运行 `rebuild-cc-remote.bat`（或 `.sh`），然后重新启动。

## 功能一览

| 功能 | 说明 |
|------|------|
| 🔗 **扫码连接** | PC 端显示 QR 码，手机相机扫码即连 |
| 💬 **实时流式** | Claude Code 输出逐字推送，所见即所得 |
| ⚡ **双向控制** | 发送消息 / 中断生成 / 权限审批 / AI 提问回答 |
| 📂 **多会话** | 同时管理多个 Claude Code 对话，随时切换 |
| 🔌 **断线恢复** | 网络断开后自动重连，不丢消息 |
| 🌗 **暗/亮主题** | 跟随系统或手动切换 |
| 🔄 **热重启** | 服务端代码更新后自动保存状态并重启，手机端无感 |
| 🛡️ **Token 认证** | 随机生成的 UUID Token，防止局域网内未授权访问 |
| 🔍 **调试模式** | 查看原始 JSON 事件流，方便排查问题 |

## 工作原理

```
┌──────────────┐           ┌──────────────────┐           ┌──────────────┐
│   手机浏览器   │ ◄─ WS ─► │  CC Remote Server │ ◄─ pipe ─► │  Claude Code │
│  (React SPA)  │           │  (Node.js + WS)   │           │  (CLI 进程)   │
└──────────────┘           └──────────────────┘           └──────────────┘
                                    │
                                    ├─ HTTP/WS 端口 8420
                                    ├─ Token 认证
                                    └─ RingBuffer (断线恢复)
```

1. CC Remote Server 以 `stream-json` 模式启动 Claude Code 子进程
2. Claude Code 的每行 stdout 输出被解析为结构化事件（token / tool_use / tool_result / permission_request）
3. 事件通过 WebSocket 实时推送到手机浏览器
4. 手机端发送的消息/审批/回答通过 WebSocket 转发到 Claude Code 的 stdin
5. 进程退出后自动 --resume 恢复，会话状态持久化到磁盘

## 命令参考

服务启动后在终端中输入以下命令：

| 命令 | 别名 | 说明 |
|------|------|------|
| `restart` | `rs` | 热重启（保存状态后重启） |
| `quit` | `q` | 优雅关闭 |
| `sessions` | — | 列出当前已连接会话 |
| `help` | `h` | 显示帮助 |

## 安全模型

- **局域网隔离**：服务仅监听局域网 IP，不暴露到公网
- **UUID Token 认证**：首次启动自动生成 128 位随机 Token，存于 `~/.cc-remote/config.json`
- **WebSocket 认证**：客户端连接后首条消息必须是 `auth` 指令，携带正确 Token
- **HTTP 认证**：所有 `/api/` 路由要求 `Authorization: Bearer <token>` 头
- **无持久凭据泄露**：Token 仅存在于二维码 URL 中，手机扫码后存于浏览器内存
- ⚠️ **适用前提**：假定局域网环境可信。不建议在公共 Wi-Fi 等不受信任的网络中使用

## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Node.js 22+ |
| 语言 | TypeScript 5.7 |
| 前端 | React 19 + Zustand |
| 构建 | Vite (web) / tsup (server, shared) |
| 后端 | Fastify + ws |
| 包管理 | pnpm 9 + Turborepo |
| 测试 | Vitest |

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式（热重载）
pnpm dev

# 构建所有包
pnpm build

# 运行测试
pnpm test

# 类型检查
pnpm typecheck

# 代码检查
pnpm lint
```

## License

[MIT](LICENSE) © 2026 Cong Huang
