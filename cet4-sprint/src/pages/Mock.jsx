import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts'
import {
  ClipboardCheck,
  Target,
  Trash2,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Info,
  TrendingUp,
  Calculator,
} from 'lucide-react'
import { api, todayISO } from '../api'
import { useApp } from '../store'
import { EmptyState, Field, PageHeader, ProgressBar } from '../components/UI'
import { GATES } from '../constants'

const EMPTY_FORM = {
  date: todayISO(),
  name: '',
  news: '',
  conversation: '',
  passage: '',
  cloze: '',
  match_count: '',
  careful: '',
  writing: '',
  translation: '',
  note: '',
}

function calc(form) {
  const n = (v) => Number(v) || 0
  const listening = Math.round((n(form.news) * 7.1 + n(form.conversation) * 7.1 + n(form.passage) * 14.2) * 10) / 10
  const reading = Math.round((n(form.cloze) * 3.55 + n(form.match_count) * 7.1 + n(form.careful) * 14.2) * 10) / 10
  const writing = n(form.writing)
  const translation = n(form.translation)
  const total = Math.round((listening + reading + writing + translation) * 10) / 10
  return { listening, reading, writing, translation, total, gap: Math.round((480 - total) * 10) / 10 }
}

function gateStatus(gate, mocks, today) {
  if (gate.manual) return { status: 'manual', mock: null }
  const eligible = mocks.filter((m) => m.date <= gate.date)
  const mock = eligible.length ? eligible[eligible.length - 1] : null
  if (!mock) {
    if (today > gate.date) return { status: 'missed', mock: null }
    return { status: 'pending', mock: null }
  }
  let pass = false
  if (gate.id === 1) pass = mock.listening_score >= 110 && mock.reading_score >= 100
  if (gate.id === 2) pass = mock.listening_score >= 125 && mock.reading_score >= 120 && mock.translation >= 55
  if (gate.id === 3) pass = mock.total >= 360
  if (gate.id === 4) {
    pass = mock.total >= 420 && mock.listening_score >= 115.5 && mock.reading_score >= 115.5 && mock.writing >= 56 && mock.translation >= 49
  }
  if (gate.id === 5) pass = mock.total >= 440
  return { status: pass ? 'pass' : 'fail', mock }
}

const STATUS_META = {
  pass: { label: '已达标', icon: ShieldCheck, color: '#0D9488' },
  fail: { label: '未达标', icon: ShieldAlert, color: '#E85D2A' },
  pending: { label: '待测', icon: ShieldQuestion, color: '#64748B' },
  missed: { label: '已错过', icon: ShieldAlert, color: '#B91C1C' },
  manual: { label: '考前自检', icon: Info, color: '#8B5CF6' },
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((p) => (
        <div key={p.dataKey}>
          <i style={{ background: p.color || p.fill }} />
          {p.name}：{p.value} 分
        </div>
      ))}
    </div>
  )
}

export default function Mock() {
  const { notify, refreshDashboard } = useApp()
  const [form, setForm] = useState(EMPTY_FORM)
  const [mocks, setMocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const live = useMemo(() => calc(form), [form])
  const today = todayISO()

  const load = async () => {
    try {
      const data = await api.get('/api/mocks')
      setMocks(data.mocks || [])
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const save = async () => {
    if (!form.news && !form.conversation && !form.passage && !form.cloze && !form.match_count && !form.careful && !form.writing && !form.translation) {
      notify('至少填一个板块的对题数或分数', 'error')
      return
    }
    setSaving(true)
    try {
      await api.post('/api/mocks', {
        ...form,
        news: Number(form.news) || 0,
        conversation: Number(form.conversation) || 0,
        passage: Number(form.passage) || 0,
        cloze: Number(form.cloze) || 0,
        match_count: Number(form.match_count) || 0,
        careful: Number(form.careful) || 0,
        writing: Number(form.writing) || 0,
        translation: Number(form.translation) || 0,
      })
      setForm({ ...EMPTY_FORM, date: today })
      await load()
      refreshDashboard()
      notify('模考已记录')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    if (!window.confirm('删除这次模考记录？')) return
    try {
      await api.del(`/api/mocks/${id}`)
      await load()
      refreshDashboard()
      notify('记录已删除')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const latest = mocks.length ? mocks[mocks.length - 1] : null
  const best = mocks.length ? Math.max(...mocks.map((m) => m.total)) : null
  const trendData = mocks.map((m) => ({ ...m, label: m.date.slice(5) }))

  return (
    <div>
      <PageHeader
        eyebrow="SCORE TRACKER"
        title="模考记分"
        desc="填对题数，自动折算 710 分制。目标 480：听力 165 / 阅读 165 / 写作 80 / 翻译 70。"
        actions={
          <Link to="/timer" className="btn btn-ghost">
            <ClipboardCheck size={16} /> 先做整卷计时
          </Link>
        }
      />

      <div className="mock-grid">
        <div className="card mock-form">
          <div className="card-head">
            <div>
              <span className="card-kicker">录入成绩</span>
              <h2>做完一套，马上填</h2>
            </div>
            <span className="badge badge-muted">目标 480</span>
          </div>

          <div className="two-col">
            <Field label="日期">
              <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="名称（可选）">
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 真题 2024.12 第一套" />
            </Field>
          </div>

          <div className="score-group">
            <div className="score-group-head">
              <span className="score-dot" style={{ background: '#8B5CF6' }} />
              <strong>听力</strong>
              <em>25 题 · 248.5 分</em>
            </div>
            <div className="three-col">
              <Field label="短篇新闻" hint="0-7 题 · 7.1/题">
                <input className="input" type="number" min="0" max="7" value={form.news} onChange={(e) => setForm({ ...form, news: e.target.value })} placeholder="0" />
              </Field>
              <Field label="长对话" hint="0-8 题 · 7.1/题">
                <input className="input" type="number" min="0" max="8" value={form.conversation} onChange={(e) => setForm({ ...form, conversation: e.target.value })} placeholder="0" />
              </Field>
              <Field label="听力篇章" hint="0-10 题 · 14.2/题">
                <input className="input" type="number" min="0" max="10" value={form.passage} onChange={(e) => setForm({ ...form, passage: e.target.value })} placeholder="0" />
              </Field>
            </div>
          </div>

          <div className="score-group">
            <div className="score-group-head">
              <span className="score-dot" style={{ background: '#0D9488' }} />
              <strong>阅读</strong>
              <em>30 题 · 248.5 分</em>
            </div>
            <div className="three-col">
              <Field label="选词填空" hint="0-10 题 · 3.55/题">
                <input className="input" type="number" min="0" max="10" value={form.cloze} onChange={(e) => setForm({ ...form, cloze: e.target.value })} placeholder="0" />
              </Field>
              <Field label="长篇匹配" hint="0-10 题 · 7.1/题">
                <input className="input" type="number" min="0" max="10" value={form.match_count} onChange={(e) => setForm({ ...form, match_count: e.target.value })} placeholder="0" />
              </Field>
              <Field label="仔细阅读" hint="0-10 题 · 14.2/题">
                <input className="input" type="number" min="0" max="10" value={form.careful} onChange={(e) => setForm({ ...form, careful: e.target.value })} placeholder="0" />
              </Field>
            </div>
          </div>

          <div className="score-group">
            <div className="score-group-head">
              <span className="score-dot" style={{ background: '#E85D2A' }} />
              <strong>写作 / 翻译</strong>
              <em>各 106.5 分 · 填自评分</em>
            </div>
            <div className="two-col">
              <Field label="写作得分" hint="目标 80">
                <input className="input" type="number" min="0" max="106.5" step="0.5" value={form.writing} onChange={(e) => setForm({ ...form, writing: e.target.value })} placeholder="0" />
              </Field>
              <Field label="翻译得分" hint="目标 70">
                <input className="input" type="number" min="0" max="106.5" step="0.5" value={form.translation} onChange={(e) => setForm({ ...form, translation: e.target.value })} placeholder="0" />
              </Field>
            </div>
          </div>

          <Field label="备注">
            <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="例如：阅读最后一篇没做完" />
          </Field>

          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={save} disabled={saving}>
            <Calculator size={18} />
            {saving ? '保存中…' : '保存这次模考'}
          </button>
        </div>

        <aside className="mock-aside">
          <div className="card live-score-card">
            <span className="card-kicker">本次折算</span>
            <div className="live-total">
              <strong>{Math.round(live.total * 10) / 10}</strong>
              <span>/ 710</span>
            </div>
            <div className={`live-gap ${live.gap <= 0 ? 'pos' : 'neg'}`}>
              <Target size={16} />
              {live.gap <= 0 ? `超过目标 ${Math.abs(live.gap)} 分` : `离 480 还差 ${live.gap} 分`}
            </div>
            <div className="live-sections">
              {[
                ['听力', live.listening, 248.5, 165, '#8B5CF6'],
                ['阅读', live.reading, 248.5, 165, '#0D9488'],
                ['写作', live.writing, 106.5, 80, '#E85D2A'],
                ['翻译', live.translation, 106.5, 70, '#C2410C'],
              ].map(([label, value, max, target, color]) => (
                <div key={label} className="live-section-row">
                  <span>{label}</span>
                  <div className="live-bar">
                    <i style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
                    <em style={{ left: `${(target / max) * 100}%` }} />
                  </div>
                  <b>{Math.round(value * 10) / 10}</b>
                </div>
              ))}
            </div>
            <p className="muted small">竖线是各板块目标线。填得越完整，估算越准。</p>
          </div>

          <div className="card side-card side-card-soft">
            <span className="card-kicker">历史最好</span>
            <div className="best-score">
              <strong>{best === null ? '—' : best}</strong>
              <span>分</span>
            </div>
            <p className="muted small">
              {latest ? `最近一次 ${latest.date}：${latest.total} 分` : '还没有模考记录'}
            </p>
            <Link to="/analytics" className="text-link">看趋势分析 <ArrowRight size={14} /></Link>
          </div>
        </aside>
      </div>

      <section className="card gates-card">
        <div className="card-head">
          <div>
            <span className="card-kicker">关键闸门</span>
            <h2>按日期对照，不达标就停下来补</h2>
          </div>
          <span className="muted small">今天 {today}</span>
        </div>
        <div className="gate-grid">
          {GATES.map((gate) => {
            const { status, mock } = gateStatus(gate, mocks, today)
            const meta = STATUS_META[status]
            const Icon = meta.icon
            let values = ''
            if (mock) {
              if (gate.id === 1) values = `听 ${mock.listening_score} / 读 ${mock.reading_score}`
              else if (gate.id === 2) values = `听 ${mock.listening_score} / 读 ${mock.reading_score} / 译 ${mock.translation}`
              else values = `总分 ${mock.total}`
            }
            return (
              <div key={gate.id} className={`gate-item gate-${status}`}>
                <div className="gate-top">
                  <span className="gate-icon" style={{ color: meta.color, background: `${meta.color}14` }}>
                    <Icon size={17} />
                  </span>
                  <span className="gate-date">{gate.date.slice(5)}</span>
                  <span className="gate-status" style={{ color: meta.color }}>{meta.label}</span>
                </div>
                <strong>{gate.name}</strong>
                <p className="gate-criteria">{gate.criteria}</p>
                <div className="gate-detail">
                  {status === 'manual' ? gate.detail : values || gate.detail}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="card chart-card">
        <div className="card-head">
          <div>
            <span className="card-kicker">分数趋势</span>
            <h2>每次模考的总分</h2>
          </div>
          <span className="badge badge-teal">{mocks.length} 次</span>
        </div>
        {mocks.length ? (
          <ResponsiveContainer width="100%" height={270}>
            <LineChart data={trendData} margin={{ top: 12, right: 18, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E2D7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#7A8494' }} axisLine={false} tickLine={false} />
              <YAxis domain={[250, 620]} tick={{ fontSize: 11, fill: '#7A8494' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={480} stroke="#E85D2A" strokeDasharray="6 4" label={{ value: '目标 480', fontSize: 11, fill: '#E85D2A', position: 'insideTopRight' }} />
              <Line type="monotone" dataKey="total" name="总分" stroke="#0D9488" strokeWidth={2.5} dot={{ r: 4, fill: '#0D9488' }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState
            icon={TrendingUp}
            title="还没有模考记录"
            desc="周末做一套完整真题，把对题数填进左边，第一次基线就有了。"
            action={<Link to="/timer" className="btn btn-primary btn-sm">去整卷计时</Link>}
          />
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <span className="card-kicker">历史记录</span>
            <h2>所有模考</h2>
          </div>
          <span className="muted small">{mocks.length} 次</span>
        </div>
        {loading ? (
          <div className="inline-empty"><span className="spinner" /> 加载中…</div>
        ) : mocks.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>听力</th>
                  <th>阅读</th>
                  <th>写作</th>
                  <th>翻译</th>
                  <th>总分</th>
                  <th>离 480</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...mocks].reverse().map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="table-main">{m.date}</div>
                      {m.name && <div className="muted small">{m.name}</div>}
                    </td>
                    <td className="num">{m.listening_score}</td>
                    <td className="num">{m.reading_score}</td>
                    <td className="num">{m.writing}</td>
                    <td className="num">{m.translation}</td>
                    <td className="num strong">{m.total}</td>
                    <td className={`num ${m.gap <= 0 ? 'pos' : 'neg'}`}>{m.gap <= 0 ? `+${Math.abs(m.gap)}` : `-${m.gap}`}</td>
                    <td>
                      <button type="button" className="icon-btn danger" onClick={() => remove(m.id)} aria-label="删除">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="inline-empty">还没有记录。</div>
        )}
        <p className="muted small table-note">折算方式：听力 25 题 248.5 分、阅读 30 题 248.5 分，写作/翻译各 106.5 分（自评）。这是备考估算，不等同于官方加权成绩。</p>
      </section>
    </div>
  )
}