const DEFAULT_BASE_URL = 'https://api.openai.com'

export function getResponsesEndpoint(baseURL?: string): string {
  const raw = (baseURL || DEFAULT_BASE_URL).trim()
  const trimmed = raw.replace(/\/+$/, '')

  if (/\/responses$/i.test(trimmed)) {
    return trimmed
  }
  if (/\/v1$/i.test(trimmed)) {
    return `${trimmed}/responses`
  }
  return `${trimmed}/v1/responses`
}

export function extractResponsesText(data: any): string {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim()
  }

  if (Array.isArray(data?.output)) {
    const text = data.output
      .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
      .map((item: any) => {
        if (typeof item?.text === 'string') return item.text
        if (typeof item?.output_text === 'string') return item.output_text
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
    if (text) return text
  }

  const chatContent = data?.choices?.[0]?.message?.content
  if (typeof chatContent === 'string' && chatContent.trim()) {
    return chatContent.trim()
  }
  if (Array.isArray(chatContent)) {
    const text = chatContent
      .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
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
  if (typeof data?.error?.message === 'string' && data.error.message.trim()) {
    return data.error.message.trim()
  }
  if (typeof data?.message === 'string' && data.message.trim()) {
    return data.message.trim()
  }
  return ''
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
}> {
  const endpoint = getResponsesEndpoint(options.baseURL)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: options.model,
      input:
        "Translate 'hello world' into Simplified Chinese. Return only translated text."
    })
  })

  let data: any = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: extractResponsesError(data) || `HTTP ${response.status}`
    }
  }

  const text = extractResponsesText(data)
  if (!text) {
    return {
      ok: false,
      status: response.status,
      error: 'Empty text in response'
    }
  }

  return {
    ok: true,
    status: response.status,
    text
  }
}
