import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookX,
  Camera,
  Check,
  ChevronRight,
  ClipboardCheck,
  Flame,
  Languages,
  PenLine,
  Target,
  Timer,
  Sparkles,
  CalendarDays,
} from 'lucide-react'
import { api, fmtDate } from '../api'
import { useApp } from '../store'
import { Donut, EmptyState, ProgressBar, SectionBadge, StatCard } from '../components/UI'

function useNow() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

function Hero({ dashboard }) {
  const now = useNow()
  const exam = new Date(dashboard.exam.date)
  const ms = Math.max(0, exam.getTime() - now)
  const days = Math.floor(ms / 86400000)
  const hours = Math.floor((ms % 86400000) / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const start = new Date('2026-11-16T00:00:00+08:00')
  const dayIndex = Math.max(1, Math.min(26, Math.floor((now - start.getTime()) / 86400000) + 1))
  const score = dashboard.score
  const gap = Math.max(0, Math.round((score.target - score.total) * 10) / 10)

  return (
    <section className="hero-grid">
      <div className="hero-card">
        <div className="hero-grid-lines" aria-hidden="true" />
        <div className="hero-top">
          <span className="hero-kicker">
            <span className="pulse-dot" />
            CET-4 · 2026.12.12 09:00
          </span>
          <span className="hero-day">第 {dayIndex} / 26 天</span>
        </div>
        <div className="hero-main">
          <div className="hero-count">
            <strong>{days}</strong>
            <span>天</span>
          </div>
          <div className="hero-clock">
            <em>{String(hours).padStart(2, '0')}</em>
            <i>:</i>
            <em>{String(minutes).padStart(2, '0')}</em>
            <i>:</i>
            <em>{String(seconds).padStart(2, '0')}</em>
          </div>
        </div>
        <div className="hero-sub">
          距离考试还有 <b>{days} 天</b>。今天只做计划里的事，不补昨天的量。
        </div>
        <div className="hero-foot">
          <div className="hero-phase">
            <span>当前阶段</span>
            <strong>{dashboard.plan.day?.phase || '冲刺中'}</strong>
            <em>{dashboard.plan.day?.theme || ''}</em>
          </div>
          <div className="hero-cta">
            <Link to="/timer" className="btn btn-accent">
              <Timer size={16} />
              开始计时
            </Link>
            <Link to="/capture" className="btn btn-ghost-light">
              <Camera size={16} />
              传错题
            </Link>
          </div>
        </div>
      </div>

      <div className="score-card">
        <div className="score-card-head">
          <div>
            <span className="card-kicker">目标总分</span>
            <div className="score-target">
              <strong>{score.target}</strong>
              <span>/ 710</span>
            </div>
          </div>
          <span className={`badge ${score.tested ? 'badge-teal' : 'badge-muted'}`}>
            {score.tested ? `估算 ${score.total}` : '还没测过'}
          </span>
        </div>

        <div className="score-card-body">
          <Donut value={score.total} max={score.target} size={132} stroke={11} color="#E85D2A">
            <strong className="donut-num">{score.tested ? Math.round(score.total) : '—'}</strong>
            <span className="donut-label">当前估算</span>
          </Donut>
          <div className="score-list">
            {[
              ['听力', 'listening', 248.5],
              ['阅读', 'reading', 248.5],
              ['写作', 'writing', 106.5],
              ['翻译', 'translation', 106.5],
            ].map(([label, key, max]) => {
              const s = score.sections[key]
              return (
                <div className="score-row" key={key}>
                  <div className="score-row-top">
                    <span>{label}</span>
                    <em>
                      {s.value === null ? '—' : Math.round(s.value)} <i>/ {s.target}</i>
                    </em>
                  </div>
                  <div className="score-mini-track">
                    <i style={{ width: `${Math.min(100, ((s.value || 0) / s.target) * 100)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="score-card-foot">
          {score.tested ? (
            <>
              <span>{gap > 0 ? `离 ${score.target} 还差 ${gap} 分` : '已达到目标，保持手感'}</span>
              <Link to="/analytics">
                看差距 <ArrowRight size={14} />
              </Link>
            </>
          ) : (
            <>
              <span>做一次模考或计时训练，就能估算你的分数</span>
              <Link to="/mock">
                去记分 <ArrowRight size={14} />
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

export default function Dashboard() {
  const { dashboard, loading, refreshDashboard, notify } = useApp()
  const [tasks, setTasks] = useState([])
  const day = dashboard?.plan?.day

  useEffect(() => {
    setTasks(day?.tasks || [])
  }, [day])

  const doneCount = tasks.filter((t) => t.done).length

  const toggleTask = async (index) => {
    if (!day) return
    const nextDone = !tasks[index].done
    setTasks((prev) => prev.map((t, i) => (i === index ? { ...t, done: nextDone } : t)))
    try {
      await api.post('/api/plan/toggle', { date: day.date, index, done: nextDone })
      refreshDashboard()
    } catch (err) {
      notify(err.message, 'error')
      setTasks(day.tasks)
    }
  }

  const chartData = dashboard?.daily || []
  const maxTasks = Math.max(1, ...chartData.map((d) => d.tasks || 0))
  const maxMinutes = Math.max(1, ...chartData.map((d) => d.minutes || 0))

  const recentItems = useMemo(() => {
    if (!dashboard) return []
    const qs = (dashboard.recent.questions || []).map((q) => ({
      type: 'question',
      id: `q${q.id}`,
      section: q.section,
      title: q.question_text || '错题记录',
      meta: `${q.subtype || ''} · ${fmtDate(q.created_at)}`,
      status: q.is_correct === true ? '已对' : '待复盘',
      to: '/wrong',
    }))
    const ws = (dashboard.recent.writings || []).map((w) => ({
      type: 'writing',
      id: `w${w.id}`,
      section: w.kind === 'translation' ? '翻译' : '写作',
      title: w.prompt || (w.kind === 'translation' ? '翻译批改' : '作文批改'),
      meta: `${w.band || ''} · ${fmtDate(w.created_at)}`,
      status: `${Math.round(w.score106)} 分`,
      to: '/grade',
    }))
    return [...qs, ...ws].slice(0, 5)
  }, [dashboard])

  if (loading || !dashboard) {
    return (
      <div className="page-loading">
        <span className="spinner" />
        <p>正在整理今天的任务…</p>
      </div>
    )
  }

  const focus = dashboard.focus

  return (
    <div className="dashboard">
      <Hero dashboard={dashboard} />

      <section className="stats-row">
        <StatCard
          label="错题本"
          value={dashboard.overview.questions || 0}
          unit="道"
          hint={`${dashboard.overview.mastered || 0} 道已掌握`}
          icon={BookX}
          tone="orange"
        />
        <StatCard
          label="总正确率"
          value={dashboard.overview.accuracy === null ? '—' : dashboard.overview.accuracy}
          unit={dashboard.overview.accuracy === null ? '' : '%'}
          hint={`已作答 ${dashboard.overview.answered || 0} 道`}
          icon={Target}
          tone="teal"
        />
        <StatCard
          label="连续打卡"
          value={dashboard.streak.streak || 0}
          unit="天"
          hint={dashboard.streak.today_done ? '今天已完成' : '今天还没开始'}
          icon={Flame}
          tone="violet"
        />
        <StatCard
          label="待复习单词"
          value={dashboard.due_vocab || 0}
          unit="个"
          hint={`共 ${dashboard.overview.vocab_total || 0} 个`}
          icon={Languages}
          tone="blue"
        />
      </section>

      <section className="dash-grid">
        <div className="card today-card">
          <div className="card-head">
            <div>
              <span className="card-kicker">{dashboard.plan.is_today ? '今日任务' : '下一课任务'}</span>
              <h2>{dashboard.plan.day?.date} · {dashboard.plan.day?.theme}</h2>
            </div>
            <span className="count-chip">{doneCount}/{tasks.length}</span>
          </div>
          <ProgressBar value={doneCount} max={tasks.length || 1} color="var(--teal)" height={6} />
          <ul className="task-list">
            {tasks.map((task, index) => (
              <li key={`${task.label}-${index}`} className={task.done ? 'done' : ''}>
                <button
                  type="button"
                  className={`task-check ${task.done ? 'checked' : ''}`}
                  onClick={() => toggleTask(index)}
                  aria-label={task.done ? '取消完成' : '标记完成'}
                >
                  {task.done && <Check size={13} strokeWidth={3} />}
                </button>
                <div className="task-body">
                  <div className="task-line">
                    <span className="task-time">{task.time}</span>
                    <strong>{task.label}</strong>
                  </div>
                  <p>{task.text}</p>
                </div>
              </li>
            ))}
            {!tasks.length && (
              <EmptyState
                icon={CalendarDays}
                title="今天没有安排任务"
                desc="去 26 天计划看看下一课要做什么。"
                action={<Link className="btn btn-primary btn-sm" to="/plan">打开计划</Link>}
              />
            )}
          </ul>
          <div className="card-foot">
            <span className="muted">
              KPI：{dashboard.plan.day?.kpi || '完成今天的任务即可'}
            </span>
            <Link to="/plan" className="text-link">
              查看 26 天计划 <ChevronRight size={14} />
            </Link>
          </div>
        </div>

        <div className="card focus-card">
          <div className="focus-kicker">
            <Sparkles size={15} />
            今日聚焦
          </div>
          <h3>{focus?.title}</h3>
          <p>{focus?.reason}</p>
          <div className="focus-advice">{focus?.action}</div>
          <Link to={focus?.link || '/capture'} className="btn btn-primary btn-sm">
            去处理 <ArrowRight size={14} />
          </Link>
          <div className="focus-divider" />
          <div className="focus-plan">
            <span>计划主线</span>
            <p>{dashboard.today_focus}</p>
          </div>
          <div className="focus-goal">
            <span>目标</span>
            <b>写作 80 · 听力 165 · 阅读 165 · 翻译 70</b>
          </div>
        </div>
      </section>

      <section className="dash-grid dash-grid-equal">
        <div className="card activity-card">
          <div className="card-head">
            <div>
              <span className="card-kicker">近 7 天</span>
              <h2>学习节奏</h2>
            </div>
            <div className="legend">
              <span className="legend-item"><i className="dot-teal" />完成任务</span>
              <span className="legend-item"><i className="dot-orange" />学习分钟</span>
            </div>
          </div>
          <div className="mini-chart">
            {chartData.map((d) => (
              <div className="mini-col" key={d.date}>
                <div className="mini-bar-area">
                  <div
                    className="mini-bar bar-teal"
                    style={{ height: `${Math.max(3, ((d.tasks || 0) / maxTasks) * 100)}%` }}
                    title={`完成 ${d.tasks || 0} 个任务`}
                  />
                  <div
                    className="mini-bar bar-orange"
                    style={{ height: `${Math.max(3, ((d.minutes || 0) / maxMinutes) * 100)}%` }}
                    title={`学习 ${d.minutes || 0} 分钟`}
                  />
                </div>
                <span>{d.label}</span>
              </div>
            ))}
          </div>
          <div className="card-foot">
            <span className="muted">
              本周累计 {chartData.reduce((s, d) => s + (d.minutes || 0), 0)} 分钟 · 完成 {chartData.reduce((s, d) => s + (d.tasks || 0), 0)} 个任务
            </span>
          </div>
        </div>

        <div className="card recent-card">
          <div className="card-head">
            <div>
              <span className="card-kicker">最近记录</span>
              <h2>刚刚留下的痕迹</h2>
            </div>
            <Link to="/wrong" className="text-link">
              全部 <ChevronRight size={14} />
            </Link>
          </div>
          {recentItems.length ? (
            <ul className="recent-list">
              {recentItems.map((item) => (
                <li key={item.id}>
                  <SectionBadge section={item.section} />
                  <div className="recent-body">
                    <Link to={item.to} className="recent-title">
                      {item.title}
                    </Link>
                    <span>{item.meta}</span>
                  </div>
                  <span className="recent-status">{item.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={BookX}
              title="还没有记录"
              desc="拍一张做错的题，或提交一篇作文，系统开始认识你。"
              action={
                <Link to="/capture" className="btn btn-primary btn-sm">
                  上传第一道错题
                </Link>
              }
            />
          )}
        </div>
      </section>

      <section className="quick-grid">
        {[
          { to: '/timer', icon: Timer, title: '限时训练', desc: '按考场节奏卡时间', tone: 'orange' },
          { to: '/capture', icon: Camera, title: '拍照解析', desc: '题目、答案、生词一次拆清', tone: 'teal' },
          { to: '/grade', icon: PenLine, title: '作文 / 翻译批改', desc: '15 分制 + 错误清单', tone: 'violet' },
          { to: '/mock', icon: ClipboardCheck, title: '模考记分', desc: '看离 480 还差多少', tone: 'blue' },
        ].map((item) => {
          const Icon = item.icon
          return (
            <Link to={item.to} key={item.to} className={`quick-card tone-${item.tone}`}>
              <span className="quick-icon"><Icon size={20} strokeWidth={1.8} /></span>
              <div>
                <strong>{item.title}</strong>
                <span>{item.desc}</span>
              </div>
              <ArrowRight size={16} className="quick-arrow" />
            </Link>
          )
        })}
      </section>
    </div>
  )
}