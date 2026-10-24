import * as React from 'react'
import { notificationState, testNotification } from './notify.ts'
import { ask, HOST, rpc, type ConnectionView, type Issue, type PluginSettings } from './api.ts'
import type { PageProps } from './App.tsx'

const { useState, useEffect } = React

/**
 * Credentials for the three systems. They are stored in DSH's credential store by the Host; the page only learns whether a secret is set
 * (a secret field left empty keeps the stored value) and can never read it back.
 */
export function Settings(p: PageProps & { reloadTodos: () => Promise<void> }) {
  const [conns, setConns] = useState<ConnectionView[]>()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [busy, setBusy] = useState<string>()
  const [sel, setSel] = useState<'general' | 'zentao' | 'gitlab' | 'jenkins' | 'sparkin'>('general')

  const load = async () => { setConns(await rpc<ConnectionView[]>('connections.list')) }
  useEffect(() => { void load().catch((e) => p.notify((e as Error).message)) }, [])
  if (!conns) return <div className="wb-empty" style={{ flex: 1 }}>加载中…</div>

  const valueOf = (c: ConnectionView, f: ConnectionView['fields'][number]) => edits[f.key] ?? (f.secret ? '' : f.value ?? '')
  const say = (id: string, ok: boolean, text: string) => setMsg((m) => ({ ...m, [id]: { ok, text } }))

  async function run(c: ConnectionView, action: 'save' | 'test' | 'clear') {
    setBusy(`${c.id}:${action}`)
    try {
      if (action === 'clear') {
        if (!(await ask(`清除${c.label}的全部凭据？`))) return
        setConns(await rpc<ConnectionView[]>('connections.clear', { id: c.id }))
        setEdits((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !c.fields.some((f) => f.key === k))))
        say(c.id, true, '已清除，待办回到演示数据')
        await p.refresh(); await p.reloadTodos()
        return
      }
      if (action === 'save' || Object.keys(edits).some((k) => c.fields.some((f) => f.key === k))) {
        const values = Object.fromEntries(c.fields.filter((f) => f.key in edits).map((f) => [f.key, edits[f.key]]))
        setConns(await rpc<ConnectionView[]>('connections.save', { id: c.id, values }))
        setEdits((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !c.fields.some((f) => f.key === k))))
      }
      if (action === 'save') { say(c.id, true, '已保存'); await p.reloadTodos(); return }
      const r = await rpc<{ ok: boolean; message: string }>('connections.test', { id: c.id })
      say(c.id, r.ok, r.message)
      if (r.ok) await p.reloadTodos()
    } catch (e) { say(c.id, false, (e as Error).message) } finally { setBusy(undefined) }
  }

  const HELP: Record<string, string> = {
    zentao: '使用能登录禅道网页的账号。Bug 按「项目」页的禅道产品 ID 拉取，任务按下面的执行 / 迭代 ID 拉取；两者都没填时自动读取你能看到的产品和进行中的执行。',
    gitlab: '在 GitLab「用户设置 → Access Tokens」创建，勾选 read_api。工作台只读取指派给你评审的合并请求，不会改动仓库。',
    jenkins: '在 Jenkins「用户 → Configure → API Token」生成。待办里读取失败的构建；要用看板的「构建验证」，这个账号还需要有目标 Job 的构建权限。',
  }
  const cur = conns.find((c) => c.id === sel)
  return (
    <div className="wb-split" style={{ flex: 1 }}>
      <nav className="wb-list" style={{ width: 220 }} aria-label="设置菜单">
        <div className="wb-menu-h">插件</div>
        <button className="wb-li" aria-selected={sel === 'general'} onClick={() => setSel('general')}>
          <b>插件设置</b><div className="wb-muted" style={{ fontSize: 12 }}>自动运行、分支与验证、默认值</div>
        </button>
        <div className="wb-menu-h" style={{ marginTop: 10 }}>连接</div>
        {conns.map((c) => (
          <button key={c.id} className="wb-li" aria-selected={sel === c.id} onClick={() => setSel(c.id)}>
            <div className="wb-row"><b>{c.label}</b><span className="wb-grow" />
              <span className="wb-dotx" style={{ background: c.configured ? 'var(--wb-green)' : 'var(--wb-fg3)' }} /></div>
            <div className="wb-muted" style={{ fontSize: 12 }}>{c.configured ? '已配置 · 实时数据' : '未配置 · 演示数据'}</div>
          </button>
        ))}
        <button className="wb-li" aria-selected={sel === 'sparkin'} onClick={() => setSel('sparkin')}>
          <div className="wb-row"><b>Sparkin</b><span className="wb-grow" /><span className="wb-dotx" style={{ background: 'var(--wb-amber)' }} /></div>
          <div className="wb-muted" style={{ fontSize: 12 }}>演示模式 · 待对接</div>
        </button>
      </nav>
      <div className="wb-pane">
        {sel === 'general' ? <General p={p} /> : cur ? (
          <>
            <div className="wb-row"><h3 style={{ margin: 0 }}>{cur.label}</h3>
              <span className={`wb-pill ${cur.configured ? 'live' : 'demo'}`}>{cur.configured ? '已配置' : '未配置 · 演示数据'}</span></div>
            <div className="wb-sub" style={{ margin: '6px 0 14px' }}>{HELP[cur.id]}</div>
            {cur.fields.map((f) => (
              <div className="wb-field" key={f.key}><label>{f.label}{f.optional ? '（可选）' : ''}</label>
                <input className="wb-input" type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false}
                  value={valueOf(cur, f)} placeholder={f.secret && f.set ? '已设置，留空表示不修改' : f.placeholder}
                  onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })} /></div>
            ))}
            <div className="wb-row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
              <button className="wb-btn primary" disabled={!!busy} onClick={() => { void run(cur, 'save') }}>{busy === `${cur.id}:save` ? '保存中…' : '保存'}</button>
              <button className="wb-btn" disabled={!!busy} onClick={() => { void run(cur, 'test') }}>{busy === `${cur.id}:test` ? '测试中…' : '保存并测试连接'}</button>
              {cur.fields.some((f) => f.set) && <button className="wb-btn danger" disabled={!!busy} onClick={() => { void run(cur, 'clear') }}>清除凭据</button>}
            </div>
            {msg[cur.id] && <div className="wb-banner" style={{ margin: '12px 0 0', ...(msg[cur.id]!.ok ? { background: 'color-mix(in srgb, var(--wb-green) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--wb-green) 35%, transparent)' } : { background: 'color-mix(in srgb, var(--wb-red) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--wb-red) 35%, transparent)' }) }}>{msg[cur.id]!.text}</div>}
            <div className="wb-sub" style={{ marginTop: 22 }}>
              账号、密码和 Token 保存在{HOST === 'codex' ? <> Codex 版数据目录的 <code>~/.workbench-codex/credentials.json</code>（仅本机用户可读）</> : <> DSH 的凭据库（<code>~/.dsh/.credentials.yaml</code>，仅本机用户可读）</>}，不会出现在页面、提示词或日志里；Token / 密码栏留空表示不修改。配置好后「我的待办」自动拉取真实数据，每分钟刷新一次。
            </div>
          </>
        ) : (
          <>
            <div className="wb-row"><h3 style={{ margin: 0 }}>Sparkin（工时系统）</h3><span className="wb-pill demo">演示模式</span></div>
            <div className="wb-sub" style={{ margin: '8px 0' }}>
              Sparkin 的接口文档还没提供，所以「我的待办」里的 Sparkin 任务是演示数据，「填报 Sparkin 工时」也只把工时记录在工作台里，不会写入 Sparkin。拿到文档后在这里增加地址和 Token 即可接入，填报流程不变。
              项目与 Sparkin 项目的对应关系在「项目」里编辑项目时设置。
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Demo cards that outlived the demo: shown only when there are some. Clearing asks first, since it also removes started / edited ones. */
function DemoCards({ p }: { p: PageProps }) {
  const left = p.state.demoLeft ?? []
  if (!left.length) return null
  const mine = left.map((id) => p.state.issues.find((i) => i.id === id)).filter(Boolean) as Issue[]
  const used = mine.filter((i) => i.status === 'in_progress').length
  async function clean() {
    if (!(await ask(`清理 ${left.length - used} 张演示卡片？它们来自已接入真实数据的系统，其中可能有你开过工或编辑过的，删除后不可恢复。正在进行中的不会被清理。`))) return
    try { p.notify(`已清理 ${await rpc<number>('demo.clean')} 张演示卡片`); await p.refresh() } catch (e) { p.notify((e as Error).message) }
  }
  return (
    <>
      <h4 className="wb-sec">演示卡片</h4>
      <div className="wb-sub" style={{ marginBottom: 6 }}>看板上还有 {left.length} 张来自演示数据的卡片（{mine.map((i) => i.key).join('、')}），它们的系统已经接入真实数据。没开过工、没编辑过的演示卡片已经自动清理；这些是开过工或编辑过的，保留并带「演示」标记。</div>
      <button className="wb-btn" disabled={left.length === used} onClick={() => { void clean() }}>清理演示卡片</button>
    </>
  )
}

const AGENT_SOURCES = [['zentao', '禅道'], ['gitlab', 'GitLab'], ['jenkins', 'Jenkins'], ['sparkin', 'Sparkin'], ['manual', '手工任务']] as const

/** Everything tunable about the plugin itself; saved in the data file and applied immediately. */
function General({ p }: { p: PageProps }) {
  const saved = p.state.settings
  const [f, setF] = useState<PluginSettings | undefined>(saved)
  const [msg, setMsg] = useState<string>()
  const [perm, setPerm] = useState(notificationState())
  useEffect(() => { if (!f && saved) setF(saved) }, [saved])
  if (!f) return <div className="wb-muted">加载中…</div>
  const set = <K extends keyof PluginSettings>(k: K, v: PluginSettings[K]) => setF({ ...f, [k]: v })
  const n = (k: keyof PluginSettings, label: string, hint: string, min: number, max: number, step = 1) => (
    <div className="wb-field"><label>{label}</label>
      <input className="wb-input" type="number" min={min} max={max} step={step} value={String(f[k] as number)} onChange={(e) => set(k, Number(e.target.value) as never)} />
      <div className="wb-sub" style={{ marginTop: 3 }}>{hint}（{min}–{max}）</div></div>
  )
  const check = (k: 'isolateByDefault' | 'autoTestOnReview' | 'autoDoneOnPass' | 'statsReportEnabled' | 'desktopNotify' | 'syncTodosToBoard', label: string, hint: string) => (
    <label className="wb-pick" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} />
      <span><b>{label}</b><div className="wb-sub">{hint}</div></span></label>
  )
  async function save() {
    try { setF(await rpc<PluginSettings>('settings.save', f)); setMsg('已保存，立即生效'); await p.refresh() } catch (e) { setMsg((e as Error).message) }
  }
  return (
    <>
      <div className="wb-row"><h3 style={{ margin: 0 }}>插件设置</h3></div>
      <div className="wb-sub" style={{ margin: '6px 0 14px' }}>这些值原来写在代码里，现在都能在这里调整；保存后立即生效，并保存在工作台的数据文件里。</div>

      <DemoCards p={p} />
      <h4 className="wb-sec">自动运行</h4>
      {n('autoRunConcurrency', '同时运行的智能体数', '看板「自动运行」时，一次让几个智能体同时工作；1 表示严格按顺序一个一个来', 1, 5)}
      {n('autoRunPollSeconds', '队列检查间隔（秒）', '自动运行时多久检查一次待办队列（会话结束和拖动卡片时会立即检查）', 2, 60)}

      <h4 className="wb-sec">待办与智能体</h4>
      {n('todoRefreshSeconds', '待办自动拉取间隔（秒）', '「我的待办」多久重新拉取禅道 / GitLab / Jenkins', 15, 3600)}
      {check('syncTodosToBoard', '待办同步到看板', '禅道 / GitLab / Jenkins / Sparkin 的待办会自动在看板的「待规划」列建一张卡片；你删除的卡片不会再回来。关闭后只有开工 / 编辑过的待办才有卡片')}
      <div className="wb-field"><label>各来源默认指派的智能体</label>
        <div className="wb-row" style={{ flexWrap: 'wrap' }}>
          {AGENT_SOURCES.map(([k, label]) => (
            <div key={k} style={{ minWidth: 150 }}><div className="wb-sub">{label}</div>
              <select className="wb-select" value={f.defaultAgents[k]} onChange={(e) => set('defaultAgents', { ...f.defaultAgents, [k]: e.target.value })}>
                {p.state.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>))}
        </div></div>
      <div className="wb-field"><label>新会话的权限预设</label>
        <select className="wb-select" value={f.permissionPreset} onChange={(e) => set('permissionPreset', e.target.value as PluginSettings['permissionPreset'])}>
          <option value="workspace-write">工作区内修改（推荐：只能改工作目录，越界操作需要你批准）</option>
          <option value="danger-full-access">完全访问（智能体可改动任何位置，自动运行时请慎用）</option></select></div>

      <h4 className="wb-sec">分支与验证</h4>
      {check('isolateByDefault', '每个任务使用独立的 git 分支和工作树', '项目是 git 仓库时，开工会在工作台数据目录下为任务建分支和工作树，智能体只在里面改，互不干扰、改动可审查；单个项目可在「项目 → 编辑」里单独关闭')}
      <div className="wb-field"><label>任务分支前缀</label>
        <input className="wb-input" value={f.branchPrefix} onChange={(e) => set('branchPrefix', e.target.value)} />
        <div className="wb-sub" style={{ marginTop: 3 }}>例如 wb/ 得到 wb/wb-12-fix-callback；只能包含字母数字和 / _ . -</div></div>
      {check('autoTestOnReview', '智能体完成后自动运行项目的测试命令', '项目配置了测试命令时，会话结束进入「待审核」后自动在任务工作树里运行，结果显示在卡片上')}
      {n('testTimeoutSeconds', '测试超时（秒）', '超过后强制结束并记为失败', 10, 3600)}
      {check('autoDoneOnPass', '测试通过后自动完成', '默认关闭。开启后，「待审核」的任务在测试通过、并且任务分支确有代码改动时自动进入「已完成」；没有测试命令、测试未通过、智能体没有改任何文件（比如只回复了一个问题）时，仍由你验收后拖到「已完成」。')}
      <div className="wb-field"><label>禅道 Bug 完成后回写</label>
        <select className="wb-select" value={f.zentaoWriteBack} onChange={(e) => set('zentaoWriteBack', e.target.value as PluginSettings['zentaoWriteBack'])}>
          <option value="confirm">确认后回写（推荐：显示评论草稿，你点了才发送）</option>
          <option value="auto">自动回写（已完成即评论并改为已解决，不再确认）</option></select>
        <div className="wb-sub" style={{ marginTop: 3 }}>回写 = 给禅道 Bug 加评论并改为「已解决」；只对 Bug 生效，需要先配置禅道账号。</div></div>

      <h4 className="wb-sec">关于与更新</h4>
      <div className="wb-sub" style={{ marginBottom: 6 }}>研发工作台 {p.state.version ?? '开发版'}　·　数据文件版本由插件自动升级，升级前会备份为 <code>workbench.json.v&lt;旧版本&gt;.bak</code></div>
      {HOST === 'codex'
        ? <div className="wb-sub" style={{ marginBottom: 8 }}>Codex 版的更新：拿到新版本后重新运行 <code>install-codex.sh</code>（Windows 为 <code>install-codex.ps1</code>），再重新打开工作台；本地服务会自动换成新版本，数据保留。</div>
        : <>
        <div className="wb-field"><label>更新地址</label>
          <input className="wb-input" value={f.updateCheckUrl} onChange={(e) => set('updateCheckUrl', e.target.value)} placeholder='留空 = 不检查。返回 {"version":"0.3.0","url":"https://…/workbench-plugin-0.3.0.zip","notes":"…"}' />
          <div className="wb-sub" style={{ marginTop: 3 }}>填写并保存后，每天检查一次，有新版本时在工作台顶部提示。</div></div>
        <Update p={p} dirty={f.updateCheckUrl !== saved?.updateCheckUrl} />
        </>}

      <SkillRoots f={f} set={set} example={p.state.exampleSkillRoot} saved={saved} />

      {/* Codex shows the page in a sandboxed frame that only lives while it is open: no desktop notifications there */}
      {HOST !== 'codex' && <>
      <h4 className="wb-sec">桌面通知</h4>
      {check('desktopNotify', '卡片需要你时弹桌面通知', '任务进入「待审核」「已阻塞」或禅道回写完成时提醒；你正在看工作台页面时不弹。点击通知会打开对应卡片')}
      <div className="wb-row" style={{ margin: '4px 0 8px' }}>
        <button className="wb-btn" onClick={() => { void testNotification().then((t) => { setPerm(notificationState()); p.notify(t) }) }}>授权并发送测试通知</button>
        <span className="wb-sub">系统通知权限：{{ granted: '已允许', denied: '已拒绝（到系统设置里允许）', default: '尚未询问', unsupported: '当前环境不支持' }[perm]}</span></div>
      </>}

      <h4 className="wb-sec">统计与上报</h4>
      <div className="wb-field"><label>匿名统计上报地址</label>
        <input className="wb-input" value={f.statsReportUrl} onChange={(e) => set('statsReportUrl', e.target.value)} placeholder="留空 = 不上报，例如 https://stats.example.com/workbench" />
        <div className="wb-sub" style={{ marginTop: 3 }}>只接受 http(s) 地址。上报内容在「统计」页可以先查看：只有汇总数字，不含任务标题、编号、路径和人名。</div></div>
      {check('statsReportEnabled', '每天自动上报一次', '需要先填写上面的地址；关闭时只有你在「统计」页点「立即上报」才会发送')}

      <h4 className="wb-sec">附件、搜索与工时</h4>
      {n('maxUploadMB', '附件大小上限（MB）', '任务描述里上传的图片和文档，单个文件的上限', 1, 200)}
      {n('fileSearchLimit', '@ 搜索显示条数', '在任务描述里输入 @ 时最多列出多少个项目文件', 10, 100)}
      {n('defaultHours', '填报工时的默认小时数', '「填报 Sparkin 工时」里每张卡片预填的工时', 0.5, 24, 0.5)}

      <div className="wb-row" style={{ marginTop: 18 }}>
        <button className="wb-btn primary" onClick={() => { void save() }}>保存</button>
        <button className="wb-btn" title="重新打开首次使用引导：扫描本机仓库并创建项目" onClick={p.openGuide}>重新运行引导</button>
        <button className="wb-btn" onClick={() => { setF(saved); setMsg(undefined) }}>还原</button>
        {msg && <span style={{ color: msg.startsWith('已保存') ? 'var(--wb-green)' : 'var(--wb-red)' }}>{msg}</span>}
      </div>
    </>
  )
}

/** 技能包目录: extra skill directories offered to DSH and to projects (the company convention pack). */
function SkillRoots({ f, set, example, saved }: { f: PluginSettings; set: <K extends keyof PluginSettings>(k: K, v: PluginSettings[K]) => void; example?: string; saved?: PluginSettings }) {
  const [report, setReport] = useState<{ roots: { root: string; exists: boolean; count: number }[]; skills: { name: string; description: string }[] }>()
  const key = (saved?.skillRoots ?? []).join('\n')
  useEffect(() => { void rpc<NonNullable<typeof report>>('skills.packs').then(setReport).catch(() => {}) }, [key])
  return (
    <>
      <h4 className="wb-sec">技能包</h4>
      <div className="wb-field"><label>技能包目录（每行一个；目录下每个技能是 <code>名称/SKILL.md</code>）</label>
        <textarea className="wb-textarea" style={{ minHeight: 64 }} value={f.skillRoots.join('\n')} onChange={(e) => set('skillRoots', e.target.value.split('\n'))} placeholder="例如公司规范技能包所在的目录，留空 = 不使用" />
        <div className="wb-sub" style={{ marginTop: 3 }}>{HOST === 'codex' ? '这些技能可在「智能体」和「项目 → 编辑 → 项目规范技能」里选用，开工时作为技能输入传给 Codex（Codex 自己的技能列表里看不到它们）。' : '保存后这些技能会出现在 DSH 的技能列表里，并可在「项目 → 编辑 → 项目规范技能」里按项目挂载：该项目的任务开工时会自动加载。'}</div></div>
      <div className="wb-row" style={{ margin: '4px 0 8px' }}>
        {example && !f.skillRoots.includes(example) && <button className="wb-btn" title={example} onClick={() => set('skillRoots', [...f.skillRoots.filter((x) => x.trim()), example])}>添加示例技能包</button>}
        <span className="wb-sub">{report ? (report.roots.length ? report.roots.map((r) => `${r.root}：${r.exists ? `${r.count} 个技能` : '目录不存在'}`).join('；') : '尚未配置') : ''}</span></div>
      {!!report?.skills.length && <div className="wb-sub">已保存的技能：{report.skills.map((s) => `/${s.name}`).join('  ')}</div>}
    </>
  )
}

function Update({ p, dirty }: { p: PageProps; dirty: boolean }) {
  const [busy, setBusy] = useState(false)
  const u = p.state.update
  async function check() {
    setBusy(true)
    try { const r = await rpc<{ newer: boolean; latest?: string; error?: string }>('update.check'); await p.refresh(); p.notify(r.error ? `检查失败：${r.error}` : r.newer ? `有新版本 ${r.latest}` : '已经是最新版本') } catch (e) { p.notify((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="wb-row" style={{ margin: '4px 0 8px' }}>
      <button className="wb-btn" disabled={busy || dirty} title={dirty ? '先保存更新地址' : undefined} onClick={() => { void check() }}>{busy ? '检查中…' : '检查更新'}</button>
      {u && <span className="wb-sub" style={{ color: u.error ? 'var(--wb-red)' : undefined }}>上次检查 {new Date(u.checkedAt).toLocaleString('zh-CN', { hour12: false })}：{u.error ?? (u.newer ? `有新版本 ${u.latest}` : '已是最新')}</span>}
    </div>
  )
}
