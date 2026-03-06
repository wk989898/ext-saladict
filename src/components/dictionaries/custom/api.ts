const DEFAULT_BASE_URL = 'https://api.openai.com'

type OpenAIAPIType = 'responses' | 'chat-completions'

interface TextRequestOptions {
  baseURL?: string
  apiKey: string
  model: string
  prompt: string
}

interface CustomAuthInput {
  baseURL?: string
  apiKey?: string
  model?: string
  accounts?: string
  activeAccount?: string
}

interface CustomAccount {
  name: string
  baseURL?: string
  apiKey: string
  model: string
}

interface ResolvedCustomAuth {
  ok: boolean
  baseURL?: string
  apiKey?: string
  model?: string
  accountName?: string
  source: 'single' | 'accounts'
  error?: string
}

interface TextRequestResult {
  ok: boolean
  status: number
  text?: string
  error?: string
  api: OpenAIAPIType
  endpoint: string
  requestID?: string
}

interface ParsedResponse {
  ok: boolean
  status: number
  data: any
  requestID?: string
}

interface StreamState {
  deltaText: string
  doneText: string
  finalResponse: any
  error: string
  status: number
  requestID?: string
}

function normalizeBaseURL(baseURL?: string): string {
  const raw = (baseURL || DEFAULT_BASE_URL).trim()
  return raw.replace(/\/+$/, '')
}

function normalizeString(raw?: string): string {
  return (raw || '').trim()
}

function parseAccountLine(rawLine: string, index: number): CustomAccount | null {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) return null

  const parts = line.split('|').map(part => part.trim())
  let name = ''
  let baseURL = ''
  let apiKey = ''
  let model = ''

  if (parts.length >= 4) {
    name = parts[0]
    baseURL = parts[1]
    apiKey = parts[2]
    model = parts.slice(3).join('|').trim()
  } else if (parts.length === 3) {
    name = `account-${index + 1}`
    baseURL = parts[0]
    apiKey = parts[1]
    model = parts[2]
  } else if (parts.length === 2) {
    name = `account-${index + 1}`
    baseURL = ''
    apiKey = parts[0]
    model = parts[1]
  } else {
    return null
  }

  if (!apiKey || !model) return null
  return {
    name: name || `account-${index + 1}`,
    baseURL: baseURL || '',
    apiKey,
    model
  }
}

function parseAccountObject(entry: any, index: number): CustomAccount | null {
  if (typeof entry === 'string') {
    return parseAccountLine(entry, index)
  }
  if (!entry || typeof entry !== 'object') return null

  const name = normalizeString(entry.name || entry.id || entry.label)
  const baseURL = normalizeString(entry.baseURL || entry.baseUrl || entry.url)
  const apiKey = normalizeString(entry.apiKey || entry.key || entry.token)
  const model = normalizeString(entry.model)

  if (!apiKey || !model) return null
  return {
    name: name || `account-${index + 1}`,
    baseURL,
    apiKey,
    model
  }
}

function parseCustomAccounts(raw?: string): {
  accounts: CustomAccount[]
  error?: string
} {
  const text = normalizeString(raw)
  if (!text) {
    return { accounts: [] }
  }

  let accounts: CustomAccount[] = []

  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text)
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.accounts)
          ? parsed.accounts
          : []
      if (arr.length === 0) {
        return {
          accounts: [],
          error: 'Custom accounts JSON is invalid. Expect an array or { accounts: [] }.'
        }
      }
      accounts = arr
        .map((entry, index) => parseAccountObject(entry, index))
        .filter(Boolean) as CustomAccount[]
    } catch (e) {
      return {
        accounts: [],
        error: e && e.message ? e.message : 'Failed to parse accounts JSON.'
      }
    }
  } else {
    accounts = text
      .split(/\r?\n/)
      .map((line, index) => parseAccountLine(line, index))
      .filter(Boolean) as CustomAccount[]
  }

  if (accounts.length === 0) {
    return {
      accounts: [],
      error:
        'No valid custom accounts found. Use one line: name|baseURL|apiKey|model'
    }
  }

  return { accounts }
}

export function getCustomAccountNames(raw?: string): string[] {
  const { accounts } = parseCustomAccounts(raw)
  return accounts.map(account => account.name)
}

export function resolveCustomAuth(input: CustomAuthInput): ResolvedCustomAuth {
  const activeAccount = normalizeString(input.activeAccount)
  const { accounts, error: accountError } = parseCustomAccounts(input.accounts)

  if (accountError) {
    return {
      ok: false,
      source: 'accounts',
      error: accountError
    }
  }

  if (accounts.length > 0) {
    const account = activeAccount
      ? accounts.find(item => item.name === activeAccount)
      : accounts[0]
    if (!account) {
      return {
        ok: false,
        source: 'accounts',
        error: `activeAccount '${activeAccount}' not found in accounts`
      }
    }

    return {
      ok: true,
      source: 'accounts',
      accountName: account.name,
      baseURL: account.baseURL,
      apiKey: account.apiKey,
      model: account.model
    }
  }

  const apiKey = normalizeString(input.apiKey)
  const model = normalizeString(input.model)
  if (!apiKey || !model) {
    return {
      ok: false,
      source: 'single',
      error: 'Please fill apiKey and model first.'
    }
  }

  return {
    ok: true,
    source: 'single',
    baseURL: normalizeString(input.baseURL),
    apiKey,
    model
  }
}

export function getResponsesEndpoint(baseURL?: string): string {
  const normalized = normalizeBaseURL(baseURL)
  if (/\/responses$/i.test(normalized)) {
    return normalized
  }
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized.replace(/\/chat\/completions$/i, '/responses')
  }
  if (/\/v1$/i.test(normalized)) {
    return `${normalized}/responses`
  }
  return `${normalized}/v1/responses`
}

export function getChatCompletionsEndpoint(baseURL?: string): string {
  const normalized = normalizeBaseURL(baseURL)
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized
  }
  if (/\/responses$/i.test(normalized)) {
    return normalized.replace(/\/responses$/i, '/chat/completions')
  }
  if (/\/v1$/i.test(normalized)) {
    return `${normalized}/chat/completions`
  }
  return `${normalized}/v1/chat/completions`
}

function extractRequestIDFromHeaders(headers?: Headers | null): string | undefined {
  if (!headers) return undefined
  const id =
    headers.get('x-request-id') ||
    headers.get('request-id') ||
    headers.get('openai-request-id') ||
    ''
  return id || undefined
}

function extractRequestID(data: any): string | undefined {
  const id =
    (typeof data?._request_id === 'string' && data._request_id) ||
    (typeof data?.request_id === 'string' && data.request_id) ||
    (typeof data?.requestID === 'string' && data.requestID) ||
    (typeof data?.error?._request_id === 'string' && data.error._request_id) ||
    (typeof data?.error?.request_id === 'string' && data.error.request_id) ||
    (typeof data?.error?.requestID === 'string' && data.error.requestID) ||
    ''
  return id || undefined
}

export function extractResponsesText(data: any): string {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim()
  }

  if (Array.isArray(data?.output)) {
    const text = data.output
      .flatMap((outputItem: any) =>
        Array.isArray(outputItem?.content) ? outputItem.content : []
      )
      .map((contentItem: any) => {
        if (typeof contentItem?.text === 'string') return contentItem.text
        if (typeof contentItem?.output_text === 'string')
          return contentItem.output_text
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
    if (text) return text
  }

  return extractChatCompletionsText(data)
}

export function extractChatCompletionsText(data: any): string {
  const chatContent = data?.choices?.[0]?.message?.content
  if (typeof chatContent === 'string' && chatContent.trim()) {
    return chatContent.trim()
  }
  if (Array.isArray(chatContent)) {
    const text = chatContent
      .map((item: any) => {
        if (typeof item?.text === 'string') return item.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
    if (text) return text
  }

  const completionText = data?.choices?.[0]?.text
  if (typeof completionText === 'string' && completionText.trim()) {
    return completionText.trim()
  }
  return ''
}

export function extractResponsesError(data: any): string {
  if (typeof data === 'string' && data.trim()) {
    return data.trim()
  }
  if (typeof data?.error?.message === 'string' && data.error.message.trim()) {
    return data.error.message.trim()
  }
  if (typeof data?.error === 'string' && data.error.trim()) {
    return data.error.trim()
  }
  if (typeof data?.message === 'string' && data.message.trim()) {
    return data.message.trim()
  }
  if (typeof data?.detail === 'string' && data.detail.trim()) {
    return data.detail.trim()
  }
  return ''
}

function shouldRetryWithStructuredInput(status: number, error: string): boolean {
  if (status !== 400 && status !== 422) return false
  return /input/i.test(error)
}

function shouldFallbackToChat(status: number, error: string): boolean {
  const lowered = error.toLowerCase()
  if (status === 404 || status === 405 || status === 501) return true

  // Only fallback when responses endpoint is clearly unavailable.
  // Do NOT fallback on generic upstream/5xx failures, because many gateways
  // support only /v1/responses and reject /v1/chat/completions.
  return (
    lowered.includes('responses is not supported') ||
    lowered.includes('/responses is not supported') ||
    (lowered.includes('/v1/responses') && lowered.includes('not supported')) ||
    (lowered.includes('responses') &&
      lowered.includes('please use') &&
      lowered.includes('chat/completions')) ||
    lowered.includes('please use /v1/chat/completions') ||
    lowered.includes('use /v1/chat/completions') ||
    lowered.includes('not implemented') ||
    lowered.includes('route not found') ||
    lowered.includes('unknown endpoint') ||
    lowered.includes('unknown path')
  )
}

function shouldRetryResponses(status: number, error: string): boolean {
  if (status === 429 || status === 503 || status === 504) {
    return true
  }
  if (status === 502 && !/upstream request failed/i.test(error)) {
    return true
  }
  return /temporarily unavailable|timeout/i.test(error)
}

function shouldTryStreamFallback(status: number, error: string): boolean {
  if (status === 401 || status === 403) return false
  if (status === 404 || status === 405 || status === 501) return false
  if (status >= 500) return true
  return /upstream request failed|temporarily unavailable|timeout|stream/i.test(
    error
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function parseResponseBody(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return null
    }
  }

  try {
    const text = await response.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  } catch {
    return null
  }
}

async function postJSON(
  endpoint: string,
  apiKey: string,
  body: Record<string, any>
): Promise<ParsedResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body)
  })

  const data = await parseResponseBody(response)
  return {
    ok: response.ok,
    status: response.status,
    data,
    requestID: extractRequestIDFromHeaders(response.headers) || extractRequestID(data)
  }
}

function applySSEPayload(
  eventName: string,
  dataLines: string[],
  state: StreamState
): void {
  const raw = dataLines.join('\n').trim()
  if (!raw || raw === '[DONE]') return

  let payload: any = null
  try {
    payload = JSON.parse(raw)
  } catch {
    if (!state.error) state.error = raw
    return
  }

  const type =
    (typeof payload?.type === 'string' && payload.type) || eventName || ''

  if (type === 'response.output_text.delta' && typeof payload?.delta === 'string') {
    state.deltaText += payload.delta
  } else if (
    type === 'response.output_text.done' &&
    typeof payload?.text === 'string'
  ) {
    state.doneText += payload.text
  } else if (type === 'response.completed' && payload?.response) {
    state.finalResponse = payload.response
  } else if (type === 'error' || payload?.error) {
    const err =
      extractResponsesError(payload?.error) ||
      extractResponsesError(payload) ||
      'Stream error'
    state.error = err
    if (typeof payload?.error?.status === 'number') {
      state.status = payload.error.status
    }
  } else if (typeof payload?.output_text === 'string' && payload.output_text) {
    state.doneText += payload.output_text
  }

  const eventRequestID = extractRequestID(payload)
  if (eventRequestID) {
    state.requestID = eventRequestID
  }
}

function processSSEText(rawText: string, state: StreamState): void {
  let eventName = ''
  let dataLines: string[] = []

  const flushEvent = () => {
    if (!eventName && dataLines.length === 0) return
    applySSEPayload(eventName, dataLines, state)
    eventName = ''
    dataLines = []
  }

  rawText.split(/\r?\n/).forEach(line => {
    if (line === '') {
      flushEvent()
      return
    }
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
      return
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimLeft())
      return
    }
  })

  flushEvent()
}

async function postSSE(
  endpoint: string,
  apiKey: string,
  body: Record<string, any>
): Promise<TextRequestResult> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json'
    },
    body: JSON.stringify(body)
  })

  const responseRequestID = extractRequestIDFromHeaders(response.headers)
  if (!response.ok) {
    const errorData = await parseResponseBody(response)
    return {
      ok: false,
      status: response.status,
      error: extractResponsesError(errorData) || `HTTP ${response.status}`,
      api: 'responses',
      endpoint,
      requestID: responseRequestID || extractRequestID(errorData)
    }
  }

  const state: StreamState = {
    deltaText: '',
    doneText: '',
    finalResponse: null,
    error: '',
    status: 0,
    requestID: responseRequestID
  }

  if (response.body && response.body.getReader) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let eventName = ''
    let dataLines: string[] = []

    const flushEvent = () => {
      if (!eventName && dataLines.length === 0) return
      applySSEPayload(eventName, dataLines, state)
      eventName = ''
      dataLines = []
    }

    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        buffer += decoder.decode()
        break
      }
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''

      lines.forEach(line => {
        if (line === '') {
          flushEvent()
          return
        }
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
          return
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimLeft())
        }
      })
    }

    if (buffer) {
      const lines = buffer.split(/\r?\n/)
      lines.forEach(line => {
        if (line === '') {
          flushEvent()
          return
        }
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
          return
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimLeft())
        }
      })
    }
    flushEvent()
  } else {
    const text = await response.text()
    processSSEText(text, state)
  }

  const outputText =
    state.deltaText.trim() ||
    state.doneText.trim() ||
    extractResponsesText(state.finalResponse)
  if (outputText) {
    return {
      ok: true,
      status: 200,
      text: outputText,
      api: 'responses',
      endpoint,
      requestID: state.requestID || extractRequestID(state.finalResponse)
    }
  }

  return {
    ok: false,
    status: state.status || 500,
    error: state.error || 'Empty text in streaming response',
    api: 'responses',
    endpoint,
    requestID: state.requestID
  }
}

async function requestViaResponses(
  options: TextRequestOptions
): Promise<TextRequestResult> {
  const endpoint = getResponsesEndpoint(options.baseURL)

  const simplePayload = {
    model: options.model,
    input: options.prompt
  }

  const structuredPayload = {
    model: options.model,
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: options.prompt }]
      }
    ]
  }

  let response: ParsedResponse
  try {
    response = await postJSON(endpoint, options.apiKey, simplePayload)
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e && e.message ? e.message : 'NETWORK_ERROR',
      api: 'responses',
      endpoint
    }
  }

  let text = response.ok ? extractResponsesText(response.data) : ''
  let error = response.ok
    ? ''
    : extractResponsesError(response.data) || `HTTP ${response.status}`

  if (response.ok && text) {
    return {
      ok: true,
      status: response.status,
      text,
      api: 'responses',
      endpoint,
      requestID: response.requestID
    }
  }

  if (!response.ok && shouldRetryResponses(response.status, error)) {
    await sleep(300)
    try {
      response = await postJSON(endpoint, options.apiKey, simplePayload)
      text = response.ok ? extractResponsesText(response.data) : ''
      error = response.ok
        ? ''
        : extractResponsesError(response.data) || `HTTP ${response.status}`
    } catch (e) {
      return {
        ok: false,
        status: 0,
        error: e && e.message ? e.message : 'NETWORK_ERROR',
        api: 'responses',
        endpoint
      }
    }

    if (response.ok && text) {
      return {
        ok: true,
        status: response.status,
        text,
        api: 'responses',
        endpoint,
        requestID: response.requestID
      }
    }
  }

  if (response.ok && !text) {
    error = 'Empty text in response'
  }

  if (shouldRetryWithStructuredInput(response.status, error)) {
    try {
      response = await postJSON(endpoint, options.apiKey, structuredPayload)
    } catch (e) {
      return {
        ok: false,
        status: 0,
        error: e && e.message ? e.message : 'NETWORK_ERROR',
        api: 'responses',
        endpoint
      }
    }
    text = response.ok ? extractResponsesText(response.data) : ''
    if (response.ok && text) {
      return {
        ok: true,
        status: response.status,
        text,
        api: 'responses',
        endpoint,
        requestID: response.requestID
      }
    }

    error = extractResponsesError(response.data) || `HTTP ${response.status}`
    if (response.ok && !text) {
      error = 'Empty text in response'
    }
  }

  if (shouldTryStreamFallback(response.status, error)) {
    try {
      const streamResult = await postSSE(endpoint, options.apiKey, {
        ...structuredPayload,
        stream: true
      })
      if (streamResult.ok) {
        return streamResult
      }
      error = streamResult.error || error
      return {
        ok: false,
        status: streamResult.status,
        error,
        api: 'responses',
        endpoint,
        requestID: streamResult.requestID || response.requestID
      }
    } catch (e) {
      return {
        ok: false,
        status: 0,
        error: e && e.message ? e.message : 'NETWORK_ERROR',
        api: 'responses',
        endpoint
      }
    }
  }

  return {
    ok: false,
    status: response.status,
    error,
    api: 'responses',
    endpoint,
    requestID: response.requestID
  }
}

async function requestViaChatCompletions(
  options: TextRequestOptions
): Promise<TextRequestResult> {
  const endpoint = getChatCompletionsEndpoint(options.baseURL)
  const payload = {
    model: options.model,
    messages: [{ role: 'user', content: options.prompt }]
  }

  let response: ParsedResponse
  try {
    response = await postJSON(endpoint, options.apiKey, payload)
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e && e.message ? e.message : 'NETWORK_ERROR',
      api: 'chat-completions',
      endpoint
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: extractResponsesError(response.data) || `HTTP ${response.status}`,
      api: 'chat-completions',
      endpoint,
      requestID: response.requestID
    }
  }

  const text = extractChatCompletionsText(response.data)
  if (!text) {
    return {
      ok: false,
      status: response.status,
      error: 'Empty text in response',
      api: 'chat-completions',
      endpoint,
      requestID: response.requestID
    }
  }

  return {
    ok: true,
    status: response.status,
    text,
    api: 'chat-completions',
    endpoint,
    requestID: response.requestID
  }
}

export async function requestOpenAIText(
  options: TextRequestOptions
): Promise<TextRequestResult> {
  const responsesResult = await requestViaResponses(options)
  if (responsesResult.ok) {
    return responsesResult
  }

  if (!shouldFallbackToChat(responsesResult.status, responsesResult.error || '')) {
    return responsesResult
  }

  const chatResult = await requestViaChatCompletions(options)
  if (chatResult.ok) {
    return chatResult
  }

  return {
    ok: false,
    status: chatResult.status || responsesResult.status,
    error: [responsesResult.error, chatResult.error].filter(Boolean).join(' | '),
    api: chatResult.api,
    endpoint: chatResult.endpoint,
    requestID: chatResult.requestID || responsesResult.requestID
  }
}

export async function testOpenAIResponses(options: {
  baseURL?: string
  apiKey?: string
  model?: string
  accounts?: string
  activeAccount?: string
}): Promise<{
  ok: boolean
  status: number
  text?: string
  error?: string
  api?: OpenAIAPIType
  endpoint?: string
  requestID?: string
}> {
  const resolved = resolveCustomAuth(options)
  if (!resolved.ok || !resolved.apiKey || !resolved.model) {
    return {
      ok: false,
      status: 0,
      error: resolved.error || 'Invalid custom auth config',
      api: 'responses',
      endpoint: getResponsesEndpoint(options.baseURL || resolved.baseURL)
    }
  }

  const result = await requestOpenAIText({
    baseURL: resolved.baseURL || options.baseURL,
    apiKey: resolved.apiKey,
    model: resolved.model,
    prompt:
      "Translate 'hello world' into Simplified Chinese. Return only translated text."
  })

  return result
}
