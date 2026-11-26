import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays,
  Check,
  Flame,
  ListChecks,
  Timer,
  Star,
  AlertTriangle,
  Save,
  ChevronRight,
  GraduationCap,
  PenLine,
  Headphones,
  BookOpen,
  Languages,
} from 'lucide-react'
import { api, fmtDate, todayISO } from '../api'
import { useApp } from '../store'
import { EmptyState, PageHeader, ProgressBar, StatCard } from '../components/UI'

const PHASES = [
  { key: 'phase1', label: '阶段一', desc: '建基线 · 跑流程', range: ['2026-11-16', '2026-11-21'], color: '#0D9488' },
  { key: 'phase2', label: '阶段二', desc: '听力阅读专项 · 收紧计时', range: ['2026-11-22', '2026-11-28'], color: '#E85D2A' },
  { key: 'phase3', label: '阶段三', desc: '全真模考 · 补短板', range: ['2026-11-29', '2026-12-06'], color: '#8B5CF6' },
  { key: 'phase4', label: '阶段四', desc: '错题回炉 · 模板定型', range: ['2026-12-07', '2026-12-11'], color: '#2563EB' },
  { key: 'exam', label: '考试日', desc: '12·12 上午', range: ['2026-12-12', '2026-12-12'], color: '#B91C1C' },
]

function phaseOf(date) {
  return PHASES.find((p) => date >= p.range[0] && date <= p.range[1]) || PHASES[0]
}

export default function Plan() {
  const { dashboard, refreshDashboard, notify } = useApp()
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [notes, setNotes] = useState({})
  const [noteSaving, setNoteSaving] = useState(false)
  const today = todayISO()
  const todayRef = useRef(null)

  const load = async () => {
    try {
      const [planData, checkinData] = await Promise.all([api.get('/api/plan'), api.get('/api/checkins')])
      setPlan(planData)
      setNotes(Object.fromEntries((checkinData.checkins || []).map((c) => [c.date, c.note || ''])))
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (filter === 'all' && todayRef.current) {
      const t = setTimeout(() => {
        todayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 450)
      return () => clearTimeout(t)
    }
    return undefined
  }, [filter, loading])

  const toggle = async (day, index) => {
    const done = !day.tasks[index].done
    setPlan((prev) => {
      if (!prev) return prev
      const days = prev.days.map((d) => {
        if (d.date !== day.date) return d
        const tasks = d.tasks.map((t, i) => (i === index ? { ...t, done } : t))
        return { ...d, tasks, done_count: tasks.filter((t) => t.done).length }
      })
      return { ...prev, days }
    })
    try {
      await api.post('/api/plan/toggle', { date: day.date, index, done })
      refreshDashboard()
      if (done) {
        const data = await api.get('/api/checkins')
        if (data.today_done) {
          // streak is reflected in dashboard/sidebar
        }
      }
    } catch (err) {
      notify(err.message, 'error')
      load()
    }
  }

  const saveNote = async (date) => {
    setNoteSaving(true)
    try {
      await api.post('/api/checkins', { date, note: notes[date] || '' })
      notify('复盘已保存')
      refreshDashboard()
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setNoteSaving(false)
    }
  }

  const days = useMemo(() => {
    if (!plan) return []
    if (filter === 'all') return plan.days
    return plan.days.filter((d) => phaseOf(d.date).key === filter)
  }, [plan, filter])

  if (loading || !plan) {
    return (
      <div className="page-loading">
        <span className="spinner" />
        <p>正在展开 26 天计划…</p>
      </div>
    )
  }

  const stats = plan.stats
  const todayDay = plan.days.find((d) => d.date === today)
  const todayDone = todayDay ? todayDay.done_count : 0
  const examDay = plan.days.find((d) => d.is_exam)

  return (
    <div>
      <PageHeader
        eyebrow="26-DAY SPRINT"
        title="26 天计划"
        desc="每天 20min 听力篇章 + 20min 仔细阅读 2 篇 + 15min 写作/翻译，再轮换长篇、长对话、短篇。做完就打勾，断档两天从当天重启。"
        actions={
          <Link to="/timer" className="btn btn-primary">
            <Timer size={16} /> 去计时
          </Link>
        }
      />

      <section className="stats-row">
        <StatCard label="总完成率" value={stats.completion} unit="%" hint={`${stats.done_tasks} / ${stats.total_tasks} 个任务`} icon={ListChecks} tone="teal" />
        <StatCard label="完整完成" value={stats.completed_days} unit="天" hint={`计划共 ${stats.total_days} 天`} icon={CalendarDays} tone="orange" />
        <StatCard label="今日进度" value={todayDone} unit={`/${todayDay?.task_count || 0}`} hint={todayDay ? (todayDone === todayDay.task_count && todayDay.task_count > 0 ? '今天的任务已完成' : '完成一项算一项') : '今天不在计划区间'} icon={Flame} tone="violet" />
        <StatCard label="连续打卡" value={dashboard?.streak?.streak || 0} unit="天" hint="按任务完成或复盘记录计算" icon={Star} tone="blue" />
      </section>

      <div className="phase-tabs">
        <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          全部 <em>{plan.days.length}</em>
        </button>
        {PHASES.map((p) => (
          <button key={p.key} type="button" className={filter === p.key ? 'active' : ''} onClick={() => setFilter(p.key)}>
            <i style={{ background: p.color }} />
            {p.label}
            <em>{plan.days.filter((d) => phaseOf(d.date).key === p.key).length}</em>
          </button>
        ))}
      </div>

      <section className="method-section">
        <div className="method-section-head">
          <span className="card-kicker">按你的节奏</span>
          <h2>每天怎么练</h2>
          <p>听力、阅读、写作/翻译是每天固定三块；长篇、长对话、短篇按天轮换，一次只做一个。</p>
        </div>
        <div className="method-grid">
          <article className="method-card">
            <span className="method-icon"><PenLine size={18} /></span>
            <h3>写作</h3>
            <ul>
              <li>只备 2 套：议论（现象+观点+2理由+结论）、书信/通知（称呼+开头+3要点+结尾+落款）。</li>
              <li>第 1 天默写模板，隔天用真题套模板写 1 篇；三段式 120 词，先保主谓一致。</li>
              <li>高级替换：important→vital，think→hold the view that。</li>
            </ul>
          </article>
          <article className="method-card">
            <span className="method-icon"><Headphones size={18} /></span>
            <h3>听力</h3>
            <ul>
              <li>篇章精听：正常做→逐句暂停标不懂→对原文标答案句（多在 but / so / 最高级后）→跟读 1 遍。</li>
              <li>长对话：预读选项圈名词/动词，答案多在问答的回答里。</li>
              <li>短篇新闻：首句大概率是主旨，每天 1 条，重点抓首句和导语。</li>
            </ul>
          </article>
          <article className="method-card">
            <span className="method-icon"><BookOpen size={18} /></span>
            <h3>阅读</h3>
            <ul>
              <li>仔细阅读：题干划关键词→原文定位→答案在定位句前后一句；排除 must / only / never。</li>
              <li>长篇匹配：划专有名词、数词、特殊词，回原文找同义替换；限时 15min，目标 7/10。</li>
              <li>选词填空：先标词性再代入；不会就蒙，10min 到点就停，目标 3/10。</li>
            </ul>
          </article>
          <article className="method-card">
            <span className="method-icon"><Languages size={18} /></span>
            <h3>翻译</h3>
            <ul>
              <li>通读段落理大意→5min 构思（找简单句、定时态）→15min 写，保证主谓一致。</li>
              <li>看不懂的词，换成简单中文再翻译；宁可简单也不空着。</li>
              <li>每天 1 段真题，2-3 天写完再对照，只记固定表达。</li>
            </ul>
          </article>
        </div>
      </section>

      <div className="plan-timeline">
        {days.map((day) => {
          const phase = phaseOf(day.date)
          const isToday = day.date === today
          const isPast = day.date < today
          const complete = day.task_count > 0 && day.done_count === day.task_count
          return (
            <article
              key={day.date}
              ref={isToday ? todayRef : undefined}
              className={`plan-day ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''} ${complete ? 'is-complete' : ''} ${day.is_exam ? 'is-exam' : ''}`}
            >
              <div className="plan-date-col">
                <span className="plan-month">{day.date.slice(5, 7)} 月</span>
                <strong>{day.date.slice(8)}</strong>
                <span className="plan-weekday">{day.weekday?.replace('星期', '周')}</span>
                <i style={{ background: phase.color }} />
              </div>

              <div className="plan-card">
                <div className="plan-card-head">
                  <div>
                    <div className="plan-tags">
                      <span className="phase-tag" style={{ '--phase-color': phase.color }}>{day.phase}</span>
                      {isToday && <span className="badge badge-orange">今天</span>}
                      {day.is_exam && <span className="badge badge-red">考试日</span>}
                      {complete && <span className="badge badge-teal">已完成</span>}
                    </div>
                    <h3>{day.is_exam ? '四级考试 · 09:00-11:20' : day.theme}</h3>
                  </div>
                  <div className="plan-progress">
                    <span>{day.done_count}/{day.task_count}</span>
                    <div className="mini-progress">
                      <i style={{ width: `${day.task_count ? (day.done_count / day.task_count) * 100 : 0}%` }} />
                    </div>
                  </div>
                </div>

                <ul className="plan-tasks">
                  {day.tasks.map((task, index) => (
                    <li key={`${task.label}-${index}`} className={task.done ? 'done' : ''}>
                      <button type="button" className={`task-check ${task.done ? 'checked' : ''}`} onClick={() => toggle(day, index)}>
                        {task.done && <Check size={13} strokeWidth={3} />}
                      </button>
                      <span className="plan-task-time">{task.time}</span>
                      <div className="plan-task-body">
                        <strong>{task.label}</strong>
                        <p>{task.text}</p>
                      </div>
                    </li>
                  ))}
                  {!day.tasks.length && <li className="muted">今天没有安排任务。</li>}
                </ul>

                {day.kpi && (
                  <div className="plan-kpi">
                    <Star size={14} />
                    <span>当日 KPI：{day.kpi}</span>
                  </div>
                )}
                {day.reminder && (
                  <div className="plan-reminder">
                    <AlertTriangle size={14} />
                    <span>{day.reminder}</span>
                  </div>
                )}

                {isToday && (
                  <div className="plan-note">
                    <div className="plan-note-head">
                      <span>今日复盘</span>
                      <span className="muted small">写一句就够，断档时能看到原因</span>
                    </div>
                    <div className="plan-note-row">
                      <input
                        className="input"
                        value={notes[day.date] || ''}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [day.date]: e.target.value }))}
                        placeholder="今天完成了什么？哪里卡住了？明天先做什么？"
                      />
                      <button type="button" className="btn btn-dark btn-sm" onClick={() => saveNote(day.date)} disabled={noteSaving}>
                        <Save size={14} /> 保存
                      </button>
                    </div>
                    {notes[day.date] && notes[day.date] !== '' && <p className="saved-note">已记录：{notes[day.date]}</p>}
                  </div>
                )}
                {!isToday && notes[day.date] && (
                  <div className="plan-note-saved">
                    <span>当日复盘</span>
                    <p>{notes[day.date]}</p>
                  </div>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {!days.length && (
        <div className="card">
          <EmptyState icon={CalendarDays} title="这个阶段没有任务" desc="切换上方阶段看看。" />
        </div>
      )}

      {examDay && filter === 'all' && (
        <div className="exam-day-banner">
          <GraduationCap size={24} />
          <div>
            <strong>12 月 12 日 09:00 开考</strong>
            <span>8:30 前到考场；条形码贴答题卡1，两张答题卡和试题册都要写姓名/学校/准考证号。</span>
          </div>
          <Link to="/settings" className="text-link">调整考试时间 <ChevronRight size={14} /></Link>
        </div>
      )}
    </div>
  )
}