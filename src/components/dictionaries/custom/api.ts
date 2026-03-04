// Keep runtime dependency as CommonJS require so TypeScript 3.8 does not
// parse modern SDK type declarations from node_modules.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { OpenAI } = require('openai/client')

const DEFAULT_BASE_URL = 'https://api.openai.com'

type OpenAIAPIType = 'responses' | 'chat-completions'

interface TextRequestOptions {
  baseURL?: string
  apiKey: string
  model: string
  prompt: string
}

interface TextRequestResult {
  ok: boolean
  status: number
  text?: string
  error?: string
  api: OpenAIAPIType
  endpoint: string
}

interface ParsedSDKError {
  status: number
  error: string
}

function normalizeBaseURL(baseURL?: string): string {
  const raw = (baseURL || DEFAULT_BASE_URL).trim()
  return raw.replace(/\/+$/, '')
}

function getClientBaseURL(baseURL?: string): string {
  const normalized = normalizeBaseURL(baseURL)
  if (/\/responses$/i.test(normalized)) {
    return normalized.replace(/\/responses$/i, '')
  }
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized.replace(/\/chat\/completions$/i, '')
  }
  if (/\/v1$/i.test(normalized)) {
    return normalized
  }
  return `${normalized}/v1`
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

function createOpenAIClient(
  options: Pick<TextRequestOptions, 'baseURL' | 'apiKey'>
): any {
  return new OpenAI({
    apiKey: options.apiKey,
    baseURL: getClientBaseURL(options.baseURL),
    dangerouslyAllowBrowser: true,
    maxRetries: 0
  })
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

function parseSDKError(rawError: any): ParsedSDKError {
  const status = typeof rawError?.status === 'number' ? rawError.status : 0
  const error =
    extractResponsesError(rawError?.error) ||
    extractResponsesError(rawError) ||
    (typeof rawError?.message === 'string' ? rawError.message : '') ||
    (status ? `HTTP ${status}` : 'NETWORK_ERROR')

  return {
    status,
    error
  }
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
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true
  }
  return /upstream request failed|temporarily unavailable|timeout/i.test(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function requestViaResponses(
  options: TextRequestOptions
): Promise<TextRequestResult> {
  const endpoint = getResponsesEndpoint(options.baseURL)
  const client = createOpenAIClient(options)

  const simplePayload = {
    model: options.model,
    input: options.prompt
  }

  const structuredPayload = {
    model: options.model,
    input: [
      {
        role: 'user' as const,
        content: [{ type: 'input_text' as const, text: options.prompt }]
      }
    ]
  }

  let data: any = null
  let status = 0
  let error = ''

  try {
    data = await client.responses.create(simplePayload)
  } catch (e) {
    const parsed = parseSDKError(e)
    status = parsed.status
    error = parsed.error
  }

  if (!data && shouldRetryResponses(status, error)) {
    await sleep(300)
    try {
      data = await client.responses.create(simplePayload)
      status = 0
      error = ''
    } catch (e) {
      const parsed = parseSDKError(e)
      status = parsed.status
      error = parsed.error
    }
  }

  if (data) {
    const text = extractResponsesText(data)
    if (text) {
      return {
        ok: true,
        status: status || 200,
        text,
        api: 'responses',
        endpoint
      }
    }
    return {
      ok: false,
      status: status || 200,
      error: 'Empty text in response',
      api: 'responses',
      endpoint
    }
  }

  if (shouldRetryWithStructuredInput(status, error)) {
    try {
      data = await client.responses.create(structuredPayload)
    } catch (e) {
      const parsed = parseSDKError(e)
      status = parsed.status
      error = parsed.error
    }

    if (data) {
      const text = extractResponsesText(data)
      if (text) {
        return {
          ok: true,
          status: status || 200,
          text,
          api: 'responses',
          endpoint
        }
      }
      return {
        ok: false,
        status: status || 200,
        error: 'Empty text in response',
        api: 'responses',
        endpoint
      }
    }
  }

  return {
    ok: false,
    status,
    error: error || `HTTP ${status}`,
    api: 'responses',
    endpoint
  }
}

async function requestViaChatCompletions(
  options: TextRequestOptions
): Promise<TextRequestResult> {
  const endpoint = getChatCompletionsEndpoint(options.baseURL)
  const client = createOpenAIClient(options)

  try {
    const data = await client.chat.completions.create({
      model: options.model,
      messages: [{ role: 'user', content: options.prompt }]
    })
    const text = extractChatCompletionsText(data)
    if (!text) {
      return {
        ok: false,
        status: 200,
        error: 'Empty text in response',
        api: 'chat-completions',
        endpoint
      }
    }

    return {
      ok: true,
      status: 200,
      text,
      api: 'chat-completions',
      endpoint
    }
  } catch (e) {
    const parsed = parseSDKError(e)
    return {
      ok: false,
      status: parsed.status,
      error: parsed.error,
      api: 'chat-completions',
      endpoint
    }
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
    endpoint: chatResult.endpoint
  }
}

export async function testOpenAIResponses(options: {
  baseURL?: string
  apiKey: string
  model: string
}): Promise<{
  ok: boolean
  status: number
  text?: string
  error?: string
  api?: OpenAIAPIType
  endpoint?: string
}> {
  const result = await requestOpenAIText({
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    model: options.model,
    prompt:
      "Translate 'hello world' into Simplified Chinese. Return only translated text."
  })

  return result
}
