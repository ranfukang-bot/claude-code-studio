# Claude Code Studio

一个把 Claude Code CLI 包装成可视化桌面软件的 Electron 项目。

它的目标不是给会命令行的人“套一层聊天框”，而是给普通用户一个真正的一键入口：

> 双击 exe → 自动检查环境 → 缺什么装什么 → 配置 API 和模型 → 进入可视化 UI → 后台调用 Claude Code 工作。

## 已实现功能

- Electron + React + TypeScript + Tailwind 桌面 UI
- 启动检查向导
  - 检查 Node.js
  - 检查 npm
  - 检查 Git / Git Bash
  - 检查 Claude Code CLI
  - 检查账号/API Key
  - 检查模型配置
- 自动安装入口
  - Windows 调用官方 Claude Code PowerShell 安装脚本
  - macOS/Linux 调用官方 shell 安装脚本
  - Windows 下可尝试用 winget 安装 Node.js/Git
- API/模型配置向导
  - Anthropic 官方 API
  - Anthropic-compatible 第三方接口
  - 模型选择：sonnet / opus / haiku / opusplan / best
  - API Key 本机保存，不写入项目文件
- 可视化任务工作台
  - 选择项目目录
  - 输入任务
  - 只读分析 / 计划模式 / 允许修改 / 自动执行
  - 后台调用 `claude -p --output-format stream-json`
  - 实时输出
  - 任务历史
  - Git 文件变更列表
- 高级设置
  - Claude 命令路径
  - permission mode
  - 最大轮数
  - 预算上限
  - 工具限制
  - append system prompt

## 开发运行

```bash
npm install
npm run dev
```

## Windows 打包

```bash
npm run pack:win
```

打包结果在 `release/` 目录。

也可以在 Windows PowerShell 里执行：

```powershell
./scripts/build-win.ps1
```

## GitHub Actions 打包

项目内置 `.github/workflows/build-windows.yml`。推送 tag 或手动触发 workflow 后，会产出 Windows exe artifact。

## 设计原则

1. 不魔改 Claude Code 本体。
2. 不共享开发者自己的账号或 API Key。
3. 每个用户使用自己的 Claude/API 配置。
4. 前台只暴露 UI，后台才调用 CLI。
5. 默认保守权限，自动执行能力需要用户主动选择。

## 注意

自动安装依赖可能受到系统权限、网络、winget 可用性、杀毒软件策略影响。安装失败时，应用会展示日志，用户可以手动安装后重新检查。

详见：[docs/USER_GUIDE.md](docs/USER_GUIDE.md)
