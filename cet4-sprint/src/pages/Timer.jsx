import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlarmClock,
  Pause,
  Play,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
  Check,
  ChevronRight,
  Info,
  ListChecks,
} from 'lucide-react'
import { api, fmtDate } from '../api'
import { useApp } from '../store'
import { PageHeader, Field, Modal, SectionBadge } from '../components/UI'
import { TIMER_PRESETS } from '../constants'

const STORAGE_KEY = 'cet4.timer.v2'
const SECTIONS = ['writing', 'listening', 'reading', 'translation']

let audioCtx = null
function playBeep(times = 1) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    for (let i = 0; i < times; i += 1) {
      const start = audioCtx.currentTime + i * 0.28
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, start)
      gain.gain.setValueAtTime(0.001, start)
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22)
      osc.connect(gain).connect(audioCtx.destination)
      osc.start(start)
      osc.stop(start + 0.24)
    }
  } catch {
    /* audio not available */
  }
}

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatMinutes(seconds) {
  const m = seconds / 60
  return Number.isInteger(m) ? String(m) : String(Math.round(m * 10) / 10)
}

function buildStages(mode, sectionKey, tolerance, customSeconds = 0) {
  const preset = mode === 'full' ? TIMER_PRESETS.full : TIMER_PRESETS[sectionKey]
  if (!preset.segments) return []
  const baseSeconds = preset.segments.reduce((sum, seg) => sum + seg.minutes * 60, 0)
  const targetSeconds = customSeconds > 0 ? customSeconds : Math.round(preset.minutes * 60 * (tolerance / 100))
  let cursor = 0
  return preset.segments.map((seg, index) => {
    const planned =
      index === preset.segments.length - 1
        ? Math.max(0, targetSeconds - cursor)
        : Math.round((seg.minutes * 60 * targetSeconds) / baseSeconds)
    const stage = { ...seg, index, planned, start: cursor, end: cursor + planned }
    cursor += planned
    return stage
  })
}

export default function TimerPage() {
  const { settings, refreshDashboard, notify } = useApp()
  const [mode, setMode] = useState('focus')
  const [sectionKey, setSectionKey] = useState('reading')
  const [tolerance, setTolerance] = useState(Number(settings?.tolerance) || 110)
  const [customTolerance, setCustomTolerance] = useState(() => {
    const t = Number(settings?.tolerance) || 110
    return t === 100 || t === 110 ? '' : String(t)
  })
  const [customMinutes, setCustomMinutes] = useState(() => localStorage.getItem('cet4.timer.customMinutes') || '')
  const [session, setSession] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [finishOpen, setFinishOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sound, setSound] = useState(true)
  const [records, setRecords] = useState([])
  const [form, setForm] = useState({ correct: '', total: '', note: '', listenCorrect: '', readCorrect: '' })
  const lastStageRef = useRef(-1)
  const lastMinuteRef = useRef(false)
  const timeUpRef = useRef(false)

  const preset = mode === 'full' ? TIMER_PRESETS.full : TIMER_PRESETS[sectionKey]
  const customSeconds = Number(customMinutes) > 0 ? Math.round(Number(customMinutes) * 60) : 0
  const previewPlanned = useMemo(() => {
    if (customSeconds > 0) return customSeconds
    const base = mode === 'full' ? TIMER_PRESETS.full : TIMER_PRESETS[sectionKey]
    return Math.round(base.minutes * 60 * (tolerance / 100))
  }, [mode, sectionKey, tolerance, customSeconds])

  useEffect(() => {
    if (customMinutes) localStorage.setItem('cet4.timer.customMinutes', customMinutes)
    else localStorage.removeItem('cet4.timer.customMinutes')
  }, [customMinutes])

  useEffect(() => {
    if (settings?.tolerance) {
      const t = Number(settings.tolerance)
      if (Number.isFinite(t)) {
        setTolerance(t)
        setCustomTolerance(t === 100 || t === 110 ? '' : String(t))
      }
    }
  }, [settings])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved && !saved.finished) {
        setSession(saved)
        setMode(saved.mode)
        setSectionKey(saved.sectionKey)
        setTolerance(saved.tolerance)
        setCustomTolerance(saved.tolerance === 100 || saved.tolerance === 110 ? '' : String(saved.tolerance))
        if (saved.customSeconds) setCustomMinutes(String(Math.round(saved.customSeconds / 60)))
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else localStorage.removeItem(STORAGE_KEY)
  }, [session])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  const elapsedMs = session
    ? session.elapsedBeforePause + (session.running ? Math.max(0, now - session.startedAt) : 0)
    : 0
  const plannedMs = session ? session.plannedSeconds * 1000 : previewPlanned * 1000
  const remainingMs = Math.max(0, plannedMs - elapsedMs)
  const overtimeMs = session ? Math.max(0, elapsedMs - plannedMs) : 0
  const progress = plannedMs ? Math.min(1, elapsedMs / plannedMs) : 0
  const elapsedSec = elapsedMs / 1000

  const stages = useMemo(
    () => buildStages(mode, sectionKey, tolerance, customSeconds),
    [mode, sectionKey, tolerance, customSeconds],
  )
  const currentStage = useMemo(() => {
    if (!stages.length) return null
    return stages.find((s) => elapsedSec < s.end) || stages[stages.length - 1]
  }, [stages, elapsedSec])

  useEffect(() => {
    if (!session || !session.running) {
      document.title = '四级冲刺舱 · 26天到480'
      return undefined
    }
    const label = mode === 'full' ? currentStage?.name || '整卷' : preset.label
    const display = remainingMs > 0 ? formatClock(remainingMs) : `+${formatClock(overtimeMs)}`
    document.title = `${display} · ${label} · 冲刺舱`
    return () => {
      document.title = '四级冲刺舱 · 26天到480'
    }
  }, [session, remainingMs, overtimeMs, mode, currentStage, preset.label])

  useEffect(() => {
    if (!session || session.finished) return
    if (session.running && sound) {
      if (currentStage && currentStage.index !== lastStageRef.current) {
        if (lastStageRef.current !== -1) playBeep(2)
        lastStageRef.current = currentStage.index
      }
      if (remainingMs <= 60000 && remainingMs > 0 && !lastMinuteRef.current) {
        lastMinuteRef.current = true
        playBeep(1)
      }
      if (remainingMs <= 0 && !timeUpRef.current) {
        timeUpRef.current = true
        playBeep(3)
      }
    }
  }, [session, session?.running, remainingMs, currentStage, sound])

  const loadRecords = async () => {
    try {
      const data = await api.get('/api/sessions?limit=24')
      setRecords(data.sessions || [])
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  useEffect(() => {
    loadRecords()
  }, [])

  const start = () => {
    lastStageRef.current = -1
    lastMinuteRef.current = false
    timeUpRef.current = false
    setSession({
      mode,
      sectionKey,
      tolerance,
      customSeconds,
      plannedSeconds: previewPlanned,
      startedAt: Date.now(),
      elapsedBeforePause: 0,
      running: true,
      startedAtISO: new Date().toISOString(),
      finished: false,
    })
    if (sound) playBeep(1)
  }

  const pause = () => {
    const current = session.elapsedBeforePause + Math.max(0, Date.now() - session.startedAt)
    setSession({ ...session, running: false, elapsedBeforePause: current })
  }

  const resume = () => {
    setSession({ ...session, running: true, startedAt: Date.now() })
  }

  const requestFinish = () => {
    let next = session
    if (session.running) {
      const current = session.elapsedBeforePause + Math.max(0, Date.now() - session.startedAt)
      next = { ...session, running: false, elapsedBeforePause: current }
      setSession(next)
    }
    const total = next?.elapsedBeforePause || 0
    const focusTotal =
      next?.sectionKey === 'listening' ? '25' : next?.sectionKey === 'reading' ? '30' : ''
    setForm({
      correct: '',
      total: focusTotal,
      note: '',
      listenCorrect: '',
      readCorrect: '',
      elapsedPreview: total,
    })
    setFinishOpen(true)
  }

  const resetSession = () => {
    if (!window.confirm('放弃本次计时？本次不会保存记录。')) return
    setSession(null)
    setFinishOpen(false)
    timeUpRef.current = false
    document.title = '四级冲刺舱 · 26天到480'
  }

  const saveSession = async () => {
    if (!session) return
    setSaving(true)
    try {
      const totalElapsed = Math.max(0, Math.round((session.elapsedBeforePause || 0) / 1000))
      if (mode === 'focus') {
        const presetInfo = TIMER_PRESETS[session.sectionKey]
        await api.post('/api/sessions', {
          section: presetInfo.section,
          subtype: presetInfo.label,
          mode: 'focus',
          planned_seconds: session.plannedSeconds,
          actual_seconds: totalElapsed,
          tolerance: session.tolerance,
          correct_count: form.correct === '' ? null : Number(form.correct),
          total_count: form.total === '' ? null : Number(form.total),
          note: form.note,
          started_at: session.startedAtISO,
          ended_at: new Date().toISOString(),
          meta: { steps: stages },
        })
      } else {
        let savedCount = 0
        for (const stage of stages) {
          const isLast = stage.index === stages.length - 1
          const actual = Math.max(
            0,
            Math.round((isLast ? totalElapsed : Math.min(totalElapsed, stage.end)) - stage.start),
          )
          if (actual <= 0) continue
          const correct =
            stage.key === 'listening' ? form.listenCorrect : stage.key === 'reading' ? form.readCorrect : ''
          const total = stage.key === 'listening' ? 25 : stage.key === 'reading' ? 30 : ''
          await api.post('/api/sessions', {
            section: stage.name,
            subtype: stage.name,
            mode: 'full',
            planned_seconds: stage.planned,
            actual_seconds: actual,
            tolerance: session.tolerance,
            correct_count: correct === '' ? null : Number(correct),
            total_count: total === '' ? null : Number(total),
            note: form.note,
            started_at: session.startedAtISO,
            ended_at: new Date().toISOString(),
            meta: { full: true, stage: stage.name, total_stages: stages.length },
          })
          savedCount += 1
        }
        if (!savedCount) throw new Error('没有可保存的用时')
      }
      setFinishOpen(false)
      setSession(null)
      timeUpRef.current = false
      await loadRecords()
      refreshDashboard()
      notify(mode === 'full' ? '整卷用时已记录，去模考计分填对题数即可看总分' : '训练记录已保存')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const previewMinutes = Math.round((previewPlanned / 60) * 10) / 10
  const status = !session
    ? '准备开始'
    : remainingMs <= 0
      ? session.running
        ? '已超时'
        : '超时 · 已暂停'
      : session.running
        ? '进行中'
        : '已暂停'
  const modeLabel = mode === 'full' ? '整卷模考' : preset.label
  const totalRecordMinutes = records.reduce((s, r) => s + Math.round((r.actual_seconds || 0) / 60), 0)

  return (
    <div>
      <PageHeader
        eyebrow="TIME TRIAL"
        title="计时训练"
        desc="按考场节奏卡时间。刷新或离开页面不会重置，时间照常走。"
        actions={
          <button type="button" className={`btn btn-ghost ${sound ? 'is-on' : ''}`} onClick={() => setSound((v) => !v)}>
            {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
            {sound ? '提示音开' : '提示音关'}
          </button>
        }
      />

      <div className="timer-layout">
        <div className="card timer-main">
          <div className="timer-config">
            <div className="seg-control">
              <button type="button" className={mode === 'focus' ? 'active' : ''} onClick={() => !session && setMode('focus')} disabled={!!session}>
                专项限时
              </button>
              <button type="button" className={mode === 'full' ? 'active' : ''} onClick={() => !session && setMode('full')} disabled={!!session}>
                整卷模考
              </button>
            </div>

            {mode === 'focus' ? (
              <div className="section-picker">
                {SECTIONS.map((key) => {
                  const p = TIMER_PRESETS[key]
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`section-choice ${sectionKey === key ? 'active' : ''}`}
                      style={{ '--choice-color': p.color }}
                      onClick={() => !session && setSectionKey(key)}
                      disabled={!!session}
                    >
                      <span>{p.label}</span>
                      <em>{p.minutes} min</em>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="full-stages">
                {stages.map((stage) => {
                  const done = session && elapsedSec >= stage.end
                  const current = session && currentStage?.index === stage.index && elapsedSec < stage.end
                  return (
                    <div key={stage.name} className={`full-stage ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
                      <span className="stage-index">{done ? <Check size={12} /> : stage.index + 1}</span>
                      <strong>{stage.name}</strong>
                      <em>{formatMinutes(stage.planned)} min</em>
                      {current && <i>剩 {formatClock((stage.end - elapsedSec) * 1000)}</i>}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="custom-duration-row">
              <span>自定义时长</span>
              <label className="custom-duration">
                <input
                  type="text"
                  inputMode="numeric"
                  value={customMinutes}
                  placeholder={String(preset.minutes)}
                  onChange={(e) => setCustomMinutes(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  onBlur={() => {
                    if (!customMinutes) return
                    const n = Math.max(1, Math.min(300, Number(customMinutes) || 1))
                    setCustomMinutes(String(n))
                  }}
                  disabled={!!session}
                  aria-label="自定义时长（分钟）"
                />
                <em>分钟</em>
              </label>
              {customMinutes ? (
                <>
                  <button type="button" className="text-btn" onClick={() => setCustomMinutes('')} disabled={!!session}>
                    恢复预设
                  </button>
                  <em className="muted small">
                    {mode === 'full' ? '整卷按此总时长等比分配到四个板块' : '按你填的时长倒计时，可填 1-300 分钟'}
                  </em>
                </>
              ) : (
                <em className="muted small">不填就按预设 {preset.minutes} 分钟</em>
              )}
            </div>

            <div className="tolerance-row">
              <span>时长容忍度</span>
              <div className="seg-control seg-sm">
                {[100, 110].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={tolerance === v ? 'active' : ''}
                    onClick={() => {
                      if (session) return
                      setTolerance(v)
                      setCustomTolerance('')
                    }}
                    disabled={!!session || customSeconds > 0}
                  >
                    {v}%
                  </button>
                ))}
                <label className={`custom-tolerance ${customTolerance ? 'active' : ''}`}>
                  <input
                    type="number"
                    min="50"
                    max="200"
                    value={customTolerance}
                    placeholder="自定义"
                    onChange={(e) => {
                      const raw = e.target.value
                      setCustomTolerance(raw)
                      const n = Number(raw)
                      if (raw && Number.isFinite(n) && n >= 50 && n <= 200) setTolerance(n)
                    }}
                    onBlur={() => {
                      if (!customTolerance) return
                      const n = Math.max(50, Math.min(200, Number(customTolerance) || 50))
                      setCustomTolerance(String(n))
                      setTolerance(n)
                    }}
                    disabled={!!session || customSeconds > 0}
                  />
                  {customTolerance ? '%' : ''}
                </label>
              </div>
              <em className="tolerance-hint">
                {customSeconds > 0
                  ? `自定义 ${previewMinutes} 分钟 · 容忍度不参与计算`
                  : `实际 ${previewMinutes} 分钟 · 官方 ${preset.minutes} 分钟`}
              </em>
            </div>
          </div>

          <div className="timer-stage">
            <div className={`timer-ring ${session?.running ? 'running' : ''}`}>
              <svg viewBox="0 0 320 320">
                <circle className="ring-track" cx="160" cy="160" r="144" />
                <circle
                  className="ring-progress"
                  cx="160"
                  cy="160"
                  r="144"
                  strokeDasharray={`${2 * Math.PI * 144}`}
                  strokeDashoffset={`${2 * Math.PI * 144 * (1 - progress)}`}
                  style={{ stroke: preset.color }}
                />
              </svg>
              <div className="timer-center">
                <span className="timer-status">{status}</span>
                <strong className={`timer-time ${overtimeMs > 0 ? 'overtime' : ''}`}>
                  {session
                    ? remainingMs > 0
                      ? formatClock(remainingMs)
                      : `+${formatClock(overtimeMs)}`
                    : formatClock(previewPlanned * 1000)}
                </strong>
                <span className="timer-sub">
                  {overtimeMs > 0
                    ? `已超出计划 ${formatClock(overtimeMs)} · 按「结束并记录」结算偏差`
                    : mode === 'full'
                      ? currentStage
                        ? `当前：${currentStage.name} · 剩 ${formatClock(Math.max(0, (currentStage.end - elapsedSec) * 1000))}`
                        : '写作 → 听力 → 阅读 → 翻译'
                      : customSeconds > 0
                        ? `${preset.label} · 自定义 ${previewMinutes} 分钟`
                        : `${preset.label} · 建议 ${preset.minutes} 分钟`}
                </span>
                {session && (
                  <span className="timer-elapsed">已用 {formatClock(elapsedMs)}</span>
                )}
              </div>
            </div>

            <div className="timer-side-info">
              <div className="timer-info-head">
                <span className="card-kicker">{mode === 'full' ? '整卷节奏' : '本项策略'}</span>
                <h2>{modeLabel} · {previewMinutes} 分钟</h2>
                <p>{preset.desc}</p>
              </div>
              <ul className="tip-list">
                {preset.tips.map((tip) => (
                  <li key={tip}>
                    <Info size={13} />
                    {tip}
                  </li>
                ))}
              </ul>

              {mode === 'focus' && preset.segments && (
                <div className="segment-timeline">
                  <span className="mini-label">阅读内部节奏</span>
                  <div className="segment-chips">
                    {stages.map((seg) => {
                      const done = session && elapsedSec >= seg.end
                      const current = session && currentStage?.index === seg.index && elapsedSec < seg.end
                      return (
                        <span key={seg.name} className={`segment-chip ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
                          {seg.name}
                          <em>{formatMinutes(seg.planned)}′</em>
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {mode === 'full' && (
                <div className="exam-clock-note">
                  <AlarmClock size={14} />
                  按 9:10 开考换算：现在对应的考试时钟约为{' '}
                  <b>
                    {(() => {
                      const startMinutes = 9 * 60 + 10
                      const t = startMinutes + Math.floor(elapsedSec / 60)
                      return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
                    })()}
                  </b>
                </div>
              )}
            </div>
          </div>

          <div className="timer-controls">
            {!session ? (
              <button type="button" className="btn btn-primary btn-lg" onClick={start}>
                <Play size={18} />
                开始计时
              </button>
            ) : (
              <>
                {session.running ? (
                  <button type="button" className="btn btn-dark btn-lg" onClick={pause}>
                    <Pause size={18} />
                    暂停
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary btn-lg" onClick={resume}>
                    <Play size={18} />
                    继续
                  </button>
                )}
                <button type="button" className="btn btn-ghost btn-lg" onClick={requestFinish}>
                  <Square size={16} />
                  结束并记录
                </button>
                <button type="button" className="icon-btn danger" onClick={resetSession} title="放弃本次">
                  <RotateCcw size={18} />
                </button>
              </>
            )}
            {session && <span className="timer-persist">已开启防刷新保护</span>}
          </div>
        </div>

        <aside className="timer-aside">
          <div className="card side-card">
            <span className="card-kicker">今日建议</span>
            <h3>先保仔细阅读，再谈速度</h3>
            <p>你的目标是 480：听力 165、阅读 165、写作 80、翻译 70。时间不够时，先砍选词填空，不要压缩仔细阅读。</p>
            <div className="side-metrics">
              <div>
                <span>已记录训练</span>
                <strong>{records.length}</strong>
              </div>
              <div>
                <span>累计分钟</span>
                <strong>{totalRecordMinutes}</strong>
              </div>
            </div>
            <Link to="/mock" className="text-link">
              用整卷结果去记分 <ChevronRight size={14} />
            </Link>
          </div>

          <div className="card side-card side-card-soft">
            <span className="card-kicker">考场顺序</span>
            <div className="exam-order">
              {[
                ['9:10', '写作', '30′'],
                ['9:40', '听力', '25′'],
                ['10:10', '阅读', '40′'],
                ['10:50', '翻译', '30′'],
              ].map(([time, name, dur]) => (
                <div key={name} className="exam-order-row">
                  <span>{time}</span>
                  <strong>{name}</strong>
                  <em>{dur}</em>
                </div>
              ))}
            </div>
            <p className="muted small">听力结束立刻收答题卡，没有单独填涂时间。</p>
          </div>
        </aside>
      </div>

      <section className="card records-card">
        <div className="card-head">
          <div>
            <span className="card-kicker">训练记录</span>
            <h2>每一次用时都算数</h2>
          </div>
          <span className="muted small">最近 24 条</span>
        </div>
        {records.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>板块</th>
                  <th>计划</th>
                  <th>实际</th>
                  <th>偏差</th>
                  <th>正确率</th>
                  <th>时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const delta = r.actual_seconds - r.planned_seconds
                  const accuracy = r.correct_count !== null && r.total_count ? Math.round((r.correct_count / r.total_count) * 100) : null
                  return (
                    <tr key={r.id}>
                      <td><SectionBadge section={r.section} /></td>
                      <td className="num">{Math.round((r.planned_seconds || 0) / 60)} 分</td>
                      <td className="num">{Math.round((r.actual_seconds || 0) / 60)} 分</td>
                      <td className={`num ${delta > 60 ? 'neg' : delta < -60 ? 'pos' : ''}`}>
                        {delta === 0
                          ? '0 分'
                          : `${delta > 0 ? '+' : '-'}${Math.abs(delta) < 60 ? `${Math.abs(delta)} 秒` : `${Math.round(Math.abs(delta) / 60)} 分`}`}
                      </td>
                      <td className="num">{accuracy === null ? '—' : `${accuracy}%`}</td>
                      <td className="muted">{fmtDate(r.created_at, true)}</td>
                      <td>
                        <button
                          type="button"
                          className="text-btn danger-text"
                          onClick={async () => {
                            if (!window.confirm('删除这条记录？')) return
                            try {
                              await api.del(`/api/sessions/${r.id}`)
                              loadRecords()
                              notify('记录已删除')
                            } catch (err) {
                              notify(err.message, 'error')
                            }
                          }}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="inline-empty">
            <ListChecks size={18} />
            还没有计时记录。先跑一组 20 分钟的仔细阅读，再回来看用时。
          </div>
        )}
      </section>

      <Modal
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        title="记录这次训练"
        subtitle={`${modeLabel} · 实际用时 ${formatClock(session?.elapsedBeforePause || 0)}`}
        width={560}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setFinishOpen(false)}>稍后</button>
            <button type="button" className="btn btn-primary" onClick={saveSession} disabled={saving}>
              {saving ? '保存中…' : '保存记录'}
            </button>
          </>
        }
      >
        <div className="finish-summary">
          <div>
            <span>计划时长</span>
            <strong>{formatClock(plannedMs)}</strong>
          </div>
          <div>
            <span>实际用时</span>
            <strong>{formatClock(session?.elapsedBeforePause || 0)}</strong>
          </div>
          <div>
            <span>偏差</span>
            {(() => {
              const deltaSec = Math.round(((session?.elapsedBeforePause || 0) - plannedMs) / 1000)
              const abs = Math.abs(deltaSec)
              const text = abs >= 60 ? `${Math.floor(abs / 60)} 分 ${abs % 60} 秒` : `${abs} 秒`
              return (
                <strong className={deltaSec > 0 ? 'neg' : deltaSec < 0 ? 'pos' : ''}>
                  {deltaSec > 0 ? `超时 ${text}` : deltaSec < 0 ? `提前 ${text}` : '刚好'}
                </strong>
              )
            })()}
          </div>
        </div>

        {mode === 'focus' && ['listening', 'reading'].includes(session?.sectionKey) && (
          <div className="two-col">
            <Field label="做对题数" hint="不回看答案，先凭印象填">
              <input className="input" type="number" min="0" value={form.correct} onChange={(e) => setForm({ ...form, correct: e.target.value })} placeholder="如 18" />
            </Field>
            <Field label="总题数">
              <input className="input" type="number" min="0" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} placeholder="听力 25 / 阅读 30" />
            </Field>
          </div>
        )}

        {mode === 'full' && (
          <>
            <div className="notice-inline">
              整卷会按四个板块分别记录用时。填听力、阅读对题数，系统会自动估算这两块的分数；写作和翻译请去「作文翻译」批改。
            </div>
            <div className="two-col">
              <Field label="听力对题数" hint="满分 25 题">
                <input className="input" type="number" min="0" max="25" value={form.listenCorrect} onChange={(e) => setForm({ ...form, listenCorrect: e.target.value })} placeholder="0 - 25" />
              </Field>
              <Field label="阅读对题数" hint="满分 30 题">
                <input className="input" type="number" min="0" max="30" value={form.readCorrect} onChange={(e) => setForm({ ...form, readCorrect: e.target.value })} placeholder="0 - 30" />
              </Field>
            </div>
          </>
        )}

        <Field label="备注" hint="例如：阅读最后一篇没做完；听力新闻语速太快">
          <textarea className="input" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="写一句就够，方便以后回看" />
        </Field>
      </Modal>
    </div>
  )
}