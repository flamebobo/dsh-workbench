import { getJson, trimSlash, type ConnectorContext } from './http.ts'
import { jenkinsAuth } from './jenkins.ts'

export type SystemId = 'zentao' | 'gitlab' | 'jenkins'
export interface FieldDef { key: string; label: string; secret?: boolean; optional?: boolean; placeholder?: string; url?: boolean }
export interface ConnectionDef { id: SystemId; label: string; fields: FieldDef[] }

/** The credential names the connectors read (same names as in ~/.dsh/.env), grouped for the settings page. */
export const CONNECTIONS: ConnectionDef[] = [
  { id: 'zentao', label: '禅道', fields: [
    { key: 'WORKBENCH_ZENTAO_URL', label: '地址', placeholder: 'https://zentao.example.com', url: true },
    { key: 'WORKBENCH_ZENTAO_ACCOUNT', label: '账号' },
    { key: 'WORKBENCH_ZENTAO_PASSWORD', label: '密码', secret: true },
    { key: 'WORKBENCH_ZENTAO_EXECUTION_IDS', label: '执行 / 迭代 ID', optional: true, placeholder: '12,15（逗号分隔）。留空则自动读取我能看到的进行中的执行；Bug 同理，留空时读取全部产品' },
  ] },
  { id: 'gitlab', label: 'GitLab', fields: [
    { key: 'WORKBENCH_GITLAB_URL', label: '地址', placeholder: 'https://gitlab.example.com', url: true },
    { key: 'WORKBENCH_GITLAB_TOKEN', label: 'Access Token', secret: true, placeholder: 'glpat-…（需要 read_api 权限）' },
  ] },
  { id: 'jenkins', label: 'Jenkins', fields: [
    { key: 'WORKBENCH_JENKINS_URL', label: '地址', placeholder: 'https://jenkins.example.com', url: true },
    { key: 'WORKBENCH_JENKINS_USER', label: '用户名' },
    { key: 'WORKBENCH_JENKINS_TOKEN', label: 'API Token', secret: true, placeholder: '用户设置里生成的 API Token（需要有构建权限）' },
  ] },
]

/** One live round trip per system; resolves to a human message, rejects with the reason. */
export async function testConnection(id: SystemId, c: ConnectorContext): Promise<string> {
  if (id === 'zentao') {
    const [url, account, password] = await Promise.all(['WORKBENCH_ZENTAO_URL', 'WORKBENCH_ZENTAO_ACCOUNT', 'WORKBENCH_ZENTAO_PASSWORD'].map((n) => c.creds(n)))
    if (!url || !account || !password) throw new Error('请先填写地址、账号和密码并保存')
    const r = await getJson<{ token?: string }>(c.fetch, `${trimSlash(url)}/api.php/v1/tokens`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, password }),
    })
    if (!r.token) throw new Error('禅道没有返回 token，请检查账号密码（以及禅道是否开启了 v1 REST API）')
    return `连接成功：已用账号 ${account} 取得禅道 token`
  }
  if (id === 'gitlab') {
    const [url, token] = await Promise.all(['WORKBENCH_GITLAB_URL', 'WORKBENCH_GITLAB_TOKEN'].map((n) => c.creds(n)))
    if (!url || !token) throw new Error('请先填写地址和 Token 并保存')
    const me = await getJson<{ username: string; name?: string }>(c.fetch, `${trimSlash(url)}/api/v4/user`, { headers: { 'PRIVATE-TOKEN': token } })
    return `连接成功：${me.name ?? me.username}（@${me.username}）`
  }
  const a = await jenkinsAuth(c)
  if (!a) throw new Error('请先填写地址、用户名和 Token 并保存')
  const j = await getJson<{ jobs?: unknown[] }>(c.fetch, `${a.base}/api/json?tree=jobs[name]`, { headers: a.headers })
  return `连接成功：可见 ${j.jobs?.length ?? 0} 个 Job`
}
