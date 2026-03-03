import { getDefaultDictAuths } from '@/app-config/auth'
import { objectKeys } from '@/typings/helpers'

type DictAuthLike = {
  readonly [dictID: string]: {
    readonly [key: string]: string
  }
}

const defaultDictAuths = getDefaultDictAuths() as DictAuthLike

export const hasConfiguredDictAuth = (
  dictAuth: DictAuthLike
): boolean =>
  objectKeys(dictAuth).some(dictID => {
    const auth = dictAuth[dictID]
    const defaultAuth = defaultDictAuths[dictID] || ({} as DictAuthLike[string])

    return objectKeys(auth).some(key => {
      const value = auth[key]
      return !!value && value !== defaultAuth[key]
    })
  })
