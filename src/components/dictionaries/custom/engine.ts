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
import {
  requestOpenAIText
} from '@/components/dictionaries/custom/api'

const DEFAULT_BASE_URL = 'https://api.openai.com'
const DEFAULT_DOC_URL = 'https://platform.openai.com/docs/api-reference/responses'

type OpenAIResponsesResult = MachineTranslateResult<'custom'>

export const getTranslator = memoizeOne(() => new Google({ env: 'ext' }))

export const getSrcPage: GetSrcPageFunction = (_text, config) => {
  return config.dictAuth.custom.baseURL || DEFAULT_DOC_URL
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

  const prompt = `Translate the following text from ${sl} to ${tl}. Preserve original meaning and line breaks. Return only the translated text.\n\n${text}`
  const result = await requestOpenAIText({
    baseURL: baseURL || DEFAULT_BASE_URL,
    apiKey,
    model,
    prompt
  })

  if (!result.ok || !result.text) {
    throw new Error('NETWORK_ERROR')
  }
  const translated = result.text

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
