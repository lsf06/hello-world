import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Search,
  Eye,
  EyeOff,
  BookX,
  CheckCircle2,
  Circle,
  Trash2,
  Languages,
  ChevronDown,
  ChevronUp,
  Plus,
  ArrowRight,
  Target,
  Image as ImageIcon,
  Sparkles,
} from 'lucide-react'
import { api, fmtDate } from '../api'
import { useApp } from '../store'
import { EmptyState, PageHeader, SectionBadge, StatCard, Tag } from '../components/UI'
import { ERROR_TAGS, QUESTION_SECTIONS } from '../constants'

export default function WrongBook() {
  const { notify, refreshDashboard } = useApp()
  const [questions, setQuestions] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [analytics, setAnalytics] = useState(null)
  const [section, setSection] = useState('')
  const [tag, setTag] = useState('')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [reviewMode, setReviewMode] = useState(false)
  const [revealed, setRevealed] = useState({})
  const [expanded, setExpanded] = useState({})
  const [extracting, setExtracting] = useState({})

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (section) params.set('section', section)
      if (tag) params.set('tag', tag)
      if (status === 'mastered') params.set('mastered', '1')
      if (status === 'unmastered') params.set('mastered', '0')
      if (search.trim()) params.set('q', search.trim())
      const data = await api.get(`/api/questions?${params.toString()}`)
      setQuestions(data.questions)
      setTotal(data.total)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0)
    return () => clearTimeout(t)
  }, [section, tag, status, search])

  useEffect(() => {
    api.get('/api/analytics').then(setAnalytics).catch(() => {})
  }, [])

  const tags = useMemo(() => {
    const list = (analytics?.errorTags || []).map((t) => t.tag)
    return [...new Set([...list, ...ERROR_TAGS])].slice(0, 40)
  }, [analytics])

  const toggleMastered = async (q) => {
    try {
      await api.patch(`/api/questions/${q.id}`, { mastered: !q.mastered })
      setQuestions((prev) => prev.map((x) => (x.id === q.id ? { ...x, mastered: !x.mastered } : x)))
      refreshDashboard()
      notify(q.mastered ? '已取消掌握标记' : '已标记掌握')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const remove = async (q) => {
    if (!window.confirm('删除这道错题？相关分析会一起消失。')) return
    try {
      await api.del(`/api/questions/${q.id}`)
      setQuestions((prev) => prev.filter((x) => x.id !== q.id))
      setTotal((t) => Math.max(0, t - 1))
      refreshDashboard()
      notify('错题已删除')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const addVocab = async (q) => {
    try {
      const data = await api.post(`/api/questions/${q.id}/vocab`, {})
      notify(`已加入单词本（${data.added} 个）`)
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const extractVocab = async (q) => {
    setExtracting((prev) => ({ ...prev, [q.id]: true }))
    try {
      const data = await api.post(`/api/questions/${q.id}/extract-vocab`, {})
      notify(`已从原图挑出 ${data.marked_vocab?.length || 0} 个荧光笔重点词，加入单词本`)
      refreshDashboard()
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setExtracting((prev) => ({ ...prev, [q.id]: false }))
    }
  }

  const reveal = async (q) => {
    setRevealed((prev) => ({ ...prev, [q.id]: true }))
    if (!q.review_count) api.post(`/api/questions/${q.id}/review`, {}).catch(() => {})
  }

  const overview = analytics?.overview
  const clearFilters = () => {
    setSection('')
    setTag('')
    setStatus('all')
    setSearch('')
  }

  return (
    <div>
      <PageHeader
        eyebrow="ERROR ARCHIVE"
        title="错题本"
        desc="每道错题都要留下错因。标签越准，学情分析越知道该让你练什么。"
        actions={
          <>
            <button type="button" className={`btn btn-ghost ${reviewMode ? 'is-on' : ''}`} onClick={() => setReviewMode((v) => !v)}>
              {reviewMode ? <EyeOff size={16} /> : <Eye size={16} />}
              {reviewMode ? '复习模式开' : '复习模式关'}
            </button>
            <Link to="/capture" className="btn btn-primary">
              <Plus size={16} /> 加错题
            </Link>
          </>
        }
      />

      <section className="stats-row">
        <StatCard label="错题总数" value={overview?.questions || 0} unit="道" hint={`已作答 ${overview?.answered || 0} 道`} icon={BookX} tone="orange" />
        <StatCard label="总正确率" value={overview?.accuracy === null || overview?.accuracy === undefined ? '—' : overview.accuracy} unit={overview?.accuracy === null ? '' : '%'} hint="按已判定对错的题计算" icon={Target} tone="teal" />
        <StatCard label="已掌握" value={overview?.mastered || 0} unit="道" hint={overview?.questions ? `掌握率 ${Math.round(((overview.mastered || 0) / overview.questions) * 100)}%` : '还没有数据'} icon={CheckCircle2} tone="violet" />
        <StatCard label="错得最多" value={analytics?.errorTags?.[0]?.tag || '—'} hint={analytics?.errorTags?.[0] ? `${analytics.errorTags[0].count} 次` : '先录几道错题'} icon={Circle} tone="blue" />
      </section>

      <div className="card filter-card">
        <div className="filter-row">
          <label className="search-box">
            <Search size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索题干、解析或备注" />
          </label>
          <select className="input input-select filter-select" value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">全部题型</option>
            {QUESTION_SECTIONS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select className="input input-select filter-select" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">全部错因</option>
            {tags.map((t) => <option key={t}>{t}</option>)}
          </select>
          <div className="seg-control seg-sm status-tabs">
            {[['all', '全部'], ['unmastered', '未掌握'], ['mastered', '已掌握']].map(([key, label]) => (
              <button key={key} type="button" className={status === key ? 'active' : ''} onClick={() => setStatus(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-foot">
          <span className="muted small">
            {loading ? '加载中…' : `共 ${total} 道${section ? ` · ${section}` : ''}${tag ? ` · ${tag}` : ''}`}
            {reviewMode && ' · 复习模式：答案和解析默认隐藏'}
          </span>
          {(section || tag || status !== 'all' || search) && (
            <button type="button" className="text-btn" onClick={clearFilters}>清除筛选</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="inline-empty"><span className="spinner" /> 正在翻错题本…</div>
      ) : questions.length ? (
        <div className="wrong-list">
          {questions.map((q) => {
            const isExpanded = expanded[q.id]
            const isRevealed = !reviewMode || revealed[q.id]
            return (
              <article key={q.id} className={`card question-card ${q.mastered ? 'mastered' : ''}`}>
                <div className="question-head">
                  <div className="question-meta">
                    <SectionBadge section={q.section} />
                    {q.subtype && <span className="muted small">{q.subtype}</span>}
                    <span className="muted small">{fmtDate(q.created_at)}</span>
                    {q.is_correct === false && <span className="badge badge-orange">做错</span>}
                    {q.is_correct === true && <span className="badge badge-teal">做对</span>}
                    {q.is_correct === null && <span className="badge badge-muted">未判定</span>}
                    {q.mastered && <span className="badge badge-teal">已掌握</span>}
                  </div>
                  <div className="question-head-actions">
                    <button type="button" className="icon-btn" onClick={() => setExpanded((p) => ({ ...p, [q.id]: !p[q.id] }))} aria-label="展开">
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                    <button type="button" className={`icon-btn ${q.mastered ? 'success' : ''}`} onClick={() => toggleMastered(q)} title={q.mastered ? '取消掌握' : '标记掌握'}>
                      <CheckCircle2 size={18} />
                    </button>
                    <button type="button" className="icon-btn danger" onClick={() => remove(q)} title="删除">
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>

                <p className="question-text">{q.question_text || '（无题干）'}</p>

                {!!q.options.length && (
                  <div className={`option-list ${isRevealed ? 'revealed' : ''}`}>
                    {q.options.map((opt, i) => {
                      const letter = String.fromCharCode(65 + i)
                      const isCorrect = isRevealed && String(q.correct_answer || '').toUpperCase().startsWith(letter)
                      const isMine = String(q.my_answer || '').toUpperCase().startsWith(letter)
                      return (
                        <div key={i} className={`option-item ${isCorrect ? 'correct' : ''} ${isMine ? 'mine' : ''}`}>
                          <span>{letter}</span>
                          <p>{String(opt).replace(/^[A-H][.、]\s*/, '')}</p>
                          {isMine && <em>我选</em>}
                          {isCorrect && <em className="right">正确</em>}
                        </div>
                      )
                    })}
                  </div>
                )}

                {!!q.error_tags.length && (
                  <div className="tag-row">
                    {q.error_tags.map((t) => <Tag key={t} active color="#C2410C">{t}</Tag>)}
                  </div>
                )}

                {isRevealed ? (
                  <div className="question-detail">
                    <div className="answer-compare">
                      <div><span>我的答案</span><strong className={q.is_correct === false ? 'neg' : ''}>{q.my_answer || '—'}</strong></div>
                      <ArrowRight size={16} />
                      <div><span>正确答案</span><strong className="pos">{q.correct_answer || '—'}</strong></div>
                    </div>

                    {q.answer_basis && <p className="answer-basis">识别依据：{q.answer_basis}</p>}

                    {q.analysis && (
                      <div className="analysis-box">
                        <span className="mini-label">解析</span>
                        <p>{q.analysis}</p>
                      </div>
                    )}

                    {(q.why_wrong || q.how_to_fix || q.is_correct === false) && (
                      <div className="diagnosis-stack">
                        {(q.why_wrong || q.is_correct === false) && (
                          <div className="diagnosis-box wrong">
                            <span className="mini-label">为什么错</span>
                            <p>
                              {q.why_wrong ||
                                `你选的是 ${q.my_answer || '未识别'}，正确答案是 ${q.correct_answer || '未识别'}。这道题还缺少具体错因，先对照上面的解析逐项排除你选的选项。`}
                            </p>
                          </div>
                        )}
                        {q.how_to_fix && (
                          <div className="diagnosis-box fix">
                            <span className="mini-label">下次怎么改</span>
                            <p>{q.how_to_fix}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {isExpanded && (
                      <>
                        {q.context && (
                          <div className="context-box">
                            <span className="mini-label">定位句 / 上下文</span>
                            <p>{q.context}</p>
                          </div>
                        )}
                        {q.translation && (
                          <div className="context-box">
                            <span className="mini-label">中文翻译</span>
                            <p>{q.translation}</p>
                          </div>
                        )}
                        {!!q.key_sentences.length && (
                          <div className="key-sentences">
                            <span className="mini-label">关键句</span>
                            {q.key_sentences.map((s, i) => (
                              <div className="key-sentence" key={i}>
                                <p>{s.en}</p>
                                <span>{s.zh}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {!!q.vocab.length && (
                          <div className="vocab-chips">
                            <span className="mini-label">关键生词</span>
                            <div className="tag-row">
                              {q.vocab.map((v, i) => (
                                <span key={i} className="vocab-chip">
                                  <b>{v.word}</b>
                                  {v.meaning && <em>{v.meaning}</em>}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {q.note && (
                          <div className="context-box">
                            <span className="mini-label">给自己的提醒</span>
                            <p>{q.note}</p>
                          </div>
                        )}
                        <div className="question-images">
                          {(q.image_paths?.length ? q.image_paths : q.image_path ? [q.image_path] : []).map((path, i, all) => (
                            <a key={path} className="question-image" href={path} target="_blank" rel="noreferrer">
                              <ImageIcon size={15} /> {all.length > 1 ? `查看原图 ${i + 1}` : '查看原题照片'}
                            </a>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="reveal-box">
                    <div>
                      <strong>复习模式</strong>
                      <p>先自己想：正确答案是哪一项？定位句在哪？</p>
                    </div>
                    <button type="button" className="btn btn-dark btn-sm" onClick={() => reveal(q)}>
                      <Eye size={15} /> 看答案与解析
                    </button>
                  </div>
                )}

                <div className="question-foot">
                  <button type="button" className="text-btn" onClick={() => addVocab(q)} disabled={!q.vocab.length}>
                    <Languages size={14} /> 加入单词本{q.vocab.length ? `（${q.vocab.length}）` : '（无生词）'}
                  </button>
                  {(q.image_paths?.length > 0 || q.image_path) && (
                    <button type="button" className="text-btn" onClick={() => extractVocab(q)} disabled={extracting[q.id]}>
                      <Sparkles size={14} /> {extracting[q.id] ? '正在提取重点词…' : '提取荧光笔重点词'}
                    </button>
                  )}
                  <button type="button" className="text-btn" onClick={() => setExpanded((p) => ({ ...p, [q.id]: !p[q.id] }))}>
                    {isExpanded ? '收起上下文' : '展开上下文 / 生词'}
                  </button>
                  <span className="muted small">复习 {q.review_count || 0} 次</span>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            icon={BookX}
            title={search || section || tag || status !== 'all' ? '没有符合条件的错题' : '错题本还是空的'}
            desc={search || section || tag || status !== 'all' ? '换个筛选条件试试。' : '拍照上传一道刚做错的题，或手动录入。'}
            action={
              search || section || tag || status !== 'all' ? (
                <button type="button" className="btn btn-ghost" onClick={clearFilters}>清除筛选</button>
              ) : (
                <Link to="/capture" className="btn btn-primary">上传第一道错题</Link>
              )
            }
          />
        </div>
      )}
    </div>
  )
}