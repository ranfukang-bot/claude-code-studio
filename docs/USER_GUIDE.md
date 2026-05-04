# Claude Code Studio 使用说明

## 面向普通用户

1. 双击 `Claude Code Studio.exe`。
2. 进入“启动检查”。
3. 如果没有 Claude Code，点击“自动安装/修复”。
4. 选择服务类型：
   - Anthropic 官方 API
   - Anthropic-compatible 第三方接口
5. 选择模型，普通用户建议 `sonnet`。
6. 粘贴自己的 API Key。
7. 点击“保存配置并进入 UI”。
8. 选择项目文件夹，输入需求，点击“开始执行”。

## 安全说明

- API Key 只保存在当前电脑的应用数据目录中。
- 应用不会把 API Key 写入项目文件。
- 运行任务时，API Key 通过环境变量临时传给后台 Claude Code 进程。
- 给别人分发时，不要内置你自己的 API Key。

## 自动安装能力

应用会尝试自动检查：

- Node.js
- npm
- Git / Git Bash
- Claude Code CLI
- Claude Code 登录状态或 API Key
- 模型配置

Windows 下安装 Claude Code 时，应用会调用官方 PowerShell 安装脚本：

```powershell
irm https://claude.ai/install.ps1 | iex
```

Node.js / Git 会优先尝试使用 `winget` 安装。如果用户电脑没有 winget 或权限不足，需要手动安装。
