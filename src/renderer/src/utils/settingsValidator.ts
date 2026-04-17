/**
 * Validate AppSettings before saving. Returns an array of user-friendly error messages.
 * Empty array = all good.
 */
import { AppSettings, Provider } from '../../../shared/types'

export interface ValidationResult {
  field:   string
  message: string
  level:   'error' | 'warning'
}

export function validateSettings(settings: AppSettings): ValidationResult[] {
  const results: ValidationResult[] = []

  // Provider-specific API key validation
  if (settings.provider === 'anthropic') {
    if (!settings.apiKey) {
      results.push({ field: 'apiKey', message: 'Anthropic API key is required', level: 'error' })
    } else if (!settings.apiKey.startsWith('sk-ant-')) {
      results.push({ field: 'apiKey', message: 'Anthropic API keys start with "sk-ant-". Double-check your key.', level: 'warning' })
    }
  } else if (settings.provider === 'openai') {
    if (!settings.apiKey) {
      results.push({ field: 'apiKey', message: 'OpenAI API key is required', level: 'error' })
    } else if (!settings.apiKey.startsWith('sk-')) {
      results.push({ field: 'apiKey', message: 'OpenAI API keys usually start with "sk-". Double-check your key.', level: 'warning' })
    }
  } else if (settings.provider === 'gemini') {
    if (!settings.apiKey && !settings.vertexProjectId) {
      results.push({ field: 'apiKey', message: 'Gemini requires an API key or Vertex AI project ID', level: 'error' })
    }
  } else if (settings.provider === 'custom') {
    if (!settings.baseUrl) {
      results.push({ field: 'baseUrl', message: 'Custom provider requires a base URL (e.g. http://localhost:11434/v1)', level: 'error' })
    }
  }

  // Base URL validation
  if (settings.baseUrl) {
    try {
      new URL(settings.baseUrl)
    } catch {
      results.push({ field: 'baseUrl', message: 'Base URL is not a valid URL. Include the protocol (http:// or https://)', level: 'error' })
    }
  }

  // Model validation
  if (!settings.model) {
    results.push({ field: 'model', message: 'No model selected', level: 'error' })
  }

  // Max tokens
  if (settings.maxTokens < 1) {
    results.push({ field: 'maxTokens', message: 'Max tokens must be at least 1', level: 'error' })
  } else if (settings.maxTokens > 200000) {
    results.push({ field: 'maxTokens', message: 'Max tokens seems unusually high (>200K). This may cause errors.', level: 'warning' })
  }

  // Temperature
  if (settings.temperature !== undefined) {
    if (settings.temperature < 0 || settings.temperature > 2) {
      results.push({ field: 'temperature', message: 'Temperature must be between 0 and 2', level: 'error' })
    }
  }

  // Top P
  if (settings.topP !== undefined) {
    if (settings.topP < 0 || settings.topP > 1) {
      results.push({ field: 'topP', message: 'Top P must be between 0 and 1', level: 'error' })
    }
  }

  // Max iterations
  if (settings.maxIterations < 1) {
    results.push({ field: 'maxIterations', message: 'Max iterations must be at least 1', level: 'error' })
  } else if (settings.maxIterations > 500) {
    results.push({ field: 'maxIterations', message: 'Max iterations over 500 could cause runaway loops', level: 'warning' })
  }

  // API server port
  if (settings.apiServerEnabled && settings.apiServerPort) {
    if (settings.apiServerPort < 1024 || settings.apiServerPort > 65535) {
      results.push({ field: 'apiServerPort', message: 'API server port must be between 1024 and 65535', level: 'error' })
    }
  }

  // Webhook URL
  if (settings.webhookEnabled && settings.webhookUrl) {
    try {
      new URL(settings.webhookUrl)
    } catch {
      results.push({ field: 'webhookUrl', message: 'Webhook URL is not valid', level: 'error' })
    }
  }

  // Jira
  if (settings.jiraUrl) {
    try {
      new URL(settings.jiraUrl)
    } catch {
      results.push({ field: 'jiraUrl', message: 'Jira URL is not valid. Should be like https://yourorg.atlassian.net', level: 'error' })
    }
  }

  // Workspace path warning
  if (!settings.workspacePath) {
    results.push({ field: 'workspacePath', message: 'No workspace folder set. File operations and git tools will be disabled.', level: 'warning' })
  }

  return results
}

export function hasErrors(results: ValidationResult[]): boolean {
  return results.some(r => r.level === 'error')
}
