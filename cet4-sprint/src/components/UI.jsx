import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Copy, Check, Inbox } from 'lucide-react'
import { SECTION_MAP } from '../constants'

export function PageHeader({ eyebrow, title, desc, actions }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function StatCard({ label, value, unit, hint, icon: Icon, tone = 'ink' }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {Icon && (
          <span className="stat-icon">
            <Icon size={18} strokeWidth={1.8} />
          </span>
        )}
      </div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}

export function SectionBadge({ section }) {
  const meta = SECTION_MAP[section] || { color: '#64748B', group: '其他' }
  return (
    <span className="section-badge" style={{ '--badge-color': meta.color }}>
      <i />
      {section || '其他'}
    </span>
  )
}

export function Tag({ children, active, onClick, color }) {
  const Comp = onClick ? 'button' : 'span'
  return (
    <Comp
      className={`tag ${active ? 'tag-active' : ''}`}
      style={color ? { '--tag-color': color } : undefined}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      {children}
    </Comp>
  )
}

export function ProgressBar({ value, max = 100, color = 'var(--accent)', height = 8, label }) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0))
  return (
    <div className="progress-wrap">
      {label && (
        <div className="progress-label">
          <span>{label}</span>
          <span>{Math.round(pct)}%</span>
        </div>
      )}
      <div className="progress-track" style={{ height }}>
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export function Donut({ value = 0, max = 100, size = 120, stroke = 10, color = 'var(--accent)', children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, max ? value / max : 0))
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ECE7DC" strokeWidth={stroke} />
        {pct > 0.001 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dasharray 600ms ease' }}
          />
        )}
      </svg>
      <div className="donut-center">{children}</div>
    </div>
  )
}

export function EmptyState({ icon: Icon = Inbox, title, desc, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={28} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      {desc && <p>{desc}</p>}
      {action}
    </div>
  )
}

export function Modal({ open, onClose, title, subtitle, children, footer, width = 720 }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('modal-open')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('modal-open')
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Field({ label, hint, children, required }) {
  return (
    <label className="field">
      {label && (
        <span className="field-label">
          {label}
          {required && <b>*</b>}
        </span>
      )}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Loading({ text = '加载中…' }) {
  return (
    <div className="loading-block">
      <span className="spinner" />
      <span>{text}</span>
    </div>
  )
}

export function CopyButton({ text, label = '复制' }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text || '')
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          /* ignore */
        }
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? '已复制' : label}
    </button>
  )
}

export function ScoreRing({ score, max = 15, sub, color = 'var(--accent)' }) {
  return (
    <div className="score-ring">
      <Donut value={score} max={max} size={148} stroke={12} color={color}>
        <strong>{score}</strong>
        <span>/ {max}</span>
      </Donut>
      {sub && <div className="score-ring-sub">{sub}</div>}
    </div>
  )
}