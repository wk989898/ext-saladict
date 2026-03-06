import {
  requestOpenAIText,
  resolveCustomAuth,
  testOpenAIResponses
} from '@/components/dictionaries/custom/api'

interface MockFetchResponse {
  ok: boolean
  status: number
  headers: { get: (name: string) => string | null }
  json: () => Promise<any>
  text: () => Promise<string>
  body?: {
    getReader: () => {
      read: () => Promise<{ done: boolean; value?: Uint8Array }>
    }
  }
}

function createHeaders(map: Record<string, string>): MockFetchResponse['headers'] {
  const lowered = Object.keys(map).reduce((acc, key) => {
    acc[key.toLowerCase()] = map[key]
    return acc
  }, {} as Record<string, string>)
  return {
    get: (name: string) => lowered[name.toLowerCase()] || null
  }
}

function createJSONResponse(
  status: number,
  data: any,
  headers: Record<string, string> = {}
): MockFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: createHeaders(
      Object.assign({ 'content-type': 'application/json' }, headers)
    ),
    json: async () => data,
    text: async () => JSON.stringify(data)
  }
}

function createSSEStreamResponse(
  chunks: string[],
  headers: Record<string, string> = {}
): MockFetchResponse {
  let index = 0
  const body = {
    getReader: () => ({
      read: async () => {
        if (index >= chunks.length) {
          return { done: true }
        }
        const value = new Uint8Array(Buffer.from(chunks[index], 'utf8'))
        index += 1
        return { done: false, value }
      }
    })
  }

  return {
    ok: true,
    status: 200,
    headers: createHeaders(
      Object.assign({ 'content-type': 'text/event-stream' }, headers)
    ),
    json: async () => {
      throw new Error('no json body')
    },
    text: async () => chunks.join(''),
    body
  }
}

describe('Dict/Custom/api', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    ;(global as any).fetch = fetchMock
  })

  it('should fallback to responses stream when non-stream returns upstream 502', async () => {
    const prompt =
      "Translate 'hello world' into Simplified Chinese. Return only translated text."

    fetchMock
      .mockResolvedValueOnce(
        createJSONResponse(
          502,
          { error: { message: 'Upstream request failed' } },
          { 'x-request-id': 'req_non_stream' }
        )
      )
      .mockResolvedValueOnce(
        createSSEStreamResponse([
          'event: response.created\n',
          'data: {"type":"response.created"}\n\n',
          'event: response.output_text.delta\n',
          'data: {"type":"response.output_text.delta","delta":"你好，"}\n\n',
          'event: response.output_text.delta\n',
          'data: {"type":"response.output_text.delta","delta":"世界"}\n\n',
          'event: response.completed\n',
          'data: {"type":"response.completed","response":{"id":"resp_1"}}\n\n'
        ])
      )

    const result = await requestOpenAIText({
      baseURL: 'https://openai-compatible.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-5.2',
      prompt
    })

    expect(result.ok).toBeTruthy()
    expect(result.status).toBe(200)
    expect(result.api).toBe('responses')
    expect(result.text).toBe('你好，世界')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://openai-compatible.example.com/v1/responses'
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'gpt-5.2',
      input: prompt
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      model: 'gpt-5.2',
      stream: true
    })
  })

  it('should expose requestID from responses errors', async () => {
    fetchMock.mockResolvedValueOnce(
      createJSONResponse(
        401,
        { error: { message: 'Invalid API key' } },
        { 'x-request-id': 'req_auth' }
      )
    )

    const result = await requestOpenAIText({
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-invalid',
      model: 'gpt-4.1-mini',
      prompt: 'hello'
    })

    expect(result.ok).toBeFalsy()
    expect(result.status).toBe(401)
    expect(result.error).toContain('Invalid API key')
    expect(result.requestID).toBe('req_auth')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should fallback to chat when responses endpoint is unsupported', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJSONResponse(404, {
          error: { message: '/v1/responses is not supported' }
        })
      )
      .mockResolvedValueOnce(
        createJSONResponse(200, {
          choices: [{ message: { content: '你好世界' } }]
        })
      )

    const result = await requestOpenAIText({
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4.1-mini',
      prompt: 'hello world'
    })

    expect(result.ok).toBeTruthy()
    expect(result.api).toBe('chat-completions')
    expect(result.text).toBe('你好世界')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.openai.com/v1/chat/completions'
    )
  })

  it('should resolve multiple custom accounts and pick active account', () => {
    const resolved = resolveCustomAuth({
      accounts: [
        'office|https://office.example.com/v1|sk-office|gpt-office',
        'home|https://home.example.com/v1|sk-home|gpt-home'
      ].join('\n'),
      activeAccount: 'home'
    })

    expect(resolved.ok).toBeTruthy()
    expect(resolved.source).toBe('accounts')
    expect(resolved.accountName).toBe('home')
    expect(resolved.baseURL).toBe('https://home.example.com/v1')
    expect(resolved.apiKey).toBe('sk-home')
    expect(resolved.model).toBe('gpt-home')
  })

  it('should report error when activeAccount does not exist', () => {
    const resolved = resolveCustomAuth({
      accounts: 'office|https://office.example.com/v1|sk-office|gpt-office',
      activeAccount: 'missing'
    })

    expect(resolved.ok).toBeFalsy()
    expect(resolved.error).toContain('activeAccount')
  })

  it('should run testOpenAIResponses using account config', async () => {
    fetchMock.mockResolvedValueOnce(
      createJSONResponse(200, {
        output_text: '你好，世界'
      })
    )

    const result = await testOpenAIResponses({
      accounts: 'home|https://home.example.com/v1|sk-home|gpt-home',
      activeAccount: 'home'
    })

    expect(result.ok).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://home.example.com/v1/responses'
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'gpt-home'
    })
  })
})
