import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clipboard,
  Code2,
  Download,
  ExternalLink,
  FolderOpen,
  History,
  KeyRound,
  Loader2,
  MonitorCog,
  Play,
  RefreshCw,
  Rocket,
  Save,
  Settings,
  Shield,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Wand2,
  XCircle
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  DEFAULT_SETTINGS,
  MODEL_OPTIONS,
  type AppStateFile,
  type ChangedFile,
  type CheckStatus,
  type HistoryItem,
  type InstallTarget,
  type ProviderType,
  type SetupOutputEvent,
  type StudioSettings,
  type SystemCheckItem,
  type SystemReport,
  type TaskDoneEvent,
  type TaskFilesEvent,
  type TaskMode,
  type TaskOutputEvent,
  type TaskStatus
} from '@shared/types'

const modeCards: Array<{ mode: TaskMode; title: string; desc: string; icon: typeof Shield }> = [
  { mode: 'analyze', title: '只读分析', desc: '适合看项目、查问题、生成建议，不主动改文件。', icon: Shield },
  { mode: 'plan', title: '计划模式', desc: '先拆方案、列文件、列风险，适合大改前审一遍。', icon: Clipboard },
  { mode: 'edit', title: '允许修改', desc: '让 Claude Code 直接改代码，适合明确的小任务。', icon: Code2 },
  { mode: 'auto', title: '自动执行', desc: '更主动地完成任务和检查，适合你信任的项目。', icon: Wand2 }
]

const promptTemplates = [
  '分析这个项目的结构，告诉我如何安装、运行、打包，并指出最值得优化的地方。',
  '帮我修复当前项目的 TypeScript / ESLint / 构建报错，修完后说明改了哪些文件。',
  '帮我给这个项目补一个专业 README，包括功能、安装、使用、配置、截图占位、路线图。',
  '帮我检查这个项目的安全风险，重点看命令执行、文件读写、密钥泄露、权限边界。',
  '帮我把这个项目做成更适合开源展示的结构，包含清晰目录、文档和示例。'
]

function createTaskId(): string {
  if ('randomUUID' in crypto) return crypto.randomUUID()
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function statusLabel(status: TaskStatus): string {
  const map: Record<TaskStatus, string> = { idle: '空闲', running: '运行中', success: '完成', error: '失败', stopped: '已停止' }
  return map[status]
}

function checkStatusText(status: CheckStatus): string {
  return status === 'ok' ? '已就绪' : status === 'missing' ? '缺失' : status === 'warning' ? '建议处理' : '未知'
}

function formatTime(ts?: number): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString()
}

function shortPath(value: string): string {
  if (!value) return '尚未选择项目'
  const normalized = value.replaceAll('\\', '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 3) return value
  return `…/${parts.slice(-3).join('/')}`
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export default function App(): JSX.Element {
  const [settings, setSettings] = useState<StudioSettings>(DEFAULT_SETTINGS)
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [projectPath, setProjectPath] = useState('')
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<TaskMode>('analyze')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskStatus, setTaskStatus] = useState<TaskStatus>('idle')
  const [output, setOutput] = useState<TaskOutputEvent[]>([])
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(true)
  const [message, setMessage] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [setupReport, setSetupReport] = useState<SystemReport | null>(null)
  const [setupLogs, setSetupLogs] = useState<SetupOutputEvent[]>([])
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState<InstallTarget | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [providerType, setProviderType] = useState<ProviderType>('anthropic')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const outputRef = useRef<HTMLDivElement | null>(null)
  const setupLogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void window.claudeStudio.getState().then((state: AppStateFile) => {
      setSettings(state.settings)
      setProviderType(state.settings.providerType)
      setApiBaseUrl(state.settings.apiBaseUrl)
      setRecentProjects(state.recentProjects)
      setHistory(state.history)
      if (state.recentProjects[0]) setProjectPath(state.recentProjects[0])
      setSetupOpen(!state.onboardingCompleted)
      setLoaded(true)
      void refreshSystemCheck()
    })
  }, [])

  useEffect(() => {
    const offOutput = window.claudeStudio.onTaskOutput((event) => setOutput((prev) => [...prev, event]))
    const offDone = window.claudeStudio.onTaskDone((event: TaskDoneEvent) => {
      setTaskStatus(event.status)
      setMessage(event.status === 'success' ? '任务完成。' : event.error ?? statusLabel(event.status))
      void window.claudeStudio.getState().then((state) => {
        setHistory(state.history)
        setRecentProjects(state.recentProjects)
      })
    })
    const offFiles = window.claudeStudio.onTaskFiles((event: TaskFilesEvent) => setChangedFiles(event.files))
    const offSetup = window.claudeStudio.onSetupOutput((event: SetupOutputEvent) => setSetupLogs((prev) => [...prev, event].slice(-300)))
    return () => {
      offOutput()
      offDone()
      offFiles()
      offSetup()
    }
  }, [])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' })
  }, [output])

  useEffect(() => {
    setupLogRef.current?.scrollTo({ top: setupLogRef.current.scrollHeight, behavior: 'smooth' })
  }, [setupLogs])

  const commandPreview = useMemo(() => {
    const base = settings.claudeCommand || 'claude'
    const modeFlag = mode === 'auto' ? 'auto' : mode === 'edit' ? settings.permissionMode : 'plan'
    const budget = settings.maxBudgetUsd ? ` --max-budget-usd ${settings.maxBudgetUsd}` : ''
    const turns = settings.maxTurns ? ` --max-turns ${settings.maxTurns}` : ''
    const model = settings.defaultModel ? ` --model ${settings.defaultModel}` : ''
    return `${base} ${settings.useBareMode ? '--bare ' : ''}${model} --permission-mode ${modeFlag}${turns}${budget} -p "${prompt || '你的任务'}" --output-format stream-json`
  }, [mode, prompt, settings])

  async function refreshSystemCheck(): Promise<void> {
    setChecking(true)
    try {
      const report = await window.claudeStudio.checkSystem()
      setSetupReport(report)
    } finally {
      setChecking(false)
    }
  }

  async function install(target: InstallTarget): Promise<void> {
    setInstalling(target)
    setSetupLogs([])
    const result = await window.claudeStudio.installTarget(target)
    if (!result.ok) setMessage(result.error ?? '安装失败。')
    setInstalling(null)
    await refreshSystemCheck()
  }

  async function saveSetup(): Promise<void> {
    const next = await window.claudeStudio.saveSetup({
      providerType,
      apiKey: apiKeyInput,
      apiBaseUrl,
      defaultModel: settings.defaultModel,
      permissionMode: settings.permissionMode,
      useBareMode: settings.useBareMode,
      saveModelToClaudeSettings: settings.saveModelToClaudeSettings
    })
    setSettings(next.settings)
    setApiKeyInput('')
    setSetupOpen(false)
    setMessage('配置已保存，可以开始使用。')
    await refreshSystemCheck()
  }

  async function chooseProject(): Promise<void> {
    const picked = await window.claudeStudio.selectProject()
    if (picked) {
      setProjectPath(picked)
      const next = await window.claudeStudio.addRecentProject(picked)
      setRecentProjects(next.recentProjects)
    }
  }

  async function saveSettings(): Promise<void> {
    const next = await window.claudeStudio.saveSettings({ ...settings, providerType, apiBaseUrl })
    setSettings(next.settings)
    setMessage('设置已保存。')
    setSettingsOpen(false)
    await refreshSystemCheck()
  }

  async function runTask(): Promise<void> {
    setMessage('')
    if (!projectPath) return setMessage('请先选择项目目录。')
    if (!prompt.trim()) return setMessage('请先输入任务。')
    if (!setupReport?.ready && settings.runPreflightBeforeTask) {
      setSetupOpen(true)
      return setMessage('环境还没就绪，先完成启动检查/配置。')
    }

    const id = createTaskId()
    setTaskId(id)
    setTaskStatus('running')
    setOutput([])
    setChangedFiles([])

    const result = await window.claudeStudio.runTask({ id, projectPath, prompt, mode, settings: { ...settings, providerType, apiBaseUrl } })
    if (!result.ok) {
      setTaskStatus('error')
      setMessage(result.error ?? '启动失败。')
    }
  }

  async function stopTask(): Promise<void> {
    if (!taskId) return
    const result = await window.claudeStudio.stopTask(taskId)
    if (!result.ok) setMessage(result.error ?? '停止失败。')
  }

  async function clearHistory(): Promise<void> {
    const next = await window.claudeStudio.clearHistory()
    setHistory(next.history)
  }

  async function copyCommand(): Promise<void> {
    await navigator.clipboard.writeText(commandPreview)
    setMessage('命令已复制。')
  }

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-200">
        <Loader2 className="mr-3 animate-spin" /> 正在启动 Claude Code Studio…
      </div>
    )
  }

  return (
    <div className="min-h-screen p-5 text-slate-100">
      <div className="mx-auto flex max-w-[1540px] gap-5">
        <aside className="glass-card hidden h-[calc(100vh-40px)] w-80 shrink-0 flex-col overflow-hidden lg:flex">
          <div className="border-b border-white/10 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-blue-500/20 p-3 text-blue-200"><Bot size={26} /></div>
              <div>
                <h1 className="text-xl font-bold">Claude Code Studio</h1>
                <p className="text-sm text-slate-400">一键检测 · 安装 · 配置 · 使用</p>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <button className="mb-4 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-left transition hover:bg-white/[0.1]" onClick={() => setSetupOpen((v) => !v)}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold"><MonitorCog size={17} /> 启动检查</span>
                <span className={classNames('rounded-full px-2 py-1 text-xs', setupReport?.ready ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/20 text-amber-100')}>
                  {setupReport?.ready ? 'Ready' : 'Need setup'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">检测 Claude Code、模型、API 和依赖。</p>
            </button>

            <SectionTitle icon={FolderOpen} title="最近项目" />
            <div className="space-y-2">
              {recentProjects.length === 0 ? <EmptyText text="还没有项目，先选择一个文件夹。" /> : recentProjects.map((item) => (
                <button key={item} className={classNames('w-full rounded-2xl border px-3 py-3 text-left text-sm transition', item === projectPath ? 'border-blue-400/50 bg-blue-500/15 text-blue-100' : 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]')} onClick={() => setProjectPath(item)}>
                  <div className="truncate font-medium">{shortPath(item)}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{item}</div>
                </button>
              ))}
            </div>

            <div className="mt-8 flex items-center justify-between">
              <SectionTitle icon={History} title="任务历史" />
              {history.length > 0 && <button className="text-xs text-slate-400 hover:text-red-200" onClick={clearHistory}>清空</button>}
            </div>
            <div className="space-y-2">
              {history.length === 0 ? <EmptyText text="任务运行后会自动保存在这里。" /> : history.slice(0, 12).map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-slate-300">{statusLabel(item.status)}</span>
                    <span className="text-[11px] text-slate-500">{formatTime(item.startedAt)}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-slate-300">{item.prompt}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">{shortPath(item.projectPath)}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-5">
          <header className="glass-card p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm text-blue-200"><Sparkles size={16} /><span>双击 exe → 自动检查 → 选择模型/API → 进入可视化 Claude Code</span></div>
                <h2 className="text-3xl font-bold tracking-tight">把 Claude Code 变成普通人能用的软件</h2>
                <p className="mt-2 max-w-3xl text-slate-400">前台只看到这个 UI；后台负责安装/配置/调用 Claude Code CLI，并把 stream-json 输出变成可读日志。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={() => setSetupOpen((v) => !v)}><MonitorCog size={18} /> 启动检查</button>
                <button className="btn-secondary" onClick={() => setSettingsOpen((v) => !v)}><Settings size={18} /> 高级设置</button>
                <button className="btn-secondary" onClick={() => projectPath && window.claudeStudio.openPath(projectPath)} disabled={!projectPath}><ExternalLink size={18} /> 打开目录</button>
              </div>
            </div>
          </header>

          {setupOpen && (
            <SetupPanel
              report={setupReport}
              checking={checking}
              installing={installing}
              settings={settings}
              setSettings={setSettings}
              providerType={providerType}
              setProviderType={setProviderType}
              apiBaseUrl={apiBaseUrl}
              setApiBaseUrl={setApiBaseUrl}
              apiKeyInput={apiKeyInput}
              setApiKeyInput={setApiKeyInput}
              setupLogs={setupLogs}
              setupLogRef={setupLogRef}
              onCheck={refreshSystemCheck}
              onInstall={install}
              onSave={saveSetup}
            />
          )}

          {settingsOpen && (
            <SettingsPanel
              settings={settings}
              setSettings={setSettings}
              providerType={providerType}
              setProviderType={setProviderType}
              apiBaseUrl={apiBaseUrl}
              setApiBaseUrl={setApiBaseUrl}
              onSave={saveSettings}
            />
          )}

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="glass-card p-5">
              <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <Field label="项目目录" className="min-w-0 flex-1">
                  <div className="flex gap-2">
                    <input className="input" value={projectPath} onChange={(e) => setProjectPath(e.target.value)} placeholder="选择或粘贴项目路径" />
                    <button className="btn-secondary shrink-0" onClick={chooseProject}><FolderOpen size={18} /> 选择</button>
                  </div>
                </Field>
              </div>

              <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {modeCards.map((card) => {
                  const Icon = card.icon
                  const active = mode === card.mode
                  return (
                    <button key={card.mode} className={classNames('rounded-3xl border p-4 text-left transition', active ? 'border-blue-400/60 bg-blue-500/15 shadow-lg shadow-blue-950/20' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]')} onClick={() => setMode(card.mode)}>
                      <Icon className={active ? 'text-blue-200' : 'text-slate-300'} size={22} />
                      <div className="mt-3 font-semibold">{card.title}</div>
                      <p className="mt-1 text-sm leading-5 text-slate-400">{card.desc}</p>
                    </button>
                  )
                })}
              </div>

              <Field label="你要让 Claude Code 做什么">
                <textarea className="input min-h-44 resize-y text-base leading-7" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例如：帮我分析这个项目怎么运行，并补一个 README。" />
              </Field>

              <div className="mt-4 flex flex-wrap gap-2">
                {promptTemplates.map((item) => <button key={item} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10" onClick={() => setPrompt(item)}>{item.slice(0, 18)}…</button>)}
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-300"><Terminal size={16} /> 后台命令预览</div>
                  <button className="text-sm text-blue-200 hover:text-blue-100" onClick={copyCommand}>复制</button>
                </div>
                <code className="block overflow-x-auto whitespace-pre rounded-xl bg-black/30 p-3 font-mono text-xs leading-5 text-slate-300">{commandPreview}</code>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button className="btn-primary" onClick={runTask} disabled={taskStatus === 'running'}>{taskStatus === 'running' ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />} 开始执行</button>
                <button className="btn-danger" onClick={stopTask} disabled={taskStatus !== 'running'}><Square size={16} /> 停止</button>
                <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm text-slate-300">状态：{statusLabel(taskStatus)}</span>
                {message && <span className="text-sm text-amber-200">{message}</span>}
              </div>
            </div>

            <aside className="glass-card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div><h3 className="text-lg font-bold">文件变更</h3><p className="text-sm text-slate-400">任务结束后自动读取 git status。</p></div>
                {taskStatus === 'success' ? <CheckCircle2 className="text-emerald-300" /> : taskStatus === 'error' ? <XCircle className="text-red-300" /> : null}
              </div>

              <div className="space-y-2">
                {changedFiles.length === 0 ? <EmptyText text="暂未检测到 Git 文件变更。" /> : changedFiles.map((file) => (
                  <div key={`${file.status}-${file.path}`} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/35 p-3">
                    <span className="mt-0.5 rounded-lg bg-white/10 px-2 py-1 font-mono text-xs text-blue-100">{file.status || '?'}</span>
                    <span className="min-w-0 break-all text-sm text-slate-300">{file.path}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                <div className="mb-1 font-semibold">分发建议</div>
                <p>给别人用时，默认开启启动检查和 API 配置向导。API Key 保存在对方本机，不要让别人共用你的 Key。</p>
              </div>
            </aside>
          </section>

          <section className="glass-card min-h-[360px] overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-2 font-semibold"><Terminal size={18} /> 实时输出</div>
              <button className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10" onClick={() => setOutput([])}><Trash2 size={14} className="mr-1 inline" /> 清空窗口</button>
            </div>
            <div ref={outputRef} className="h-[380px] overflow-y-auto bg-slate-950/70 p-5 font-mono text-sm leading-6">
              {output.length === 0 ? <div className="flex h-full items-center justify-center text-slate-500">运行任务后，这里会显示后台 Claude Code 的输出。</div> : output.map((item, index) => (
                <pre key={`${item.timestamp}-${index}`} className={classNames('whitespace-pre-wrap break-words', item.kind === 'stderr' && 'text-red-200', item.kind === 'system' && 'text-blue-200', item.kind === 'result' && 'text-emerald-200', item.kind === 'error' && 'text-red-300', item.kind === 'stdout' && 'text-slate-200')}>{item.text}</pre>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

function SetupPanel(props: {
  report: SystemReport | null
  checking: boolean
  installing: InstallTarget | null
  settings: StudioSettings
  setSettings: (next: StudioSettings) => void
  providerType: ProviderType
  setProviderType: (v: ProviderType) => void
  apiBaseUrl: string
  setApiBaseUrl: (v: string) => void
  apiKeyInput: string
  setApiKeyInput: (v: string) => void
  setupLogs: SetupOutputEvent[]
  setupLogRef: RefObject<HTMLDivElement>
  onCheck: () => Promise<void>
  onInstall: (target: InstallTarget) => Promise<void>
  onSave: () => Promise<void>
}): JSX.Element {
  const { report, checking, installing, settings, setSettings } = props
  return (
    <section className="glass-card p-5">
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-blue-200"><Rocket size={16} /> 首次启动向导</div>
          <h3 className="text-2xl font-bold">自动检测环境，缺什么补什么</h3>
          <p className="mt-1 text-sm text-slate-400">目标是让用户双击 exe 后不用碰终端：安装 Claude Code、配置模型/API，然后直接在 UI 里对话。</p>
        </div>
        <button className="btn-secondary" onClick={props.onCheck} disabled={checking}>{checking ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />} 重新检查</button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {(report?.checks ?? []).map((item) => <CheckCard key={item.key} item={item} installing={installing} onInstall={props.onInstall} />)}
            {!report && <EmptyText text="正在等待检查结果。" />}
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/35 p-4">
            <div className="mb-4 flex items-center gap-2 font-semibold"><KeyRound size={18} /> API 与模型配置</div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="服务类型">
                <select className="input" value={props.providerType} onChange={(e) => props.setProviderType(e.target.value as ProviderType)}>
                  <option value="anthropic">Anthropic 官方 API</option>
                  <option value="custom">Anthropic-compatible 第三方接口</option>
                </select>
              </Field>
              <Field label="模型">
                <select className="input" value={settings.defaultModel} onChange={(e) => setSettings({ ...settings, defaultModel: e.target.value })}>
                  {MODEL_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>
              {props.providerType === 'custom' && (
                <Field label="API Base URL">
                  <input className="input" value={props.apiBaseUrl} onChange={(e) => props.setApiBaseUrl(e.target.value)} placeholder="https://example.com/anthropic" />
                </Field>
              )}
              <Field label={settings.apiKeySaved ? 'API Key（已保存，留空则不修改）' : 'API Key'}>
                <input className="input" type="password" value={props.apiKeyInput} onChange={(e) => props.setApiKeyInput(e.target.value)} placeholder="sk-ant-..." />
              </Field>
              <Field label="默认权限模式">
                <select className="input" value={settings.permissionMode} onChange={(e) => setSettings({ ...settings, permissionMode: e.target.value as StudioSettings['permissionMode'] })}>
                  <option value="default">default：默认询问</option>
                  <option value="acceptEdits">acceptEdits：接受编辑</option>
                  <option value="plan">plan：先计划</option>
                  <option value="auto">auto：自动模式</option>
                  <option value="dontAsk">dontAsk：减少打断</option>
                  <option value="bypassPermissions">bypassPermissions：跳过权限，高风险</option>
                </select>
              </Field>
              <label className="soft-card flex items-start gap-3 p-4">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={settings.useBareMode} onChange={(e) => setSettings({ ...settings, useBareMode: e.target.checked })} />
                <span><span className="block font-medium">默认 Bare 模式</span><span className="text-sm text-slate-400">更适合 UI 后台调用；使用 API Key 时推荐开启。</span></span>
              </label>
              <label className="soft-card flex items-start gap-3 p-4">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={settings.saveModelToClaudeSettings} onChange={(e) => setSettings({ ...settings, saveModelToClaudeSettings: e.target.checked })} />
                <span><span className="block font-medium">写入 Claude Code 用户设置</span><span className="text-sm text-slate-400">会更新 ~/.claude/settings.json 的 model/defaultMode。</span></span>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-primary" onClick={props.onSave}><Save size={18} /> 保存配置并进入 UI</button>
              <button className="btn-secondary" onClick={() => window.claudeStudio.openExternal('https://console.anthropic.com/settings/keys')}><ExternalLink size={18} /> 获取 Anthropic Key</button>
            </div>
          </div>
        </div>

        <aside className="rounded-3xl border border-white/10 bg-slate-950/50 p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold"><Terminal size={18} /> 安装/检查日志</div>
          <div ref={props.setupLogRef} className="h-[380px] overflow-y-auto rounded-2xl bg-black/30 p-3 font-mono text-xs leading-5 text-slate-300">
            {props.setupLogs.length === 0 ? <span className="text-slate-500">执行安装或保存配置后，这里会显示日志。</span> : props.setupLogs.map((item, index) => (
              <pre key={`${item.timestamp}-${index}`} className={classNames('whitespace-pre-wrap break-words', item.kind === 'stderr' && 'text-red-200', item.kind === 'error' && 'text-red-300', item.kind === 'success' && 'text-emerald-200', item.kind === 'system' && 'text-blue-200')}>{item.text}</pre>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-blue-300/20 bg-blue-400/10 p-3 text-sm leading-6 text-blue-100">
            <div className="font-semibold">本机安全边界</div>
            <p>API Key 不写进项目文件，只存在当前用户的应用数据目录；运行任务时临时传给后台 Claude Code 进程。</p>
          </div>
        </aside>
      </div>
    </section>
  )
}

function CheckCard({ item, installing, onInstall }: { item: SystemCheckItem; installing: InstallTarget | null; onInstall: (target: InstallTarget) => Promise<void> }): JSX.Element {
  const ok = item.status === 'ok'
  const warn = item.status === 'warning'
  return (
    <div className={classNames('rounded-3xl border p-4', ok ? 'border-emerald-400/20 bg-emerald-400/10' : warn ? 'border-amber-300/20 bg-amber-400/10' : 'border-red-300/20 bg-red-400/10')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold">
            {ok ? <CheckCircle2 className="text-emerald-200" size={18} /> : warn ? <AlertTriangle className="text-amber-200" size={18} /> : <XCircle className="text-red-200" size={18} />}
            <span>{item.label}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{item.message}</p>
          {item.version && <p className="mt-1 truncate font-mono text-xs text-slate-500">{item.version}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-black/20 px-2 py-1 text-xs text-slate-200">{checkStatusText(item.status)}</span>
      </div>
      {item.fixTarget && (
        <button className="btn-secondary mt-4 w-full" onClick={() => onInstall(item.fixTarget!)} disabled={Boolean(installing)}>
          {installing === item.fixTarget ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />} 自动安装/修复
        </button>
      )}
    </div>
  )
}

function SettingsPanel(props: {
  settings: StudioSettings
  setSettings: (settings: StudioSettings) => void
  providerType: ProviderType
  setProviderType: (v: ProviderType) => void
  apiBaseUrl: string
  setApiBaseUrl: (v: string) => void
  onSave: () => Promise<void>
}): JSX.Element {
  const { settings, setSettings } = props
  return (
    <section className="glass-card p-5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div><h3 className="text-xl font-bold">高级运行设置</h3><p className="text-sm text-slate-400">普通用户不用改；开发/调试时可调整 Claude 命令、工具、预算和系统提示。</p></div>
        <button className="btn-primary" onClick={props.onSave}><Save size={18} /> 保存设置</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Claude 命令"><input className="input" value={settings.claudeCommand} onChange={(e) => setSettings({ ...settings, claudeCommand: e.target.value })} placeholder="claude" /></Field>
        <Field label="模型"><input className="input" value={settings.defaultModel} onChange={(e) => setSettings({ ...settings, defaultModel: e.target.value })} placeholder="sonnet / opus / claude-sonnet-4-6" /></Field>
        <Field label="服务类型"><select className="input" value={props.providerType} onChange={(e) => props.setProviderType(e.target.value as ProviderType)}><option value="anthropic">Anthropic 官方 API</option><option value="custom">Anthropic-compatible 第三方接口</option></select></Field>
        <Field label="API Base URL"><input className="input" value={props.apiBaseUrl} onChange={(e) => props.setApiBaseUrl(e.target.value)} placeholder="留空则官方 Anthropic" /></Field>
        <Field label="默认权限模式"><select className="input" value={settings.permissionMode} onChange={(e) => setSettings({ ...settings, permissionMode: e.target.value as StudioSettings['permissionMode'] })}><option value="default">default</option><option value="acceptEdits">acceptEdits</option><option value="plan">plan</option><option value="auto">auto</option><option value="dontAsk">dontAsk</option><option value="bypassPermissions">bypassPermissions</option></select></Field>
        <Field label="最大轮数"><input className="input" type="number" min={1} value={settings.maxTurns} onChange={(e) => setSettings({ ...settings, maxTurns: Number(e.target.value) })} /></Field>
        <Field label="预算上限 USD，可留空"><input className="input" value={settings.maxBudgetUsd} onChange={(e) => setSettings({ ...settings, maxBudgetUsd: e.target.value })} placeholder="例如 1.5" /></Field>
        <Field label="限制可用工具，可留空"><input className="input" value={settings.allowedTools} onChange={(e) => setSettings({ ...settings, allowedTools: e.target.value })} placeholder="例如 Read,Edit,Bash" /></Field>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <ToggleCard checked={settings.useBareMode} onChange={(v) => setSettings({ ...settings, useBareMode: v })} title="Bare 模式" desc="跳过自动发现，适合后台脚本调用。" />
        <ToggleCard checked={settings.includePartialMessages} onChange={(v) => setSettings({ ...settings, includePartialMessages: v })} title="显示流式片段" desc="更实时，但输出可能更碎。" />
        <ToggleCard checked={settings.runPreflightBeforeTask} onChange={(v) => setSettings({ ...settings, runPreflightBeforeTask: v })} title="运行前检查" desc="避免环境没配好就启动任务。" />
      </div>

      <Field label="追加系统提示，可留空" className="mt-4"><textarea className="input min-h-24 resize-y" value={settings.appendSystemPrompt} onChange={(e) => setSettings({ ...settings, appendSystemPrompt: e.target.value })} placeholder="例如：Always prefer TypeScript and keep changes minimal." /></Field>
    </section>
  )
}

function ToggleCard({ checked, onChange, title, desc }: { checked: boolean; onChange: (v: boolean) => void; title: string; desc: string }): JSX.Element {
  return (
    <label className="soft-card flex items-start gap-3 p-4">
      <input type="checkbox" className="mt-1 h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="block font-medium">{title}</span><span className="text-sm text-slate-400">{desc}</span></span>
    </label>
  )
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }): JSX.Element {
  return <label className={className}><span className="label">{label}</span>{children}</label>
}

function SectionTitle({ icon: Icon, title }: { icon: typeof FolderOpen; title: string }): JSX.Element {
  return <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300"><Icon size={16} /> {title}</div>
}

function EmptyText({ text }: { text: string }): JSX.Element {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">{text}</div>
}
