import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PenLine,
  Languages,
  Sparkles,
  Upload,
  X,
  AlertCircle,
  Copy as CopyIcon,
  Check,
  ArrowRight,
  BookOpen,
  Trash2,
  History,
  Target,
} from 'lucide-react'
import { api, fmtDate } from '../api'
import { useApp } from '../store'
import { CopyButton, Field, Modal, PageHeader, ProgressBar, ScoreRing, Tag } from '../components/UI'
import { TRANSLATION_TIPS, WRITING_TIPS } from '../constants'

const KIND_META = {
  writing: { label: '作文', target: 80, color: '#E85D2A', promptLabel: '作文题目', placeholder: '把作文题目贴在这里，例如：Suppose your university is...' },
  translation: { label: '翻译', target: 70, color: '#C2410C', promptLabel: '翻译原文（中文）', placeholder: '把要翻译的中文段落贴在这里' },
}

function countWords(text) {
  return (String(text).match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length
}

function Verdict({ score106, target }) {
  const gap = Math.round((score106 - target) * 10) / 10
  const ok = gap >= 0
  return (
    <span className={`badge ${ok ? 'badge-teal' : 'badge-orange'}`}>
      {ok ? `高于目标 ${gap} 分` : `离目标还差 ${Math.abs(gap)} 分`}
    </span>
  )
}

function GradeResult({ record, onClose, onNext }) {
  if (!record) return null
  const meta = KIND_META[record.kind] || KIND_META.writing
  return (
    <div className="grade-result">
      <div className="result-hero">
        <ScoreRing score={record.score15} max={15} sub={`折算 ${Math.round(record.score106 * 10) / 10} / 106.5`} color={meta.color} />
        <div className="result-summary">
          <div className="result-title-row">
            <div>
              <span className="card-kicker">{meta.label}批改 · {record.band}</span>
              <h2>{record.kind === 'translation' ? '这篇译文的问题已经拆开' : '这篇作文的得分点与失分点'}</h2>
            </div>
            <Verdict score106={record.score106} target={meta.target} />
          </div>
          <p className="result-overall">{record.overall}</p>
          <div className="dimension-list">
            {record.dimensions.map((d) => (
              <div key={d.name} className="dimension-row">
                <span>{d.name}</span>
                <div className="dimension-bar">
                  <i style={{ width: `${Math.min(100, (d.score / (d.max || 5)) * 100)}%`, background: meta.color }} />
                </div>
                <em>{d.score}/{d.max || 5}</em>
              </div>
            ))}
          </div>
          {record.estimated_target && (
            <div className="target-note">
              <Target size={14} />
              {record.estimated_target}
            </div>
          )}
        </div>
      </div>

      {!!record.comparison?.length && (
        <div className="result-block">
          <div className="block-head">
            <h3>对照参考答案（{record.comparison.length} 点）</h3>
            <span className="muted small">到位 / 偏差 / 遗漏</span>
          </div>
          <div className="compare-list">
            {record.comparison.map((c, i) => (
              <div className="compare-item" key={i}>
                <span className={`compare-status ${c.status === '到位' ? 'ok' : c.status === '遗漏' ? 'bad' : 'warn'}`}>
                  {c.status}
                </span>
                <div className="compare-body">
                  <div className="compare-point">{c.point}</div>
                  {c.student && <div className="compare-student">你的处理：{c.student}</div>}
                  {c.note && <p>{c.note}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="result-columns">
        <div className="result-block good">
          <h3>做得好的</h3>
          <ul>{record.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
        <div className="result-block fix">
          <h3>优先改这些</h3>
          <ul>{record.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      </div>

      {!!record.errors.length && (
        <div className="result-block">
          <div className="block-head">
            <h3>错误清单（{record.errors.length} 条）</h3>
            <span className="muted small">这些错误类型会进入个人高频错误清单</span>
          </div>
          <div className="error-list">
            {record.errors.map((e, i) => (
              <div className="error-item" key={i}>
                <Tag color="#C2410C">{e.type}</Tag>
                <div className="error-body">
                  <div className="error-line">
                    <del>{e.original || '—'}</del>
                    <ArrowRight size={13} />
                    <ins>{e.correction || '—'}</ins>
                  </div>
                  {e.explanation && <p>{e.explanation}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="result-columns">
        <div className="result-block">
          <div className="block-head">
            <h3>修改后的版本</h3>
            <CopyButton text={record.corrected_text} />
          </div>
          <div className="text-box">{record.corrected_text || '暂无'}</div>
        </div>
        {record.kind === 'translation' ? (
          <div className="result-block">
            <div className="block-head">
              <h3>参考译文</h3>
              <CopyButton text={record.reference_text} label="复制参考" />
            </div>
            <div className="text-box">{record.reference_text || '暂无'}</div>
          </div>
        ) : (
          <div className="result-block">
            <h3>可升级的句子</h3>
            <ul className="sentence-list">
              {(record.upgraded_sentences || []).map((s, i) => <li key={i}>{s}</li>)}
              {!(record.upgraded_sentences || []).length && <li className="muted">这次没有额外升级句，先把错误改掉更重要。</li>}
            </ul>
          </div>
        )}
      </div>

      {!!record.memorize?.length && (
        <div className="result-block">
          <div className="block-head">
            <h3>该背的（{record.memorize.length} 条）</h3>
            <CopyButton
              text={record.memorize.map((m) => `${m.type}｜${m.text}${m.note ? `｜${m.note}` : ''}`).join('\n')}
              label="复制清单"
            />
          </div>
          <div className="memory-grid">
            {record.memorize.map((m, i) => (
              <div className="memory-item" key={i}>
                <span className="memory-type">{m.type}</span>
                <strong>{m.text}</strong>
                {m.note && <p>{m.note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {record.kind === 'translation' && !!record.key_expressions.length && (
        <div className="result-block">
          <h3>参考译文里的固定表达</h3>
          <div className="expression-grid">
            {record.key_expressions.map((k, i) => (
              <div key={i} className="expression-item">
                <span>{k.zh}</span>
                <strong>{k.en}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="result-foot">
        <span className="muted small">批改时间：{fmtDate(record.created_at, true)}</span>
        <div className="result-actions">
          {onClose && <button type="button" className="btn btn-ghost" onClick={onClose}>关闭</button>}
          {onNext && <button type="button" className="btn btn-primary" onClick={onNext}>批改下一篇</button>}
        </div>
      </div>
    </div>
  )
}

export default function Grade() {
  const { aiConfigured, notify, refreshDashboard } = useApp()
  const [kind, setKind] = useState('writing')
  const [prompt, setPrompt] = useState('')
  const [content, setContent] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [refText, setRefText] = useState('')
  const [refFiles, setRefFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [detail, setDetail] = useState(null)
  const inputRef = useRef(null)
  const refInputRef = useRef(null)
  const refUrlsRef = useRef([])
  const meta = KIND_META[kind]
  const tips = kind === 'writing' ? WRITING_TIPS : TRANSLATION_TIPS
  const words = countWords(content)

  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const data = await api.get(`/api/writings?kind=${kind}`)
      setHistory(data.writings || [])
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    loadHistory()
  }, [kind])

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  const chooseFile = (f) => {
    if (!f) return
    if (preview) URL.revokeObjectURL(preview)
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  const clearFile = () => {
    if (preview) URL.revokeObjectURL(preview)
    setFile(null)
    setPreview('')
    if (inputRef.current) inputRef.current.value = ''
  }

  useEffect(() => {
    refUrlsRef.current = refFiles.map((p) => p.url)
  }, [refFiles])

  useEffect(() => () => refUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)), [])

  const addRefFiles = (list) => {
    const room = 4 - refFiles.length
    if (room <= 0) return
    const incoming = Array.from(list || []).filter((f) => f.type.startsWith('image/')).slice(0, room)
    if (!incoming.length) return
    setRefFiles((prev) => [...prev, ...incoming.map((f) => ({ file: f, url: URL.createObjectURL(f) }))])
  }

  const removeRefFile = (url) => {
    URL.revokeObjectURL(url)
    setRefFiles((prev) => prev.filter((p) => p.url !== url))
    if (refInputRef.current) refInputRef.current.value = ''
  }

  const switchKind = (next) => {
    if (next === kind) return
    setKind(next)
    setResult(null)
    setDetail(null)
  }

  const submit = async () => {
    if (!aiConfigured) {
      notify('先在设置里配置 AI 接口，才能自动批改', 'error')
      return
    }
    if (!content.trim() && !file) {
      notify('请粘贴文字，或上传手写照片', 'error')
      return
    }
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('kind', kind)
      fd.append('prompt', prompt)
      fd.append('content', content)
      if (file) fd.append('image', file)
      if (refText.trim()) fd.append('reference_text', refText)
      refFiles.forEach((p) => fd.append('reference_images', p.file))
      const data = await api.upload('/api/ai/grade', fd)
      setResult(data)
      setHistory((prev) => [data, ...prev])
      refreshDashboard()
      notify(`${meta.label}批改完成：${data.score15}/15（折算 ${data.score106}）`)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setResult(null)
    setPrompt('')
    setContent('')
    setRefText('')
    refFiles.forEach((p) => URL.revokeObjectURL(p.url))
    setRefFiles([])
    if (refInputRef.current) refInputRef.current.value = ''
    clearFile()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const removeRecord = async (id) => {
    if (!window.confirm('删除这条批改记录？')) return
    try {
      await api.del(`/api/writings/${id}`)
      setHistory((prev) => prev.filter((w) => w.id !== id))
      notify('记录已删除')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const avg = history.length
    ? Math.round((history.reduce((s, w) => s + Number(w.score106 || 0), 0) / history.length) * 10) / 10
    : null

  return (
    <div>
      <PageHeader
        eyebrow="AI FEEDBACK"
        title="作文 / 翻译批改"
        desc="按四级 15 分制严格打分，满分 106.5；对照你上传的参考答案逐点分析，并列出该背的短语、专有名词和句型。"
        actions={
          <Link to="/analytics" className="btn btn-ghost">
            <History size={16} />
            错误清单
          </Link>
        }
      />

      {!aiConfigured && (
        <div className="notice notice-warn">
          <AlertCircle size={18} />
          <div>
            <strong>还没有配置 AI 接口</strong>
            <p>作文和翻译批改需要 AI。配置后支持文字和手写照片；没有 Key 也可以先写、先存草稿。</p>
          </div>
          <Link to="/settings" className="btn btn-sm btn-dark">去配置</Link>
        </div>
      )}

      <div className="seg-control page-tabs">
        <button type="button" className={kind === 'writing' ? 'active' : ''} onClick={() => switchKind('writing')}>
          <PenLine size={15} /> 作文
        </button>
        <button type="button" className={kind === 'translation' ? 'active' : ''} onClick={() => switchKind('translation')}>
          <Languages size={15} /> 翻译
        </button>
      </div>

      <div className="grade-grid">
        <div className="card grade-form">
          <div className="card-head">
            <div>
              <span className="card-kicker">提交批改</span>
              <h2>{kind === 'writing' ? '写一篇，看看能拿几分' : '翻一段，看看哪里会扣分'}</h2>
            </div>
            <span className="badge badge-muted">目标 {meta.target} / 106.5</span>
          </div>

          <Field label={meta.promptLabel} hint="不填也可以，但填了批改会更贴题">
            <textarea className="input" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={meta.placeholder} />
          </Field>

          <Field label={kind === 'writing' ? '你的作文' : '你的译文'} hint={kind === 'writing' ? '建议 120-180 词' : '尽量每句都有主谓'}>
            <textarea
              className="input grade-textarea"
              rows={10}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={kind === 'writing' ? '在这里写作文…' : '在这里写英文译文…'}
            />
          </Field>
          <div className="grade-meta-row">
            <span className={`word-count ${kind === 'writing' && words > 0 && words < 120 ? 'low' : ''}`}>
              {kind === 'writing' ? `${words} 词` : `${words} words`}
              {kind === 'writing' && words > 0 && words < 120 && ' · 还没到 120 词'}
            </span>
            <span className="muted small">照片和文字可只交一个</span>
          </div>

          {preview ? (
            <div className="photo-preview compact">
              <img src={preview} alt="手写稿预览" />
              <button type="button" className="photo-remove" onClick={clearFile} aria-label="移除图片">
                <X size={18} />
              </button>
            </div>
          ) : (
            <button type="button" className="upload-inline" onClick={() => inputRef.current?.click()}>
              <Upload size={16} />
              上传你的答卷照片（手写/打印）
            </button>
          )}
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => chooseFile(e.target.files?.[0])} />

          <div className="ref-block">
            <Field
              label="参考答案（可选，强烈建议）"
              hint="粘贴文字或上传照片，AI 会逐点对照：哪里到位、哪里偏差、哪里漏了"
            >
              <textarea
                className="input"
                rows={4}
                value={refText}
                onChange={(e) => setRefText(e.target.value)}
                placeholder={kind === 'translation' ? '粘贴参考译文，或留空上传参考答案图片' : '粘贴参考范文/题目要点，或留空上传参考答案图片'}
              />
            </Field>
            <div className="ref-photo-row">
              {refFiles.map((p) => (
                <div className="ref-photo" key={p.url}>
                  <img src={p.url} alt="参考答案预览" />
                  <button type="button" className="photo-remove" onClick={() => removeRefFile(p.url)} aria-label="移除参考答案图片">
                    <X size={15} />
                  </button>
                </div>
              ))}
              {refFiles.length < 4 && (
                <button type="button" className="ref-add" onClick={() => refInputRef.current?.click()}>
                  <Upload size={15} />
                  参考答案照片
                </button>
              )}
            </div>
            <input
              ref={refInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={(e) => addRefFiles(e.target.files)}
            />
          </div>

          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={submit} disabled={loading}>
            <Sparkles size={18} />
            {loading ? '正在批改…' : '开始 AI 批改'}
          </button>
          <p className="form-note">批改结果是过程诊断，重点看错误类型，不要只盯分数。</p>
        </div>

        <aside className="grade-aside">
          <div className="card side-card">
            <span className="card-kicker">{meta.label}保底策略</span>
            <h3>先稳，再谈高级</h3>
            <ul className="tip-list">
              {tips.map((tip) => <li key={tip}>{tip}</li>)}
            </ul>
          </div>
          <div className="card side-card side-card-soft">
            <span className="card-kicker">历史均分</span>
            <div className="history-avg">
              <strong>{avg === null ? '—' : avg}</strong>
              <span>/ 106.5</span>
            </div>
            <p className="muted small">已批改 {history.length} 篇{meta.label}。目标 {meta.target} 分。</p>
          </div>
        </aside>
      </div>

      {result && (
        <section className="card result-card">
          <GradeResult record={result} onNext={reset} />
        </section>
      )}

      <section className="card history-card">
        <div className="card-head">
          <div>
            <span className="card-kicker">历史记录</span>
            <h2>{meta.label}批改</h2>
          </div>
          <span className="muted small">{history.length} 篇</span>
        </div>
        {historyLoading ? (
          <div className="inline-empty"><span className="spinner" /> 加载中…</div>
        ) : history.length ? (
          <div className="history-list">
            {history.map((w) => (
              <div key={w.id} className="history-item" onClick={() => setDetail(w)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setDetail(w)}>
                <div className="history-score">
                  <strong>{w.score15}</strong>
                  <span>/ 15</span>
                </div>
                <div className="history-body">
                  <div className="history-title">
                    {w.prompt || (w.kind === 'translation' ? '翻译练习' : '作文练习')}
                  </div>
                  <div className="history-meta">
                    <span>{fmtDate(w.created_at, true)}</span>
                    <span>{w.band}</span>
                    <span>{w.errors?.length || 0} 处错误</span>
                  </div>
                </div>
                <span className="history-score106">{Math.round(w.score106)} / 106.5</span>
                <button
                  type="button"
                  className="icon-btn danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeRecord(w.id)
                  }}
                  aria-label="删除"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="inline-empty">
            <BookOpen size={18} />
            还没有{meta.label}记录。写一篇，先拿到第一份错误清单。
          </div>
        )}
      </section>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`${KIND_META[detail?.kind || 'writing'].label}批改详情`} width={880}>
        {detail && <GradeResult record={detail} onClose={() => setDetail(null)} />}
      </Modal>
    </div>
  )
}