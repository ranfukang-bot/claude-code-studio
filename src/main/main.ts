import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_SETTINGS,
  type AppStateFile,
  type ChangedFile,
  type EncryptedSecret,
  type HistoryItem,
  type InstallTarget,
  type SaveSetupRequest,
  type SetupOutputEvent,
  type StudioSettings,
  type SystemCheckItem,
  type SystemReport,
  type TaskDoneEvent,
  type TaskFilesEvent,
  type TaskOutputEvent,
  type TaskRequest,
  type TaskStatus
} from '@shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development'

let mainWindow: BrowserWindow | null = null
const runningTasks = new Map<string, { child: ChildProcessWithoutNullStreams; startedAt: number; projectPath: string }>()
const runningSetup = new Map<string, ChildProcessWithoutNullStreams>()
const outputBuffers = new Map<string, string>()
const lineBuffers = new Map<string, string>()

function statePath(): string {
  return path.join(app.getPath('userData'), 'studio-state.json')
}

function claudeUserSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

function defaultState(): AppStateFile {
  return {
    settings: { ...DEFAULT_SETTINGS },
    recentProjects: [],
    history: [],
    secrets: {},
    onboardingCompleted: false
  }
}

function readState(): AppStateFile {
  try {
    const file = statePath()
    if (!fs.existsSync(file)) return defaultState()
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AppStateFile>
    const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) }
    settings.apiKeySaved = Boolean(parsed.secrets?.anthropicApiKey?.value)
    return {
      settings,
      recentProjects: Array.isArray(parsed.recentProjects) ? parsed.recentProjects : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      secrets: parsed.secrets ?? {},
      onboardingCompleted: Boolean(parsed.onboardingCompleted)
    }
  } catch {
    return defaultState()
  }
}

function writeState(next: AppStateFile): AppStateFile {
  const file = statePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const settings = { ...DEFAULT_SETTINGS, ...next.settings }
  settings.apiKeySaved = Boolean(next.secrets?.anthropicApiKey?.value)
  const safeNext: AppStateFile = { ...next, settings }
  fs.writeFileSync(file, JSON.stringify(safeNext, null, 2), 'utf8')
  return safeNext
}

function updateHistory(id: string, patch: Partial<HistoryItem>): void {
  const state = readState()
  state.history = state.history.map((item) => (item.id === id ? { ...item, ...patch } : item)).slice(0, 200)
  writeState(state)
}

function encryptSecret(value: string): EncryptedSecret | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return {
        value: safeStorage.encryptString(trimmed).toString('base64'),
        encrypted: true,
        updatedAt: Date.now()
      }
    }
  } catch {
    // fall through to unsaved secret handling below
  }
  return { value: trimmed, encrypted: false, updatedAt: Date.now() }
}

function decryptSecret(secret?: EncryptedSecret): string {
  if (!secret?.value) return ''
  try {
    if (secret.encrypted) return safeStorage.decryptString(Buffer.from(secret.value, 'base64'))
    return secret.value
  } catch {
    return ''
  }
}

function sendOutput(event: TaskOutputEvent): void {
  const old = outputBuffers.get(event.taskId) ?? ''
  const next = (old + event.text).slice(-8000)
  outputBuffers.set(event.taskId, next)
  updateHistory(event.taskId, { outputPreview: next })
  mainWindow?.webContents.send('task:output', event)
}

function sendDone(event: TaskDoneEvent): void {
  updateHistory(event.taskId, {
    status: event.status,
    endedAt: Date.now(),
    outputPreview: outputBuffers.get(event.taskId) ?? ''
  })
  mainWindow?.webContents.send('task:done', event)
}

function sendFiles(event: TaskFilesEvent): void {
  updateHistory(event.taskId, { changedFiles: event.files })
  mainWindow?.webContents.send('task:files', event)
}

function sendSetup(event: SetupOutputEvent): void {
  mainWindow?.webContents.send('setup:output', event)
}

function normalizeClaudeJsonLine(line: string): { kind: TaskOutputEvent['kind']; text: string; raw?: unknown } {
  const trimmed = line.trim()
  if (!trimmed) return { kind: 'stdout', text: '' }

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed?.type === 'assistant') {
      const parts = parsed?.message?.content ?? parsed?.content ?? []
      const text = Array.isArray(parts)
        ? parts
            .map((part) => {
              if (typeof part === 'string') return part
              if (part?.type === 'text') return part.text
              if (part?.type === 'tool_use') return `\n[tool] ${part.name ?? 'tool'}\n`
              return ''
            })
            .filter(Boolean)
            .join('')
        : ''
      return { kind: 'stdout', text: text ? `${text}\n` : `${trimmed}\n`, raw: parsed }
    }

    if (parsed?.type === 'system') {
      const text = parsed.subtype ? `[system] ${parsed.subtype}` : '[system] session started'
      return { kind: 'system', text: `${text}\n`, raw: parsed }
    }

    if (parsed?.type === 'result') {
      const usage = parsed.total_cost_usd ? `\n[cost] $${Number(parsed.total_cost_usd).toFixed(4)}` : ''
      const result = parsed.result ?? parsed.message ?? '任务结束'
      return { kind: 'result', text: `\n[result] ${String(result)}${usage}\n`, raw: parsed }
    }

    if (parsed?.type === 'user') {
      return { kind: 'system', text: '[user message acknowledged]\n', raw: parsed }
    }

    return { kind: 'stdout', text: `${trimmed}\n`, raw: parsed }
  } catch {
    return { kind: 'stdout', text: `${line}\n` }
  }
}

function splitCommand(command: string): { commandName: string; extraArgs: string[] } {
  const pieces = command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((piece) => piece.replace(/^"|"$/g, '')) ?? []
  const [commandName = 'claude', ...extraArgs] = pieces
  return { commandName, extraArgs }
}

function buildClaudeArgs(request: TaskRequest): string[] {
  const { settings, mode, prompt } = request
  const args: string[] = []

  if (settings.useBareMode) args.push('--bare')
  if (settings.defaultModel.trim()) args.push('--model', settings.defaultModel.trim())

  const effectivePermissionMode = mode === 'plan' || mode === 'analyze' ? 'plan' : mode === 'auto' ? 'auto' : settings.permissionMode
  args.push('--permission-mode', effectivePermissionMode)

  if (Number.isFinite(settings.maxTurns) && settings.maxTurns > 0) args.push('--max-turns', String(settings.maxTurns))

  const budget = settings.maxBudgetUsd.trim()
  if (budget && !Number.isNaN(Number(budget))) args.push('--max-budget-usd', budget)

  if (settings.allowedTools.trim()) args.push('--tools', settings.allowedTools.trim())
  if (settings.appendSystemPrompt.trim()) args.push('--append-system-prompt', settings.appendSystemPrompt.trim())

  args.push('-p')
  args.push(modePrompt(mode, prompt))
  args.push('--output-format', 'stream-json')
  if (settings.includePartialMessages) args.push('--include-partial-messages')

  return args
}

function modePrompt(mode: TaskRequest['mode'], prompt: string): string {
  const base = prompt.trim()
  if (mode === 'analyze') {
    return ['你现在处于只读分析模式。不要修改文件，不要执行会改变项目状态的命令。', '请先阅读项目结构，然后给出清晰、可执行的分析结果。', '', base].join('\n')
  }
  if (mode === 'plan') {
    return ['你现在处于计划模式。除非用户明确要求，否则不要修改文件。', '请先给出实施步骤、风险点、需要修改的文件清单和验证方式。', '', base].join('\n')
  }
  if (mode === 'auto') {
    return ['你可以在合理范围内自动完成任务。修改前先理解项目，修改后尽量运行必要的检查。', '不要删除用户未要求删除的重要文件。遇到高风险操作先停止并说明。', '', base].join('\n')
  }
  return ['你可以根据任务修改代码。修改后请总结改动、影响范围和验证建议。', '', base].join('\n')
}

function appendRecentProject(projectPath: string): AppStateFile {
  const state = readState()
  state.recentProjects = [projectPath, ...state.recentProjects.filter((item) => item !== projectPath)].slice(0, 20)
  return writeState(state)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#0f172a',
    title: 'Claude Code Studio',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('state:get', async () => readState())

ipcMain.handle('settings:save', async (_event, settings: StudioSettings) => {
  const state = readState()
  state.settings = { ...DEFAULT_SETTINGS, ...settings, apiKeySaved: Boolean(state.secrets?.anthropicApiKey?.value) }
  return writeState(state)
})

ipcMain.handle('setup:check', async () => runSystemCheck())

ipcMain.handle('setup:save', async (_event, request: SaveSetupRequest) => {
  const state = readState()
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...state.settings,
    providerType: request.providerType,
    apiBaseUrl: request.apiBaseUrl?.trim() ?? '',
    defaultModel: request.defaultModel.trim() || 'sonnet',
    permissionMode: request.permissionMode,
    useBareMode: request.useBareMode,
    saveModelToClaudeSettings: request.saveModelToClaudeSettings
  }

  if (typeof request.apiKey === 'string' && request.apiKey.trim()) {
    state.secrets = { ...(state.secrets ?? {}), anthropicApiKey: encryptSecret(request.apiKey) }
  }
  state.settings.apiKeySaved = Boolean(state.secrets?.anthropicApiKey?.value)
  state.onboardingCompleted = true
  const saved = writeState(state)

  if (request.saveModelToClaudeSettings) {
    writeClaudeUserSettings({ model: saved.settings.defaultModel, defaultMode: saved.settings.permissionMode })
  }

  sendSetup({ target: 'config', kind: 'success', text: '配置已保存。API Key 只保存在本机应用数据中，运行 Claude Code 时通过环境变量传入。\n', timestamp: Date.now() })
  return saved
})

ipcMain.handle('setup:install', async (_event, target: InstallTarget) => installTarget(target))

ipcMain.handle('setup:open-external', async (_event, url: string) => {
  await shell.openExternal(url)
  return true
})

ipcMain.handle('dialog:select-project', async () => {
  const result = await dialog.showOpenDialog({ title: '选择项目文件夹', properties: ['openDirectory'] })
  if (result.canceled || !result.filePaths[0]) return null
  appendRecentProject(result.filePaths[0])
  return result.filePaths[0]
})

ipcMain.handle('project:add-recent', async (_event, projectPath: string) => appendRecentProject(projectPath))

ipcMain.handle('shell:open-path', async (_event, targetPath: string) => {
  const err = await shell.openPath(targetPath)
  return !err
})

ipcMain.handle('shell:reveal-path', async (_event, targetPath: string) => {
  shell.showItemInFolder(targetPath)
  return true
})

ipcMain.handle('history:clear', async () => {
  const state = readState()
  state.history = []
  return writeState(state)
})

ipcMain.handle('project:git-status', async (_event, projectPath: string) => getGitStatus(projectPath))

ipcMain.handle('task:run', async (_event, request: TaskRequest) => {
  if (!request.projectPath || !fs.existsSync(request.projectPath)) return { ok: false, error: '项目目录不存在。' }
  if (!request.prompt.trim()) return { ok: false, error: '任务内容不能为空。' }
  if (runningTasks.size > 0) return { ok: false, error: '已有任务正在运行。第一版为了安全，默认同一时间只跑一个任务。' }

  const state = readState()
  const runtimeSettings: StudioSettings = { ...DEFAULT_SETTINGS, ...state.settings, ...request.settings }

  if (runtimeSettings.runPreflightBeforeTask) {
    const report = await runSystemCheck()
    if (!report.ready) return { ok: false, error: '环境还没配置完整。请先到启动检查里安装 Claude Code，并配置 API Key/模型。' }
  }

  const { commandName, extraArgs } = splitCommand(runtimeSettings.claudeCommand || 'claude')
  const args = [...extraArgs, ...buildClaudeArgs({ ...request, settings: runtimeSettings })]
  const startedAt = Date.now()
  outputBuffers.set(request.id, '')
  lineBuffers.set(request.id, '')

  const historyItem: HistoryItem = {
    id: request.id,
    projectPath: request.projectPath,
    prompt: request.prompt,
    mode: request.mode,
    status: 'running',
    startedAt,
    outputPreview: ''
  }
  state.history = [historyItem, ...state.history].slice(0, 200)
  state.recentProjects = [request.projectPath, ...state.recentProjects.filter((item) => item !== request.projectPath)].slice(0, 20)
  writeState(state)

  sendOutput({
    taskId: request.id,
    kind: 'system',
    text: `$ ${commandName} ${args.map((arg) => (arg.includes(' ') ? `"${arg.slice(0, 80)}${arg.length > 80 ? '…' : ''}"` : arg)).join(' ')}\n\n`,
    timestamp: Date.now()
  })

  try {
    const child = spawn(commandName, args, {
      cwd: request.projectPath,
      shell: process.platform === 'win32',
      env: buildRuntimeEnv(runtimeSettings)
    })

    runningTasks.set(request.id, { child, startedAt, projectPath: request.projectPath })
    child.stdout.on('data', (data: Buffer) => handleChunk(request.id, data.toString('utf8'), false))
    child.stderr.on('data', (data: Buffer) => handleChunk(request.id, data.toString('utf8'), true))

    child.on('error', (error) => {
      runningTasks.delete(request.id)
      sendOutput({ taskId: request.id, kind: 'error', text: `\n[启动失败] ${error.message}\n`, timestamp: Date.now() })
      sendDone({ taskId: request.id, status: 'error', exitCode: null, signal: null, durationMs: Date.now() - startedAt, error: error.message })
    })

    child.on('close', async (code, signal) => {
      runningTasks.delete(request.id)
      flushLineBuffer(request.id)
      const wasStopped = signal === 'SIGTERM' || signal === 'SIGKILL'
      const status: TaskStatus = wasStopped ? 'stopped' : code === 0 ? 'success' : 'error'
      const filesResult = await getGitStatus(request.projectPath)
      if (filesResult.files.length > 0) sendFiles({ taskId: request.id, files: filesResult.files })
      sendDone({ taskId: request.id, status, exitCode: code, signal, durationMs: Date.now() - startedAt, error: status === 'error' ? `Claude Code 退出码：${code ?? 'unknown'}` : undefined })
    })

    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendDone({ taskId: request.id, status: 'error', exitCode: null, signal: null, durationMs: Date.now() - startedAt, error: message })
    return { ok: false, error: message }
  }
})

ipcMain.handle('task:stop', async (_event, taskId: string) => {
  const task = runningTasks.get(taskId)
  if (!task) return { ok: false, error: '没有正在运行的任务。' }
  task.child.kill('SIGTERM')
  return { ok: true }
})

function buildRuntimeEnv(settings: StudioSettings): NodeJS.ProcessEnv {
  const state = readState()
  const apiKey = decryptSecret(state.secrets?.anthropicApiKey)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    CLAUDE_CODE_STUDIO: '1',
    HOME: process.env.HOME ?? os.homedir(),
    USERPROFILE: process.env.USERPROFILE ?? os.homedir()
  }

  if (apiKey) env.ANTHROPIC_API_KEY = apiKey
  if (settings.defaultModel.trim()) env.ANTHROPIC_MODEL = settings.defaultModel.trim()
  if (settings.providerType === 'custom' && settings.apiBaseUrl.trim()) env.ANTHROPIC_BASE_URL = settings.apiBaseUrl.trim()

  return env
}

async function runSystemCheck(): Promise<SystemReport> {
  const state = readState()
  const settings = state.settings
  const checks: SystemCheckItem[] = []

  const node = await commandVersion('node', ['--version'])
  checks.push({ key: 'node', label: 'Node.js', status: node.ok ? 'ok' : 'missing', version: node.stdout.trim(), message: node.ok ? `已安装 ${node.stdout.trim()}` : '未检测到 Node.js。打包后的用户一般不需要它，但开发/调试和部分安装流程会用到。', fixTarget: node.ok ? undefined : 'node' })

  const npm = await commandVersion('npm', ['--version'])
  checks.push({ key: 'npm', label: 'npm', status: npm.ok ? 'ok' : 'warning', version: npm.stdout.trim(), message: npm.ok ? `已安装 ${npm.stdout.trim()}` : '未检测到 npm。开发模式需要 npm install；普通 exe 用户通常不需要。' })

  const git = await commandVersion('git', ['--version'])
  checks.push({ key: 'git', label: 'Git / Git Bash', status: git.ok ? 'ok' : 'warning', version: git.stdout.trim(), message: git.ok ? git.stdout.trim() : '未检测到 Git。Claude Code 在 Windows 上可退回 PowerShell，但 Git for Windows 更推荐。', fixTarget: git.ok ? undefined : 'git' })

  const { commandName, extraArgs } = splitCommand(settings.claudeCommand || 'claude')
  const claude = await commandVersion(commandName, [...extraArgs, '--version'])
  checks.push({ key: 'claude', label: 'Claude Code CLI', status: claude.ok ? 'ok' : 'missing', version: claude.stdout.trim(), message: claude.ok ? `已安装 ${claude.stdout.trim()}` : '未检测到 Claude Code CLI。点击安装后会调用官方安装脚本。', fixTarget: claude.ok ? undefined : 'claude' })

  const apiKey = decryptSecret(state.secrets?.anthropicApiKey)
  const auth = claude.ok ? await commandVersion(commandName, [...extraArgs, 'auth', 'status', '--text'], 10000) : { ok: false, stdout: '', stderr: 'Claude not installed', code: null }
  const hasAuth = auth.ok || Boolean(apiKey)
  checks.push({ key: 'auth', label: '账号/API 配置', status: hasAuth ? 'ok' : 'missing', message: hasAuth ? (apiKey ? '已保存 API Key，可由后台 Claude Code 使用。' : 'Claude Code 已登录。') : '未登录，也未保存 API Key。请在配置向导中粘贴自己的 Anthropic API Key 或第三方兼容 Key。' })

  const detectedClaudeSettings = readClaudeUserSettings()
  const model = settings.defaultModel || String(detectedClaudeSettings?.model ?? '')
  checks.push({ key: 'model', label: '模型选择', status: model ? 'ok' : 'missing', message: model ? `当前模型：${model}` : '尚未选择模型。建议普通用户默认 sonnet。' })

  const ready = Boolean(claude.ok && hasAuth && model)
  return {
    platform: process.platform,
    arch: process.arch,
    userDataPath: app.getPath('userData'),
    appSettingsPath: statePath(),
    claudeUserSettingsPath: claudeUserSettingsPath(),
    ready,
    checks,
    detectedClaudeSettings
  }
}

function commandVersion(commandName: string, args: string[], timeoutMs = 8000): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    let done = false
    let stdout = ''
    let stderr = ''
    const child = spawn(commandName, args, { shell: process.platform === 'win32', env: { ...process.env, HOME: process.env.HOME ?? os.homedir() } })
    const timer = setTimeout(() => {
      if (done) return
      done = true
      child.kill('SIGTERM')
      resolve({ ok: false, stdout, stderr: stderr || 'timeout', code: null })
    }, timeoutMs)
    child.stdout.on('data', (data: Buffer) => (stdout += data.toString('utf8')))
    child.stderr.on('data', (data: Buffer) => (stderr += data.toString('utf8')))
    child.on('error', (error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ok: false, stdout, stderr: error.message, code: null })
    })
    child.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code })
    })
  })
}

function installTarget(target: InstallTarget): Promise<{ ok: boolean; error?: string }> {
  if (runningSetup.size > 0) return Promise.resolve({ ok: false, error: '已有安装任务正在运行。' })
  const spec = installSpec(target)
  sendSetup({ target, kind: 'system', text: `$ ${spec.command} ${spec.args.join(' ')}\n`, timestamp: Date.now() })

  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, { shell: process.platform === 'win32', env: { ...process.env, HOME: process.env.HOME ?? os.homedir() } })
    runningSetup.set(target, child)
    child.stdout.on('data', (data: Buffer) => sendSetup({ target, kind: 'stdout', text: data.toString('utf8'), timestamp: Date.now() }))
    child.stderr.on('data', (data: Buffer) => sendSetup({ target, kind: 'stderr', text: data.toString('utf8'), timestamp: Date.now() }))
    child.on('error', (error) => {
      runningSetup.delete(target)
      sendSetup({ target, kind: 'error', text: `启动安装失败：${error.message}\n`, timestamp: Date.now() })
      resolve({ ok: false, error: error.message })
    })
    child.on('close', (code) => {
      runningSetup.delete(target)
      if (code === 0) {
        sendSetup({ target, kind: 'success', text: '安装命令已完成。建议重新执行一次环境检查。\n', timestamp: Date.now() })
        resolve({ ok: true })
      } else {
        const message = `安装命令退出码：${code ?? 'unknown'}。如果是权限或网络问题，请手动安装后再检查。`
        sendSetup({ target, kind: 'error', text: `${message}\n`, timestamp: Date.now() })
        resolve({ ok: false, error: message })
      }
    })
  })
}

function installSpec(target: InstallTarget): { command: string; args: string[] } {
  const isWin = process.platform === 'win32'
  if (target === 'claude') {
    if (isWin) return { command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'] }
    return { command: 'bash', args: ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'] }
  }
  if (target === 'node') {
    if (isWin) return { command: 'winget', args: ['install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--source', 'winget'] }
    if (process.platform === 'darwin') return { command: 'bash', args: ['-lc', 'command -v brew >/dev/null && brew install node || open https://nodejs.org/'] }
    return { command: 'bash', args: ['-lc', 'command -v apt >/dev/null && sudo apt update && sudo apt install -y nodejs npm || xdg-open https://nodejs.org/'] }
  }
  if (isWin) return { command: 'winget', args: ['install', '--id', 'Git.Git', '-e', '--source', 'winget'] }
  if (process.platform === 'darwin') return { command: 'bash', args: ['-lc', 'command -v brew >/dev/null && brew install git || xcode-select --install'] }
  return { command: 'bash', args: ['-lc', 'command -v apt >/dev/null && sudo apt update && sudo apt install -y git || xdg-open https://git-scm.com/downloads'] }
}

function readClaudeUserSettings(): Record<string, unknown> {
  try {
    const file = claudeUserSettingsPath()
    if (!fs.existsSync(file)) return {}
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeClaudeUserSettings(update: { model?: string; defaultMode?: string }): void {
  const file = claudeUserSettingsPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const current = readClaudeUserSettings()
  if (fs.existsSync(file)) {
    const backup = `${file}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`
    try {
      fs.copyFileSync(file, backup)
    } catch {
      // ignore backup failure
    }
  }
  const next: Record<string, unknown> = {
    '$schema': 'https://json.schemastore.org/claude-code-settings.json',
    ...current
  }
  if (update.model) next.model = update.model
  if (update.defaultMode) next.defaultMode = update.defaultMode
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
}

function handleChunk(taskId: string, chunk: string, isStderr: boolean): void {
  if (isStderr) {
    sendOutput({ taskId, kind: 'stderr', text: chunk, timestamp: Date.now() })
    return
  }
  const existing = lineBuffers.get(taskId) ?? ''
  const combined = existing + chunk
  const lines = combined.split(/\r?\n/)
  lineBuffers.set(taskId, lines.pop() ?? '')
  for (const line of lines) {
    const normalized = normalizeClaudeJsonLine(line)
    if (!normalized.text) continue
    sendOutput({ taskId, kind: normalized.kind, text: normalized.text, raw: normalized.raw, timestamp: Date.now() })
  }
}

function flushLineBuffer(taskId: string): void {
  const rest = lineBuffers.get(taskId)
  if (!rest) return
  const normalized = normalizeClaudeJsonLine(rest)
  if (normalized.text) sendOutput({ taskId, kind: normalized.kind, text: normalized.text, raw: normalized.raw, timestamp: Date.now() })
  lineBuffers.delete(taskId)
}

async function getGitStatus(projectPath: string): Promise<{ files: ChangedFile[]; error?: string }> {
  if (!projectPath || !fs.existsSync(projectPath)) return { files: [], error: '项目路径不存在。' }
  return new Promise((resolve) => {
    const child = spawn('git', ['status', '--short'], { cwd: projectPath, shell: process.platform === 'win32', env: { ...process.env, HOME: process.env.HOME ?? os.homedir() } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data: Buffer) => (stdout += data.toString('utf8')))
    child.stderr.on('data', (data: Buffer) => (stderr += data.toString('utf8')))
    child.on('error', (error) => resolve({ files: [], error: error.message }))
    child.on('close', (code) => {
      if (code !== 0) return resolve({ files: [], error: stderr.trim() || '当前目录可能不是 Git 仓库。' })
      const files = stdout
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3).trim() }))
      resolve({ files })
    })
  })
}
