import React, { FC, useState } from 'react'
import { Input, Button, notification, Form, Select } from 'antd'
import { useSelector } from '@/content/redux'
import { getConfigPath } from '@/options/helpers/path-joiner'
import {
  SaladictForm,
  SaladictFormItem
} from '@/options/components/SaladictForm'
import { useTranslate, Trans } from '@/_helpers/i18n'
import { objectKeys } from '@/typings/helpers'
import {
  testOpenAIResponses,
  getCustomAccountNames
} from '@/components/dictionaries/custom/api'

const ACCOUNT_TEMPLATE = [
  'office|https://api.openai.com/v1|sk-your-api-key|gpt-4.1-mini',
  'local|https://openai-compatible.example.com/v1|sk-local-key|gpt-4o-mini'
].join('\n')

export const DictAuths: FC = () => {
  const { t } = useTranslate(['options', 'dicts'])
  const dictAuths = useSelector(state => state.config.dictAuth)
  const [form] = Form.useForm()
  const [testing, setTesting] = useState(false)

  const initialCustomAccounts =
    dictAuths &&
    dictAuths.custom &&
    typeof dictAuths.custom.accounts === 'string'
      ? dictAuths.custom.accounts
      : ''
  const initialActiveAccount =
    dictAuths &&
    dictAuths.custom &&
    typeof dictAuths.custom.activeAccount === 'string'
      ? dictAuths.custom.activeAccount.trim()
      : ''
  const [customAccountNames, setCustomAccountNames] = useState<string[]>(() => {
    const names = getCustomAccountNames(initialCustomAccounts)
    if (initialActiveAccount) {
      names.push(initialActiveAccount)
    }
    return Array.from(new Set(names.filter(Boolean)))
  })

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
      const isCustomAccounts = dictID === 'custom' && key === 'accounts'
      const isCustomActiveAccount = dictID === 'custom' && key === 'activeAccount'
      formItems.push({
        name: configPath + '.' + key,
        label: (
          <span>
            {i === 0 ? title + ' ' : ''}
            <code>{key}</code>
          </span>
        ),
        extra: isCustomAccounts
          ? '可选：配置多个账号，每行一条，格式 name|baseURL|apiKey|model'
          : isCustomActiveAccount
            ? '可选：留空时默认使用第一条有效账号。'
          : undefined,
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
        children: isCustomAccounts ? (
          <div>
            <Input.TextArea
              autoComplete="off"
              autoSize={{ minRows: 3, maxRows: 10 }}
              placeholder="name|baseURL|apiKey|model"
              onChange={event => {
                const nextAccounts = event.target.value
                const currentActiveAccount = form.getFieldValue(
                  `${configPath}.activeAccount`
                )
                const names = getCustomAccountNames(nextAccounts)
                if (
                  typeof currentActiveAccount === 'string' &&
                  currentActiveAccount.trim()
                ) {
                  names.push(currentActiveAccount.trim())
                }
                setCustomAccountNames(Array.from(new Set(names.filter(Boolean))))
              }}
            />
            <div style={{ marginTop: 8 }}>
              <Button
                size="small"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(ACCOUNT_TEMPLATE)
                    notification.success({
                      message: '已复制账号模板',
                      description: '可直接粘贴到 accounts 中再修改。'
                    })
                  } catch (e) {
                    notification.warning({
                      message: '复制失败',
                      description: '请手动复制下方示例模板。'
                    })
                  }
                }}
              >
                复制示例模板
              </Button>
            </div>
            <pre
              style={{
                marginTop: 8,
                marginBottom: 0,
                padding: 8,
                border: '1px solid #f0f0f0',
                borderRadius: 2,
                background: '#fafafa',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}
            >
              {ACCOUNT_TEMPLATE}
            </pre>
          </div>
        ) : isCustomActiveAccount ? (
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="选择账号名（留空=第一条）"
            options={customAccountNames.map(name => ({
              label: name,
              value: name
            }))}
          />
        ) : (
          <Input autoComplete="off" />
        )
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
              const baseURL = form.getFieldValue(`${base}.baseURL`)
              const apiKey = form.getFieldValue(`${base}.apiKey`)
              const model = form.getFieldValue(`${base}.model`)
              const accounts = form.getFieldValue(`${base}.accounts`)
              const activeAccount = form.getFieldValue(`${base}.activeAccount`)

              if ((!apiKey || !model) && !accounts) {
                notification.warning({
                  message: 'Missing fields',
                  description:
                    'Fill apiKey/model or provide accounts list first.'
                })
                return
              }

              setTesting(true)
              try {
                const result = await testOpenAIResponses({
                  baseURL,
                  apiKey,
                  model,
                  accounts,
                  activeAccount
                })
                const requestIDText = result.requestID
                  ? `request_id=${result.requestID}`
                  : ''

                if (result.ok) {
                  notification.success({
                    message:
                      result.api === 'chat-completions'
                        ? 'OpenAI Compatible test succeeded (chat fallback)'
                        : 'OpenAI Compatible test succeeded',
                    description: [result.text, requestIDText]
                      .filter(Boolean)
                      .join('\n')
                  })
                } else {
                  notification.error({
                    message: `OpenAI Compatible test failed (${result.status})`,
                    description: [result.error, result.endpoint, requestIDText]
                      .filter(Boolean)
                      .join(' @ ')
                  })
                }
              } catch (e) {
                const msg = e && e.message ? e.message : 'Unknown error'
                const stack =
                  e && typeof e.stack === 'string' ? e.stack.split('\n').slice(0, 3).join('\n') : ''
                notification.error({
                  message: 'OpenAI Compatible test failed',
                  description: [msg, stack].filter(Boolean).join('\n')
                })
              } finally {
                setTesting(false)
              }
            }}
          >
            Test OpenAI Compatible API
          </Button>
        )
      })
    }
  })

  return <SaladictForm items={formItems} form={form} />
}
