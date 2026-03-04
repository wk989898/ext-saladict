import { SearchFunction, GetSrcPageFunction } from '../helpers'
import memoizeOne from 'memoize-one'
import { Google } from '@opentranslate/google'
import {
  MachineTranslateResult,
  MachineTranslatePayload,
  getMTArgs,
  machineResult
} from '@/components/MachineTrans/engine'
import { CustomLanguage } from './config'

const DEFAULT_BASE_URL = 'https://api.openai.com'
const DEFAULT_DOC_URL = 'https://platform.openai.com/docs/api-reference/responses'

type OpenAIResponsesResult = MachineTranslateResult<'custom'>

export const getTranslator = memoizeOne(() => new Google({ env: 'ext' }))

export const getSrcPage: GetSrcPageFunction = (_text, config) => {
  return config.dictAuth.custom.baseURL || DEFAULT_DOC_URL
}

function getResponsesEndpoint(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '')
  if (/\/responses$/i.test(trimmed)) {
    return trimmed
  }
  if (/\/v1$/i.test(trimmed)) {
    return `${trimmed}/responses`
  }
  return `${trimmed}/v1/responses`
}

function extractResponsesText(data: any): string {
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

export const search: SearchFunction<
  OpenAIResponsesResult,
  MachineTranslatePayload<CustomLanguage>
> = async (rawText, config, profile, payload) => {
  const { apiKey, model, baseURL, mode } = config.dictAuth.custom
  const translator = getTranslator()

  if (!apiKey || !model || mode !== 'openai-responses') {
    return machineResult(
      {
        result: {
          requireCredential: true,
          id: 'custom',
          sl: 'auto',
          tl: 'auto',
          slInitial: 'hide',
          searchText: { paragraphs: [''] },
          trans: { paragraphs: [''] }
        }
      },
      translator.getSupportLanguages()
    )
  }

  const { sl, tl, text } = await getMTArgs(
    translator,
    rawText,
    profile.dicts.all.custom,
    config,
    payload
  )

  const endpoint = getResponsesEndpoint(baseURL || DEFAULT_BASE_URL)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: `Translate the following text from ${sl} to ${tl}. Preserve original meaning and line breaks. Return only the translated text.\n\n${text}`
    })
  })

  if (!response.ok) {
    throw new Error('NETWORK_ERROR')
  }

  const data = await response.json()
  const translated = extractResponsesText(data)
  if (!translated) {
    throw new Error('NO_RESULT')
  }

  return machineResult(
    {
      result: {
        id: 'custom',
        sl,
        tl,
        slInitial: profile.dicts.all.custom.options.slInitial,
        searchText: {
          paragraphs: text.split(/\n+/),
          tts: ''
        },
        trans: {
          paragraphs: translated.split(/\n+/),
          tts: ''
        }
      }
    },
    translator.getSupportLanguages()
  )
}
