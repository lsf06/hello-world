import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  Legend,
} from 'recharts'
import {
  Target,
  BookX,
  Clock,
  PenLine,
  Languages,
  ArrowRight,
  AlertTriangle,
  Lightbulb,
  TrendingUp,
  BarChart3,
} from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import { EmptyState, PageHeader, ProgressBar, SectionBadge, StatCard } from '../components/UI'
import { SECTION_MAP } from '../constants'

const CHART_COLORS = {
  teal: '#0D9488',
  orange: '#E85D2A',
  violet: '#8B5CF6',
  line: '#CBD5E1',
  grid: '#E8E2D7',
  text: '#7A8494',
}

function ChartTooltip({ active, payload, label, suffix = '' }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((p) => (
        <div key={p.dataKey}>
          <i style={{ background: p.color || p.fill }} />
          {p.name}：{p.value}{suffix}
        </div>
      ))}
    </div>
  )
}

function TagRanking({ tags, compact }) {
  if (!tags.length) return <div className="inline-empty">还没有错因标签</div>
  const max = Math.max(...tags.map((t) => t.count))
  return (
    <div className={`tag-ranking ${compact ? 'compact' : ''}`}>
      {tags.map((t, i) => (
        <div className="tag-rank-row" key={t.tag}>
          <span className="rank-index">{String(i + 1).padStart(2, '0')}</span>
          <span className="rank-name">{t.tag}</span>
          <div className="rank-bar">
            <i style={{ width: `${(t.count / max) * 100}%` }} />
          </div>
          <span className="rank-count">{t.count}</span>
        </div>
      ))}
    </div>
  )
}

export default function Analytics() {
  const { notify } = useApp()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get('/api/analytics')
      .then(setData)
      .catch((err) => notify(err.message, 'error'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="page-loading">
        <span className="spinner" />
        <p>正在汇总你的错题和用时…</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="card">
        <EmptyState title="分析加载失败" desc="刷新页面重试。" />
      </div>
    )
  }

  const { overview, bySection, bySubtype, errorTags, daily, sessions, writingErrors, translationErrors, score, mocks } = data
  const accuracyData = bySection.filter((s) => s.accuracy !== null)
  const hasQuestions = overview.questions > 0
  const hasSessions = overview.total_minutes > 0
  const hasMocks = mocks.length > 0
  const gap = Math.round((score.target - score.total) * 10) / 10
  const totalAccuracy = overview.accuracy

  return (
    <div>
      <PageHeader
        eyebrow="DIAGNOSTICS"
        title="学情分析"
        desc="把错题、用时、批改和模考放在一起看：哪块最拖分，今天就补哪块。"
        actions={
          <Link to="/wrong" className="btn btn-ghost">
            <BookX size={16} /> 去错题本
          </Link>
        }
      />

      <section className="stats-row">
        <StatCard label="错题总量" value={overview.questions} unit="道" hint={`已掌握 ${overview.mastered} 道`} icon={BookX} tone="orange" />
        <StatCard label="总正确率" value={totalAccuracy === null ? '—' : totalAccuracy} unit={totalAccuracy === null ? '' : '%'} hint={`已作答 ${overview.answered} 道`} icon={Target} tone="teal" />
        <StatCard label="训练时长" value={overview.total_minutes} unit="分钟" hint={`${sessions.reduce((s, x) => s + x.count, 0)} 次计时`} icon={Clock} tone="violet" />
        <StatCard label="批改均分" value={overview.writing_avg ?? '—'} unit={overview.writing_avg === null ? '' : '分'} hint={`写作 ${overview.writing_count} 篇 · 翻译 ${overview.translation_count} 篇`} icon={PenLine} tone="blue" />
      </section>

      <section className="analytics-grid">
        <div className="card score-gap-card">
          <div className="card-head">
            <div>
              <span className="card-kicker">分数预测</span>
              <h2>离 {score.target} 分还有多远</h2>
            </div>
            <span className={`badge ${score.tested ? (gap <= 0 ? 'badge-teal' : 'badge-orange') : 'badge-muted'}`}>
              {score.tested ? (gap <= 0 ? '已达标' : `还差 ${gap} 分`) : '暂无数据'}
            </span>
          </div>

          <div className="big-score-row">
            <div className="big-score">
              <strong>{score.tested ? Math.round(score.total) : '—'}</strong>
              <span>/ {score.target}</span>
            </div>
            <div className="big-score-side">
              <p>{score.tested ? '按最近一次模考 / 最近批改估算' : '做一次模考或计时训练后开始估算'}</p>
              <Link to="/mock" className="text-link">去模考记分 <ArrowRight size={14} /></Link>
            </div>
          </div>

          <div className="projection-list">
            {[
              ['听力', 'listening', '#8B5CF6'],
              ['阅读', 'reading', '#0D9488'],
              ['写作', 'writing', '#E85D2A'],
              ['翻译', 'translation', '#C2410C'],
            ].map(([label, key, color]) => {
              const s = score.sections[key]
              const current = s.value
              const pct = current === null ? 0 : Math.min(100, (current / s.max) * 100)
              const targetPct = Math.min(100, (s.target / s.max) * 100)
              const sectionGap = current === null ? null : Math.round((s.target - current) * 10) / 10
              return (
                <div key={key} className="projection-row">
                  <div className="projection-label">
                    <strong>{label}</strong>
                    <span>{s.source}</span>
                  </div>
                  <div className="projection-bar-wrap">
                    <div className="projection-bar">
                      <i style={{ width: `${pct}%`, background: color }} />
                      <em style={{ left: `${targetPct}%` }} title={`目标 ${s.target}`} />
                    </div>
                    <div className="projection-meta">
                      <span>当前 {current === null ? '—' : Math.round(current)}</span>
                      <span>目标 {s.target}</span>
                    </div>
                  </div>
                  <div className={`projection-gap ${sectionGap !== null && sectionGap <= 0 ? 'pos' : 'neg'}`}>
                    {sectionGap === null ? '待测' : sectionGap <= 0 ? '达标' : `差 ${sectionGap}`}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="muted small projection-note">估算仅供定位短板，不等同于正式成绩；写作/翻译取最近 3 次批改均值。</p>
        </div>

        <div className="card recommendations-card">
          <div className="card-head">
            <div>
              <span className="card-kicker">今日处方</span>
              <h2>按优先级只做这几件</h2>
            </div>
            <Lightbulb size={20} className="head-icon" />
          </div>
          <div className="rec-list">
            {data.recommendations.map((r, i) => (
              <div className="rec-item" key={i}>
                <span className="rec-priority">{i + 1}</span>
                <div className="rec-body">
                  <strong>{r.title}</strong>
                  <p>{r.reason}</p>
                  <span className="rec-action">{r.action}</span>
                </div>
                <Link to={r.link} className="icon-btn" aria-label="去处理">
                  <ArrowRight size={17} />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="analytics-grid analytics-grid-equal">
        <div className="card chart-card">
          <div className="card-head">
            <div>
              <span className="card-kicker">板块正确率</span>
              <h2>哪一块在拖后腿</h2>
            </div>
          </div>
          {accuracyData.length ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={accuracyData} margin={{ top: 10, right: 10, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 11, fill: CHART_COLORS.text }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: CHART_COLORS.text }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip content={<ChartTooltip suffix="%" />} cursor={{ fill: 'rgba(13,148,136,0.06)' }} />
                <Bar dataKey="accuracy" name="正确率" radius={[6, 6, 0, 0]} maxBarSize={46}>
                  {accuracyData.map((entry) => (
                    <Cell key={entry.key} fill={SECTION_MAP[entry.key]?.color || CHART_COLORS.teal} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="inline-empty">
              <BarChart3 size={18} /> 还没有判定过对错的题，录入错题后这里会出现板块对比。
            </div>
          )}
          {bySubtype.length > 0 && (
            <div className="subtype-list">
              <span className="mini-label">最弱细分题型</span>
              {bySubtype
                .filter((s) => s.accuracy !== null && s.correct + s.wrong >= 1)
                .slice(0, 4)
                .map((s) => (
                  <div key={s.key} className="subtype-row">
                    <span>{s.key}</span>
                    <div className="subtype-bar"><i style={{ width: `${s.accuracy}%` }} /></div>
                    <em>{s.accuracy}%</em>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="card chart-card">
          <div className="card-head">
            <div>
              <span className="card-kicker">错因排行</span>
              <h2>你反复踩的坑</h2>
            </div>
            <span className="badge badge-orange">{errorTags.length} 类</span>
          </div>
          <TagRanking tags={errorTags.slice(0, 8)} />
          {errorTags[0] && (
            <div className="advice-box">
              <AlertTriangle size={15} />
              <div>
                <strong>先改这一个：{errorTags[0].tag}</strong>
                <p>{data.recommendations[0]?.action}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="card chart-card wide-chart">
        <div className="card-head">
          <div>
            <span className="card-kicker">近 14 天</span>
            <h2>任务、错题与学习时长</h2>
          </div>
          <div className="legend">
            <span className="legend-item"><i className="dot-teal" />完成任务</span>
            <span className="legend-item"><i className="dot-orange" />新增错题</span>
            <span className="legend-item"><i className="dot-violet" />学习分钟</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={270}>
          <ComposedChart data={daily} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_COLORS.text }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: CHART_COLORS.text }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: CHART_COLORS.text }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(13,148,136,0.05)' }} />
            <Bar yAxisId="left" dataKey="tasks" name="完成任务" fill={CHART_COLORS.teal} radius={[4, 4, 0, 0]} maxBarSize={16} />
            <Bar yAxisId="left" dataKey="wrong" name="新增错题" fill={CHART_COLORS.orange} radius={[4, 4, 0, 0]} maxBarSize={16} />
            <Line yAxisId="right" type="monotone" dataKey="minutes" name="学习分钟" stroke={CHART_COLORS.violet} strokeWidth={2} dot={{ r: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
        {!hasQuestions && !hasSessions && (
          <p className="muted small">数据还很少：做几组计时、录几道错题，这张图会开始有形状。</p>
        )}
      </section>

      <section className="analytics-grid analytics-grid-equal">
        <div className="card">
          <div className="card-head">
            <div>
              <span className="card-kicker">用时效率</span>
              <h2>时间花在哪，值不值</h2>
            </div>
            <Clock size={20} className="head-icon" />
          </div>
          {sessions.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>板块</th>
                    <th>次数</th>
                    <th>平均计划</th>
                    <th>平均实际</th>
                    <th>偏差</th>
                    <th>正确率</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const delta = s.avg_actual - s.avg_planned
                    return (
                      <tr key={s.section}>
                        <td><SectionBadge section={s.section} /></td>
                        <td className="num">{s.count}</td>
                        <td className="num">{Math.round(s.avg_planned / 60)} 分</td>
                        <td className="num">{Math.round(s.avg_actual / 60)} 分</td>
                        <td className={`num ${delta > 60 ? 'neg' : delta < -60 ? 'pos' : ''}`}>
                          {delta >= 0 ? '+' : ''}{Math.round(delta / 60)} 分
                        </td>
                        <td className="num">{s.accuracy === null ? '—' : `${s.accuracy}%`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="inline-empty">
              <Clock size={18} /> 还没有计时记录，去计时训练跑一组。
            </div>
          )}
          <p className="muted small table-note">偏差为正代表超时。超时 1 分钟以上会标红，说明这一块需要收紧节奏。</p>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <span className="card-kicker">写作 / 翻译</span>
              <h2>个人高频错误</h2>
            </div>
            <PenLine size={20} className="head-icon" />
          </div>
          <div className="writing-error-grid">
            <div>
              <span className="mini-label">作文 · {overview.writing_avg === null ? '暂无均分' : `均分 ${overview.writing_avg}`}</span>
              {writingErrors.length ? (
                <TagRanking tags={writingErrors.slice(0, 6)} compact />
              ) : (
                <div className="inline-empty small">还没有作文批改</div>
              )}
            </div>
            <div>
              <span className="mini-label">翻译 · {overview.translation_avg === null ? '暂无均分' : `均分 ${overview.translation_avg}`}</span>
              {translationErrors.length ? (
                <TagRanking tags={translationErrors.slice(0, 6)} compact />
              ) : (
                <div className="inline-empty small">还没有翻译批改</div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="card chart-card wide-chart">
        <div className="card-head">
          <div>
            <span className="card-kicker">模考趋势</span>
            <h2>总分有没有在涨</h2>
          </div>
          <Link to="/mock" className="text-link">模考记分 <ArrowRight size={14} /></Link>
        </div>
        {hasMocks ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart
              data={mocks.map((m) => ({ ...m, label: m.date.slice(5), 目标: score.target }))}
              margin={{ top: 10, right: 16, left: -16, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_COLORS.text }} axisLine={false} tickLine={false} />
              <YAxis domain={[250, 600]} tick={{ fontSize: 11, fill: CHART_COLORS.text }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip suffix=" 分" />} />
              <ReferenceLine y={score.target} stroke={CHART_COLORS.orange} strokeDasharray="6 4" label={{ value: `目标 ${score.target}`, fontSize: 11, fill: CHART_COLORS.orange, position: 'insideTopRight' }} />
              <Line type="monotone" dataKey="total" name="总分" stroke={CHART_COLORS.teal} strokeWidth={2.5} dot={{ r: 4, fill: CHART_COLORS.teal }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="inline-empty">
            <TrendingUp size={18} /> 还没有模考记录。周末做一套完整的，再来对照 480。
          </div>
        )}
      </section>

      <div className="analytics-footer">
        <Languages size={16} />
        <span>数据只存在本机浏览器对应的本地数据库。坚持每天录一点，分析才有意义。</span>
      </div>
    </div>
  )
}