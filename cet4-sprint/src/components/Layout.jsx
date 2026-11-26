import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Timer,
  Camera,
  PenLine,
  BookX,
  BarChart3,
  ClipboardCheck,
  Languages,
  CalendarDays,
  Settings,
  Menu,
  X,
  MoreHorizontal,
  Sparkles,
  Flame,
} from 'lucide-react'
import { useApp } from '../store'

const NAV = [
  { to: '/', label: '今日', icon: LayoutDashboard, end: true },
  { to: '/timer', label: '计时训练', icon: Timer },
  { to: '/capture', label: '拍照解析', icon: Camera },
  { to: '/grade', label: '作文翻译', icon: PenLine },
  { to: '/wrong', label: '错题本', icon: BookX },
  { to: '/analytics', label: '学情分析', icon: BarChart3 },
  { to: '/mock', label: '模考计分', icon: ClipboardCheck },
  { to: '/vocab', label: '单词本', icon: Languages },
  { to: '/plan', label: '26天计划', icon: CalendarDays },
  { to: '/settings', label: '设置', icon: Settings },
]

const MOBILE_MAIN = ['/', '/timer', '/capture', '/wrong', '/analytics']
const MOBILE_MORE = ['/grade', '/mock', '/vocab', '/plan', '/settings']

function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(t)
  }, [interval])
  return now
}

function SidebarExam() {
  const { dashboard } = useApp()
  const now = useNow(1000)
  const examDate = dashboard?.exam?.date ? new Date(dashboard.exam.date) : new Date('2026-12-12T09:00:00+08:00')
  const start = new Date('2026-11-16T00:00:00+08:00')
  const ms = Math.max(0, examDate.getTime() - now)
  const days = Math.floor(ms / 86400000)
  const hours = Math.floor((ms % 86400000) / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const progress = Math.max(0, Math.min(1, (now - start.getTime()) / (examDate.getTime() - start.getTime())))

  return (
    <div className="sidebar-exam">
      <div className="sidebar-exam-head">
        <span>距 12·12 09:00</span>
        <Flame size={14} />
      </div>
      <div className="sidebar-exam-count">
        <strong>{ms > 0 ? days : 0}</strong>
        <span>天</span>
        <em>
          {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}
        </em>
      </div>
      <div className="sidebar-progress">
        <i style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="sidebar-exam-foot">
        <span>目标 {dashboard?.exam?.target || 480} 分</span>
        <span>{Math.round(progress * 100)}%</span>
      </div>
    </div>
  )
}

function Brand() {
  return (
    <Link to="/" className="brand">
      <span className="brand-mark">4</span>
      <span className="brand-text">
        <strong>冲刺舱</strong>
        <small>CET-4 SPRINT</small>
      </span>
    </Link>
  )
}

export default function Layout({ children }) {
  const { dashboard, aiConfigured } = useApp()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const now = useNow(60000)

  useEffect(() => {
    window.scrollTo({ top: 0 })
    setMoreOpen(false)
  }, [location.pathname])

  const dateText = new Date(now).toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <SidebarExam />
        <nav className="sidebar-nav">
          <div className="nav-label">工作台</div>
          {NAV.slice(0, 6).map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
          <div className="nav-label">记录与回顾</div>
          {NAV.slice(6).map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="local-dot" />
          数据只存在本机
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-brand">
            <Brand />
          </div>
          <div className="topbar-date">
            {dateText}
            {dashboard?.plan?.day && (
              <span className={`phase-chip ${dashboard.plan.is_today ? 'is-today' : ''}`}>
                {dashboard.plan.is_today ? '今天 · ' : '下一课 · '}
                {dashboard.plan.day.phase}
              </span>
            )}
          </div>
          <div className="topbar-right">
            <Link to="/settings" className={`ai-chip ${aiConfigured ? 'on' : 'off'}`} title="AI 配置状态">
              <Sparkles size={13} />
              AI {aiConfigured ? '已连接' : '未配置'}
            </Link>
            <span className="streak-chip" title="连续打卡">
              <Flame size={13} />
              {dashboard?.streak?.streak || 0}
            </span>
            <button type="button" className="icon-btn mobile-menu-btn" onClick={() => setMoreOpen(true)} aria-label="更多">
              <Menu size={20} />
            </button>
          </div>
        </header>

        <main className="page">{children}</main>
      </div>

      <nav className="bottom-nav">
        {MOBILE_MAIN.map((path) => {
          const item = NAV.find((n) => n.to === path)
          const Icon = item.icon
          const active = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)
          return (
            <NavLink key={path} to={path} className={`bottom-item ${active ? 'active' : ''}`}>
              <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
        <button type="button" className={`bottom-item ${MOBILE_MORE.includes(location.pathname) ? 'active' : ''}`} onClick={() => setMoreOpen(true)}>
          <MoreHorizontal size={20} />
          <span>更多</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="mobile-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setMoreOpen(false)}>
          <div className="mobile-sheet">
            <div className="sheet-head">
              <strong>全部功能</strong>
              <button type="button" className="icon-btn" onClick={() => setMoreOpen(false)} aria-label="关闭">
                <X size={20} />
              </button>
            </div>
            <div className="sheet-grid">
              {NAV.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink key={item.to} to={item.to} className="sheet-item">
                    <Icon size={22} strokeWidth={1.8} />
                    <span>{item.label}</span>
                  </NavLink>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NavItem({ item }) {
  const Icon = item.icon
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      <Icon size={18} strokeWidth={1.9} />
      <span>{item.label}</span>
    </NavLink>
  )
}