import React, { FC, useState } from 'react'
import { Input, Button, notification, Form } from 'antd'
import { useSelector } from '@/content/redux'
import { getConfigPath } from '@/options/helpers/path-joiner'
import {
  SaladictForm,
  SaladictFormItem
} from '@/options/components/SaladictForm'
import { useTranslate, Trans } from '@/_helpers/i18n'
import { objectKeys } from '@/typings/helpers'
import { testOpenAIResponses } from '@/components/dictionaries/custom/api'

export const DictAuths: FC = () => {
  const { t } = useTranslate(['options', 'dicts'])
  const dictAuths = useSelector(state => state.config.dictAuth)
  const [form] = Form.useForm()
  const [testing, setTesting] = useState(false)

  if (dictAuths === null) return null

  const formItems: SaladictFormItem[] = [
    {
      key: 'dictauthstitle',
      label: t('nav.DictAuths'),
      children: (
        <span className="ant-form-text">{t('dictAuth.description')}</span>
      )
    }
  ]

  objectKeys(dictAuths).forEach(dictID => {
    const auth = dictAuths[dictID]!
    const configPath = getConfigPath('dictAuth', dictID)
    const title = t(`dicts:${dictID}.name`)

    objectKeys(auth).forEach((key, i, keys) => {
      const isLast = i + 1 === keys.length
      formItems.push({
        name: configPath + '.' + key,
        label: (
          <span>
            {i === 0 ? title + ' ' : ''}
            <code>{key}</code>
          </span>
        ),
        help: isLast ? (
          <Trans message={t('dictAuth.dictHelp')}>
            <a
              href={require(`@/components/dictionaries/${dictID}/auth.ts`).url}
              target="_blank"
              rel="nofollow noopener noreferrer"
            >
              {title}
            </a>
          </Trans>
        ) : null,
        style: { marginBottom: isLast ? 10 : 5 },
        children: <Input autoComplete="off" />
      })
    })

    if (dictID === 'custom') {
      formItems.push({
        key: `${dictID}_test`,
        label: (
          <span>
            {title} <code>test</code>
          </span>
        ),
        children: (
          <Button
            loading={testing}
            onClick={async () => {
              const base = getConfigPath('dictAuth', 'custom')
              const mode = form.getFieldValue(`${base}.mode`)
              const baseURL = form.getFieldValue(`${base}.baseURL`)
              const apiKey = form.getFieldValue(`${base}.apiKey`)
              const model = form.getFieldValue(`${base}.model`)

              if (mode !== 'openai-responses') {
                notification.warning({
                  message: 'Mode mismatch',
                  description:
                    "Current custom mode is not 'openai-responses'."
                })
                return
              }

              if (!apiKey || !model) {
                notification.warning({
                  message: 'Missing fields',
                  description: 'Please fill apiKey and model first.'
                })
                return
              }

              setTesting(true)
              try {
                const result = await testOpenAIResponses({
                  baseURL,
                  apiKey,
                  model
                })

                if (result.ok) {
                  notification.success({
                    message: 'OpenAI test succeeded',
                    description: result.text
                  })
                } else {
                  notification.error({
                    message: `OpenAI test failed (${result.status})`,
                    description: result.error || 'Unknown error'
                  })
                }
              } catch (e) {
                notification.error({
                  message: 'OpenAI test failed',
                  description: e && e.message ? e.message : 'Unknown error'
                })
              } finally {
                setTesting(false)
              }
            }}
          >
            Test OpenAI API
          </Button>
        )
      })
    }
  })

  return <SaladictForm items={formItems} form={form} />
}
