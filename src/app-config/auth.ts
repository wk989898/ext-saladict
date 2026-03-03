import { auth as baidu } from '@/components/dictionaries/baidu/auth'
import { auth as caiyun } from '@/components/dictionaries/caiyun/auth'
import { auth as custom } from '@/components/dictionaries/custom/auth'
import { auth as sogou } from '@/components/dictionaries/sogou/auth'
import { auth as tencent } from '@/components/dictionaries/tencent/auth'
import { auth as youdaotrans } from '@/components/dictionaries/youdaotrans/auth'

export const defaultDictAuths = {
  baidu,
  caiyun,
  custom,
  sogou,
  tencent,
  youdaotrans
}

export type DictAuths = typeof defaultDictAuths

export const getDefaultDictAuths = (): DictAuths =>
  JSON.parse(JSON.stringify(defaultDictAuths))
