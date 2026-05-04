import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppStateFile,
  HistoryItem,
  InstallTarget,
  SaveSetupRequest,
  SetupOutputEvent,
  StudioSettings,
  SystemReport,
  TaskDoneEvent,
  TaskFilesEvent,
  TaskOutputEvent,
  TaskRequest
} from '@shared/types'

type Listener<T> = (payload: T) => void

function subscribe<T>(channel: string, listener: Listener<T>): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  getState: (): Promise<AppStateFile> => ipcRenderer.invoke('state:get'),
  saveSettings: (settings: StudioSettings): Promise<AppStateFile> => ipcRenderer.invoke('settings:save', settings),
  selectProject: (): Promise<string | null> => ipcRenderer.invoke('dialog:select-project'),
  addRecentProject: (projectPath: string): Promise<AppStateFile> => ipcRenderer.invoke('project:add-recent', projectPath),
  openPath: (targetPath: string): Promise<boolean> => ipcRenderer.invoke('shell:open-path', targetPath),
  revealPath: (targetPath: string): Promise<boolean> => ipcRenderer.invoke('shell:reveal-path', targetPath),
  runTask: (request: TaskRequest): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('task:run', request),
  stopTask: (taskId: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('task:stop', taskId),
  clearHistory: (): Promise<AppStateFile> => ipcRenderer.invoke('history:clear'),
  getGitStatus: (projectPath: string): Promise<{ files: Array<{ path: string; status: string }>; error?: string }> =>
    ipcRenderer.invoke('project:git-status', projectPath),

  checkSystem: (): Promise<SystemReport> => ipcRenderer.invoke('setup:check'),
  installTarget: (target: InstallTarget): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('setup:install', target),
  saveSetup: (request: SaveSetupRequest): Promise<AppStateFile> => ipcRenderer.invoke('setup:save', request),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('setup:open-external', url),

  onTaskOutput: (listener: Listener<TaskOutputEvent>) => subscribe('task:output', listener),
  onTaskDone: (listener: Listener<TaskDoneEvent>) => subscribe('task:done', listener),
  onTaskFiles: (listener: Listener<TaskFilesEvent>) => subscribe('task:files', listener),
  onSetupOutput: (listener: Listener<SetupOutputEvent>) => subscribe('setup:output', listener)
}

contextBridge.exposeInMainWorld('claudeStudio', api)

export type ClaudeStudioApi = typeof api
