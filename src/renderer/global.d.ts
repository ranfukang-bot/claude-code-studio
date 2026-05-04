import type { ClaudeStudioApi } from '../preload/preload'

declare global {
  interface Window {
    claudeStudio: ClaudeStudioApi
  }
}

export {}
