# dsh-header-controls

> 会话右上角电源控制：Session log 左侧的「重启 / 注销」胶囊按钮，与官方版式一致（静态 web 插件）
>
> Power controls for the DeepSeek Harness conversation header — "Restart / Exit" capsule buttons next to the session log, styled after the official `dsh-session-log-export` header action.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## ✨ 特性 / Features

- **重启一键直达**（无需二次确认）：优雅退出当前 dsh 进程，由纯 Node 助手经 launcher 配置重新拉起服务，页面轮询到服务恢复后**自动刷新**，不新开标签页
- **注销两步确认**：关闭整个 dsh 进程（等同官方电源按钮的作用），再次启动可双击桌面快捷方式
- **纯 Node 重启助手**（`lib/relaunch-helper.cjs`）：零 PowerShell、零第三方依赖；延迟等待旧进程退出 → `netstat` 查端口兜底 `taskkill` → 读 `launcher.config.json` 重新拉起 → 轮询端口就绪（可选）打开浏览器
- **maid-atelier 皮肤感知**：检测 `data-dsh-maid-atelier` 属性自动切换深海蓝 + 柔金描边配色，无皮肤时恢复默认胶囊样式
- **CSRF 防护**：宿主路由仅允许 loopback + 自定义请求头 `x-dsh-header-controls: 1`

## 📦 安装 / Installation

> 适用于 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（dev preview 0.1.0-rc.x，`web` profile）。

1. 克隆或下载本仓库：

   ```bash
   git clone https://github.com/kgwdonkey/dsh-header-controls.git
   ```

2. 将插件链接到 dsh 的 profile node_modules（Windows 用 `mklink /J`，Linux/macOS 用 `ln -s`）：

   ```bash
   # 以 Windows 为例（需管理员或开发者模式）
   mklink /J "%USERPROFILE%\.dsh\profiles\node_modules\dsh-header-controls" "<克隆到的路径>"
   ```

3. 在 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml` 追加注册（如果尚未存在）：

   ```yaml
   # 追加到现有数组末尾
   - $insert: node_modules/dsh-header-controls/lib/index.js
   ```

4. 重启 dsh，会话页右上角（Session log 左侧）出现「重启 / 注销」按钮。

> 💡 也可以使用本地的 dsh-plugin-manager（如有）在「设置 → 插件 → 插件管理」中安装管理。

## 🚀 使用 / Usage

| 按钮 | 行为 |
|---|---|
| 重启 | 点击即触发：服务退出 → 自动重新拉起 → 页面自动刷新（约 10~30 秒，取决于启动速度） |
| 注销 | 第一次点击进入确认态（按钮变红），再点一次确认关闭 dsh |

## ⚙️ 配置 / Configuration

重启助手从 `%LOCALAPPDATA%\DeepSeekHarness\launcher.config.json` 读取启动参数：

```json
{
  "node": "node 可执行文件路径",
  "repo": "dsh 仓库目录（含 apps/cli/lib/bin.js）",
  "profile": "web",
  "port": 3080,
  "host": "127.0.0.1"
}
```

缺失该文件时回退默认值：`node=process.execPath`、`repo=$env:DSH_REPO`、`profile=web`、`port=3080`、`host=127.0.0.1`；若 dsh 无预构建产物，则回退系统 `dsh` 命令垫片启动。

## 🧩 工作原理 / How it works

- **宿主半**（`lib/index.js`）：注入 `webServer`，注册 `/dsh-header-controls/restart` 与 `/dsh-header-controls/exit` 两个精确路由（loopback + 自定义头双重校验）。重启时先清除插件管理器的「待重启」标记，再 spawn 分离式 Node 助手（`detached` + `unref`），1.5 秒后 `appExit(0)` 优雅退出。
- **客户端半**（`lib/client.js`）：注入 `conversation.session.header.utilities` 插槽（`order: -10`，位于 Session log 左侧），实现胶囊按钮、两步确认、5 秒防误触、皮肤感知与重启后轮询刷新。
- **重启助手**（`lib/relaunch-helper.cjs`）：延迟 → 端口兜底杀进程 → 按配置拉起新进程（日志落盘 `dsh-server.log` / `dsh-server.err.log`、写 pid 文件 `dsh-server.pid`）→ 轮询端口就绪。

## 📄 许可证 / License

[MIT](LICENSE) © 2026 kgwdonkey
