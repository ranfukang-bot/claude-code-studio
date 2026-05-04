export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions'
export type TaskMode = 'analyze' | 'plan' | 'edit' | 'auto'
export type TaskStatus = 'idle' | 'running' | 'success' | 'error' | 'stopped'
export type ProviderType = 'anthropic' | 'custom'
export type InstallTarget = 'node' | 'git' | 'claude'
export type CheckStatus = 'ok' | 'missing' | 'warning' | 'unknown'

export interface StudioSettings {
  claudeCommand: string
  defaultModel: string
  providerType: ProviderType
  apiBaseUrl: string
  apiKeySaved: boolean
  permissionMode: PermissionMode
  maxTurns: number
  maxBudgetUsd: string
  useBareMode: boolean
  allowedTools: string
  appendSystemPrompt: string
  includePartialMessages: boolean
  runPreflightBeforeTask: boolean
  saveModelToClaudeSettings: boolean
}

export interface TaskRequest {
  id: string
  projectPath: string
  prompt: string
  mode: TaskMode
  settings: StudioSettings
}

export interface TaskOutputEvent {
  taskId: string
  kind: 'stdout' | 'stderr' | 'system' | 'result' | 'error'
  text: string
  raw?: unknown
  timestamp: number
}

export interface TaskDoneEvent {
  taskId: string
  status: TaskStatus
  exitCode: number | null
  signal: NodeJS.Signals | null
  durationMs: number
  error?: string
}

export interface TaskFilesEvent {
  taskId: string
  files: ChangedFile[]
}

export interface ChangedFile {
  path: string
  status: string
}

export interface HistoryItem {
  id: string
  projectPath: string
  prompt: string
  mode: TaskMode
  status: TaskStatus
  startedAt: number
  endedAt?: number
  outputPreview: string
  changedFiles?: ChangedFile[]
}

export interface EncryptedSecret {
  value: string
  encrypted: boolean
  updatedAt: number
}

export interface AppStateFile {
  settings: StudioSettings
  recentProjects: string[]
  history: HistoryItem[]
  secrets?: {
    anthropicApiKey?: EncryptedSecret
  }
  onboardingCompleted?: boolean
}

export interface SystemCheckItem {
  key: string
  label: string
  status: CheckStatus
  message: string
  version?: string
  fixTarget?: InstallTarget
  details?: string
}

export interface SystemReport {
  platform: NodeJS.Platform
  arch: string
  userDataPath: string
  claudeUserSettingsPath: string
  appSettingsPath: string
  ready: boolean
  checks: SystemCheckItem[]
  detectedClaudeSettings?: Record<string, unknown>
}

export interface SetupOutputEvent {
  target: InstallTarget | 'check' | 'config'
  kind: 'stdout' | 'stderr' | 'system' | 'error' | 'success'
  text: string
  timestamp: number
}

export interface SaveSetupRequest {
  providerType: ProviderType
  apiKey?: string
  apiBaseUrl?: string
  defaultModel: string
  permissionMode: PermissionMode
  useBareMode: boolean
  saveModelToClaudeSettings: boolean
}

export const MODEL_OPTIONS = [
  { value: 'sonnet', label: 'Sonnet：默认推荐，速度/质量均衡' },
  { value: 'opus', label: 'Opus：复杂任务更强，成本更高' },
  { value: 'haiku', label: 'Haiku：快，适合简单任务' },
  { value: 'opusplan', label: 'Opus Plan：规划用 Opus，执行用 Sonnet' },
  { value: 'best', label: 'Best：账号可用的最强模型' }
]

export const DEFAULT_SETTINGS: StudioSettings = {
  claudeCommand: 'claude',
  defaultModel: 'sonnet',
  providerType: 'anthropic',
  apiBaseUrl: '',
  apiKeySaved: false,
  permissionMode: 'default',
  maxTurns: 20,
  maxBudgetUsd: '',
  useBareMode: true,
  allowedTools: '',
  appendSystemPrompt: '',
  includePartialMessages: true,
  runPreflightBeforeTask: true,
  saveModelToClaudeSettings: true
}
