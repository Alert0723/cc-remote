# Changelog

All notable changes to CC Remote will be documented in this file.

## [0.1.0] - 2026-06-27

### Added

- 🎉 初始版本发布
- QR 码扫码连接（手机相机扫码即连）
- 实时流式输出（Claude Code stream-json → WebSocket → 手机端 token 级渲染）
- 权限审批弹窗（allow / deny / allow_always），60s 超时自动拒绝
- AskUserQuestion MCP 工具支持（AI 提问弹窗 + 选项选择）
- 多会话管理（spawn 全控制 + attach 只读监控双模式）
- JSONL 文件增量监听（chokidar），实时推送历史消息变更
- RingBuffer 断线恢复（sync_from 协议 + 事件重放）
- 会话状态持久化（热重启保存/恢复）
- 构建产物变更自动热重启（含看门狗 + 10 次重试）
- 多设备状态同步（pending_resolved 事件广播）
- 暗/亮主题切换
- 调试模式（前台/后台原始 JSON 事件流）
- 优雅关闭（SIGINT/SIGTERM 保存状态后退出）
- WebSocket 心跳检测（30s ping-pong 清理僵尸连接）
- 过期会话自动清理（>3 天 stopped 会话）
- MCP 服务器配置自动继承
- HTTP/WebSocket 双通道消息发送（WS 优先 + HTTP 降级）
- Fastify 内置静态文件托管 Web 前端
- UUID Token 认证（WS auth 消息 + HTTP Bearer）
- 控制台命令交互（restart / quit / sessions / help）
