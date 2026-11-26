import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Camera,
  Upload,
  Sparkles,
  X,
  Plus,
  Trash2,
  CheckCircle2,
  BookOpen,
  ArrowRight,
  FileText,
  Keyboard,
  Image as ImageIcon,
  AlertCircle,
  Save,
} from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import { Field, PageHeader, SectionBadge, Tag } from '../components/UI'
import { ERROR_TAGS, QUESTION_SECTIONS, SECTION_MAP } from '../constants'

const MAX_PHOTOS = 12

const EMPTY_MANUAL = {
  section: '仔细阅读',
  subtype: '',
  question_text: '',
  context: '',
  optionsText: '',
  my_answer: '',
  correct_answer: '',
  analysis: '',
  why_wrong: '',
  how_to_fix: '',
  translation: '',
  vocabText: '',
  error_tags: [],
  note: '',
  source: '手动录题',
}

function emptyQuestion(index = 0) {
  return {
    number: String(index + 1),
    section: '仔细阅读',
    subtype: '',
    question_text: '',
    context: '',
    options: ['', '', '', ''],
    my_answer: '',
    correct_answer: '',
    is_correct: null,
    analysis: '',
    translation: '',
    key_sentences: [],
    vocab: [],
    error_tags: [],
    note: '',
    confidence: 'medium',
  }
}

function answerLetter(value) {
  return (String(value || '').toUpperCase().match(/\b[A-Z]\b/) || [''])[0]
}

function answerKey(q) {
  return `${answerLetter(q.my_answer)}${answerLetter(q.correct_answer)}`
}

function TagSelect({ value, onChange }) {
  return (
    <select
      className="input input-select"
      value=""
      onChange={(e) => {
        if (e.target.value && !value.includes(e.target.value)) onChange([...value, e.target.value])
      }}
    >
      <option value="">+ 添加错因标签</option>
      {ERROR_TAGS.filter((t) => !value.includes(t)).map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  )
}

export default function Capture() {
  const { aiConfigured, notify, refreshDashboard } = useApp()
  const [tab, setTab] = useState('photo')
  const [photos, setPhotos] = useState([])
  const [sectionHint, setSectionHint] = useState('自动判断')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState([])
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [savedVocabCount, setSavedVocabCount] = useState(0)
  const [manual, setManual] = useState(EMPTY_MANUAL)
  const [manualSaving, setManualSaving] = useState(false)
  const [vocabDraft, setVocabDraft] = useState('')
  const [explaining, setExplaining] = useState({})
  const inputRef = useRef(null)
  const photosRef = useRef([])
  const explainJobsRef = useRef(new Map())

  useEffect(() => {
    if (!loading) return undefined
    const t = setInterval(() => setLoadingStep((s) => (s + 1) % 4), 1800)
    return () => clearInterval(t)
  }, [loading])

  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), [])

  const addFiles = (list) => {
    const incoming = Array.from(list || []).filter((f) => /^image\//.test(f.type))
    if (!incoming.length) {
      if (list?.length) notify('请选择图片文件（JPG / PNG / WEBP）', 'error')
      return
    }
    const room = MAX_PHOTOS - photos.length
    if (room <= 0) {
      notify(`一次最多解析 ${MAX_PHOTOS} 张图片`, 'error')
      return
    }
    if (incoming.length > room) notify(`最多一次解析 ${MAX_PHOTOS} 张图片，已加入前 ${room} 张`, 'error')
    setPhotos([...photos, ...incoming.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))])
    setResult(null)
    setSavedCount(0)
    setSavedVocabCount(0)
  }

  const removePhoto = (url) => {
    URL.revokeObjectURL(url)
    setPhotos((prev) => prev.filter((p) => p.url !== url))
    setResult(null)
    setSavedCount(0)
    setSavedVocabCount(0)
  }

  const clearPhotos = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.url))
    setPhotos([])
    setResult(null)
    setSavedCount(0)
    setSavedVocabCount(0)
    if (inputRef.current) inputRef.current.value = ''
  }

  const analyze = async () => {
    if (!aiConfigured) {
      notify('先在设置里配置 AI 接口，才能自动解析', 'error')
      return
    }
    if (!photos.length && !text.trim()) {
      notify('请上传题目图片，或粘贴题目文字', 'error')
      return
    }
    setLoading(true)
    setLoadingStep(0)
    try {
      const fd = new FormData()
      photos.forEach((p) => fd.append('images', p.file))
      if (text.trim()) fd.append('text', text.trim())
      fd.append('section', sectionHint)
      const data = await api.upload('/api/ai/analyze-question', fd)
      explainJobsRef.current.clear()
      setExplaining({})
      setResult({
        ...data,
        questions: data.questions.map((q) => ({ ...q, _origAnswers: answerKey(q) })),
      })
      setSelected(data.questions.map(() => true))
      setSavedCount(0)
      setSavedVocabCount(0)
      const vocabCount = data.marked_vocab?.length || 0
      notify(
        data.questions.length
          ? `识别到 ${data.questions.length} 道题${vocabCount ? `、${vocabCount} 个标记单词` : ''}`
          : `已提取 ${vocabCount} 个标记单词`,
      )
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const updateQuestion = (index, patch) => {
    setResult((prev) => {
      if (!prev) return prev
      const questions = prev.questions.map((q, i) => {
        if (i !== index) return q
        const next = { ...q, ...patch }
        if ('my_answer' in patch || 'correct_answer' in patch) {
          const mine = answerLetter(next.my_answer)
          const correct = answerLetter(next.correct_answer)
          next.is_correct = mine && correct ? mine === correct : null
          if (next.is_correct !== false) {
            next.why_wrong = ''
            next.how_to_fix = ''
            next._explainedKey = ''
          }
        }
        return next
      })
      return { ...prev, questions }
    })
  }

  const needsExplain = (q) => {
    const key = answerKey(q)
    if (key.length !== 2 || key[0] === key[1]) return false
    if (q._explainedKey === key) return false
    return !String(q.why_wrong || '').trim() || q._origAnswers !== key
  }

  const requestExplain = (index, q) => {
    const key = answerKey(q)
    const jobKey = `${index}|${key}`
    if (!explainJobsRef.current.has(jobKey)) {
      const payload = {
        question: {
          section: q.section,
          subtype: q.subtype,
          question_text: q.question_text,
          options: q.options,
          context: q.context,
          analysis: q.analysis,
          my_answer: q.my_answer,
          correct_answer: q.correct_answer,
        },
        passage_text: result?.passage_text || '',
      }
      const job = api.post('/api/ai/explain-mistake', payload).finally(() => explainJobsRef.current.delete(jobKey))
      explainJobsRef.current.set(jobKey, job)
    }
    return explainJobsRef.current.get(jobKey)
  }

  const applyExplain = (index, key, data) => {
    setResult((prev) => {
      if (!prev) return prev
      const questions = prev.questions.map((q, i) => {
        if (i !== index || answerKey(q) !== key) return q
        return {
          ...q,
          why_wrong: data.why_wrong || q.why_wrong,
          how_to_fix: data.how_to_fix || q.how_to_fix,
          error_tags: data.error_tags?.length ? data.error_tags : q.error_tags,
          _explainedKey: key,
        }
      })
      return { ...prev, questions }
    })
  }

  const explainQuestion = async (index, { auto = false } = {}) => {
    const q = result?.questions?.[index]
    if (!q) return
    if (auto && !needsExplain(q)) return
    if (!aiConfigured) {
      if (!auto) notify('先在设置里配置 AI 接口，才能分析错因', 'error')
      return
    }
    if (explaining[index]) return
    const key = answerKey(q)
    if (key.length !== 2 || key[0] === key[1]) {
      if (!auto) notify('先把「我的答案」和「正确答案」都填成不同的字母（A–O）', 'error')
      return
    }
    setExplaining((prev) => ({ ...prev, [index]: true }))
    try {
      const data = await requestExplain(index, q)
      applyExplain(index, key, data)
    } catch (err) {
      if (!auto) notify(err.message, 'error')
    } finally {
      setExplaining((prev) => ({ ...prev, [index]: false }))
    }
  }

  const addMarkedVocab = () => {
    const entries = vocabDraft.split(/[\n,，]/).map((s) => s.trim()).filter(Boolean)
    if (!entries.length) return
    setResult((prev) => {
      if (!prev) return prev
      const current = prev.marked_vocab || []
      const seen = new Set(current.map((v) => String(v.word || '').trim().toLowerCase()))
      const added = []
      for (const entry of entries) {
        const [word, meaning] = entry.split(/[|｜]/)
        const w = (word || '').trim()
        if (!w || seen.has(w.toLowerCase())) continue
        seen.add(w.toLowerCase())
        added.push({ word: w, meaning: (meaning || '').trim(), phonetic: '', example: '' })
      }
      return added.length ? { ...prev, marked_vocab: [...current, ...added] } : prev
    })
    setVocabDraft('')
  }

  const saveResult = async () => {
    const chosen = result.questions.map((q, i) => ({ q, i })).filter(({ i }) => selected[i])
    const marked = result.marked_vocab || []
    if (!chosen.length && !marked.length) {
      notify('至少选择一道题或保留标记单词再保存', 'error')
      return
    }
    setSaving(true)
    try {
      const prepared = []
      for (const { q, i } of chosen) {
        if (!aiConfigured || !needsExplain(q)) {
          prepared.push(q)
          continue
        }
        try {
          const data = await requestExplain(i, q)
          prepared.push({
            ...q,
            why_wrong: data.why_wrong || q.why_wrong,
            how_to_fix: data.how_to_fix || q.how_to_fix,
            error_tags: data.error_tags?.length ? data.error_tags : q.error_tags,
          })
        } catch {
          prepared.push(q)
        }
      }
      for (const q of prepared) {
        await api.post('/api/questions', {
          ...q,
          source: '拍照解析',
          image_path: result.image_paths?.[0] || result.image_path || '',
          image_paths: result.image_paths || [],
        })
      }
      if (marked.length) {
        await api.post('/api/vocab/bulk', { items: marked, source: '照片标记词' })
      }
      setSavedCount(chosen.length)
      setSavedVocabCount(marked.length)
      setResult(null)
      photos.forEach((p) => URL.revokeObjectURL(p.url))
      setPhotos([])
      if (inputRef.current) inputRef.current.value = ''
      refreshDashboard()
      const parts = []
      if (chosen.length) parts.push(`${chosen.length} 道错题`)
      if (marked.length) parts.push(`${marked.length} 个标记单词`)
      notify(`已存入${parts.join('、')}`)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const saveManual = async () => {
    if (!manual.question_text.trim()) {
      notify('题干不能为空', 'error')
      return
    }
    setManualSaving(true)
    try {
      const options = manual.optionsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const vocab = manual.vocabText
        .split('\n')
        .map((line) => {
          const [word, meaning] = line.split(/[|｜]/)
          return { word: (word || '').trim(), meaning: (meaning || '').trim(), phonetic: '', example: '' }
        })
        .filter((v) => v.word)
      const mine = manual.my_answer.trim().toUpperCase()
      const correct = manual.correct_answer.trim().toUpperCase()
      await api.post('/api/questions', {
        ...manual,
        options,
        vocab,
        is_correct: mine && correct ? mine === correct : null,
        source: manual.source || '手动录题',
      })
      setManual(EMPTY_MANUAL)
      refreshDashboard()
      notify('已存入错题本')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setManualSaving(false)
    }
  }

  const loadingMessages = ['正在识别题目与手写答案…', '正在定位答案句…', '正在拆解同义替换…', '正在收集你标记的重点单词…']
  const markedVocab = result?.marked_vocab || []
  const chosenCount = selected.filter(Boolean).length

  return (
    <div>
      <PageHeader
        eyebrow="CAPTURE & ANALYZE"
        title="拍照解析"
        desc="上传做过的题（可多张），AI 拆出正确答案、定位句、生词和错因；结果可改，再存入错题本。"
        actions={
          <Link to="/wrong" className="btn btn-ghost">
            <BookOpen size={16} />
            打开错题本
          </Link>
        }
      />

      {!aiConfigured && (
        <div className="notice notice-warn">
          <AlertCircle size={18} />
          <div>
            <strong>还没有配置 AI 接口</strong>
            <p>自动解析、作文翻译批改需要 AI。你可以先去设置填写，或者用手动录题把错题记录下来。</p>
          </div>
          <Link to="/settings" className="btn btn-sm btn-dark">去配置</Link>
        </div>
      )}

      <div className="seg-control page-tabs">
        <button type="button" className={tab === 'photo' ? 'active' : ''} onClick={() => setTab('photo')}>
          <Camera size={15} /> 拍照解析
        </button>
        <button type="button" className={tab === 'manual' ? 'active' : ''} onClick={() => setTab('manual')}>
          <Keyboard size={15} /> 手动录题
        </button>
      </div>

      {tab === 'photo' ? (
        <div className="capture-grid">
          <div className="card capture-form">
            <div className="card-head">
              <div>
                <span className="card-kicker">第一步</span>
                <h2>上传题目</h2>
              </div>
              <span className="muted small">JPG / PNG / WEBP，单张 12MB，最多 12 张</span>
            </div>

            {photos.length ? (
              <div className="photo-grid">
                {photos.map((p, index) => (
                  <div className="photo-thumb" key={p.url}>
                    <a href={p.url} target="_blank" rel="noreferrer" className="photo-thumb-link" title="查看大图">
                      <img src={p.url} alt={`题目图片 ${index + 1}`} />
                    </a>
                    <span className="photo-index">{index + 1}</span>
                    <button
                      type="button"
                      className="photo-remove"
                      onClick={() => removePhoto(p.url)}
                      aria-label={`移除第 ${index + 1} 张图片`}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <button type="button" className="photo-add" onClick={() => inputRef.current?.click()}>
                    <Plus size={20} />
                    <span>继续添加</span>
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="dropzone"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  addFiles(e.dataTransfer.files)
                }}
              >
                <span className="dropzone-icon"><Upload size={26} /></span>
                <strong>点击或拖拽上传题目照片（1-12 张）</strong>
                <span>同一套题的文章页、题目页可以一起传，AI 会合并识别</span>
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''
              }}
            />

            <div className="two-col">
              <Field label="题型提示" hint="不清楚就选自动判断">
                <select className="input input-select" value={sectionHint} onChange={(e) => setSectionHint(e.target.value)}>
                  <option>自动判断</option>
                  {QUESTION_SECTIONS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="图片状态">
                <div className="file-state">
                  <ImageIcon size={15} />
                  {photos.length ? `${photos.length} 张图片待解析` : '还没有选择图片'}
                  {photos.length > 0 && (
                    <button type="button" className="text-btn photo-clear" onClick={clearPhotos}>全部移除</button>
                  )}
                </div>
              </Field>
            </div>

            <Field label="补充文字（可选）" hint="手写不清、题干漏拍时，把题干或你的答案补在这里">
              <textarea
                className="input"
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="例如：第 3 题我选的是 B；题干是 What does the author suggest..."
              />
            </Field>

            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={analyze} disabled={loading}>
              <Sparkles size={18} />
              {loading ? '正在解析…' : '开始 AI 解析'}
            </button>
            <p className="form-note">一套题的文章页、题目页可以一起上传；AI 会合并识别，解析结果保存前都可以修改。</p>
          </div>

          <div className="card capture-result">
            {loading ? (
              <div className="analysis-loading">
                <div className="scan-box">
                  <span className="scan-line" />
                  <Sparkles size={30} />
                </div>
                <h3>AI 正在拆题</h3>
                <p>{loadingMessages[loadingStep]}</p>
                <div className="loading-dots"><i /><i /><i /></div>
              </div>
            ) : savedCount > 0 || savedVocabCount > 0 ? (
              <div className="success-state">
                <span className="success-icon"><CheckCircle2 size={34} /></span>
                <h2>
                  {savedCount > 0 && `已存入 ${savedCount} 道错题`}
                  {savedCount > 0 && savedVocabCount > 0 && ' · '}
                  {savedVocabCount > 0 && `已加入 ${savedVocabCount} 个生词`}
                </h2>
                <p>
                  {savedCount > 0 && '答案、解析、错因标签都已归档，学情分析会开始更新。'}
                  {savedCount > 0 && savedVocabCount > 0 && ' '}
                  {savedVocabCount > 0 && '图片中标记的重点单词已进入单词本，明天开始会按复习计划提醒你。'}
                </p>
                <div className="success-actions">
                  <Link to={savedCount > 0 ? '/wrong' : '/vocab'} className="btn btn-primary">
                    {savedCount > 0 ? '去错题本看看' : '去单词本看看'}
                  </Link>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setSavedCount(0)
                      setSavedVocabCount(0)
                    }}
                  >
                    再传一道
                  </button>
                </div>
              </div>
            ) : result ? (
              <div className="parsed-list">
                <div className="parsed-top">
                  <div>
                    <span className="card-kicker">第二步</span>
                    <h2>核对并保存</h2>
                    <p className="muted small">
                      {result.questions.length
                        ? `识别到 ${result.questions.length} 道题，可修改答案、解析和标签。`
                        : `没有识别出完整题目，已挑出 ${markedVocab.length} 个荧光笔标记的重点词，可直接保存到单词本。`}
                    </p>
                  </div>
                  <span className="badge badge-teal">
                    {result.questions.length ? `${chosenCount} 道已选` : `${markedVocab.length} 个生词`}
                  </span>
                </div>
                {result.overall_note && <div className="notice-inline">{result.overall_note}</div>}

                <div className="marked-vocab-panel">
                    <div className="marked-vocab-head">
                      <span className="mini-label">荧光笔标记 + 手写中文的重点词（{markedVocab.length}）</span>
                      <em>已按四级考频筛选，保存时全部加入单词本</em>
                    </div>
                    {markedVocab.length > 0 && (
                      <div className="tag-row">
                        {markedVocab.map((v, i) => (
                          <span key={i} className="vocab-chip editable">
                            <b>{v.word}</b>
                            {v.meaning && <em>{v.meaning}</em>}
                            <button
                              type="button"
                              aria-label={`移除 ${v.word}`}
                              title="不是标记词，移除"
                              onClick={() => setResult((prev) => ({ ...prev, marked_vocab: (prev.marked_vocab || []).filter((_, j) => j !== i) }))}
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="vocab-add-row">
                      <input
                        className="input"
                        value={vocabDraft}
                        onChange={(e) => setVocabDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addMarkedVocab()
                          }
                        }}
                        placeholder="AI 漏掉的荧光笔重点词可以在这里补，如 catch up on sleep | 补觉"
                      />
                      <button type="button" className="btn btn-ghost btn-sm" onClick={addMarkedVocab} disabled={!vocabDraft.trim()}>
                        <Plus size={13} /> 补充
                      </button>
                    </div>
                  </div>

                {result.questions.map((q, index) => (
                  <ParsedQuestion
                    key={index}
                    q={q}
                    index={index}
                    checked={selected[index]}
                    explaining={Boolean(explaining[index])}
                    onCheck={() => setSelected((prev) => prev.map((v, i) => (i === index ? !v : v)))}
                    update={(patch) => updateQuestion(index, patch)}
                    onExplain={() => explainQuestion(index)}
                    onAutoExplain={() => explainQuestion(index, { auto: true })}
                  />
                ))}

                <div className="sticky-actions">
                  <button type="button" className="btn btn-primary btn-lg" onClick={saveResult} disabled={saving}>
                    <Save size={18} />
                    {saving
                      ? '保存中…'
                      : chosenCount === 0 && markedVocab.length > 0
                        ? `保存 ${markedVocab.length} 个生词到单词本`
                        : `保存 ${chosenCount} 道到错题本${markedVocab.length ? `（含 ${markedVocab.length} 个标记词）` : ''}`}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setResult(null)}>清空结果</button>
                </div>
              </div>
            ) : (
              <div className="capture-placeholder">
                <span className="placeholder-icon"><Sparkles size={28} /></span>
                <h3>解析结果会出现在这里</h3>
                <p>AI 会返回：正确答案、你的答案对错、定位句、同义替换、错因标签，以及图片里你标记的所有重点单词。</p>
                <div className="placeholder-steps">
                  <span><b>1</b> 上传照片</span>
                  <span><b>2</b> 核对结果</span>
                  <span><b>3</b> 存入错题本</span>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card manual-card">
          <div className="card-head">
            <div>
              <span className="card-kicker">手动录入</span>
              <h2>没有 AI 也能先记下来</h2>
              <p className="muted small">题干、答案、错因标签填清楚，后面的分析和复测一样能用。</p>
            </div>
          </div>
          <div className="two-col">
            <Field label="题型" required>
              <select className="input input-select" value={manual.section} onChange={(e) => setManual({ ...manual, section: e.target.value })}>
                {QUESTION_SECTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="细分题型" hint="如 细节题 / 推断题 / 主旨题">
              <input className="input" value={manual.subtype} onChange={(e) => setManual({ ...manual, subtype: e.target.value })} placeholder="细节题" />
            </Field>
          </div>
          <Field label="题干" required>
            <textarea className="input" rows={3} value={manual.question_text} onChange={(e) => setManual({ ...manual, question_text: e.target.value })} placeholder="把题干原文抄进来" />
          </Field>
          <Field label="定位句 / 上下文（可选）">
            <textarea className="input" rows={2} value={manual.context} onChange={(e) => setManual({ ...manual, context: e.target.value })} placeholder="答案所在的那一句原文" />
          </Field>
          <Field label="选项（每行一个）">
            <textarea className="input" rows={4} value={manual.optionsText} onChange={(e) => setManual({ ...manual, optionsText: e.target.value })} placeholder={'A. ...\nB. ...\nC. ...\nD. ...'} />
          </Field>
          <div className="two-col">
            <Field label="我的答案">
              <input className="input" value={manual.my_answer} onChange={(e) => setManual({ ...manual, my_answer: e.target.value })} placeholder="B" />
            </Field>
            <Field label="正确答案">
              <input className="input" value={manual.correct_answer} onChange={(e) => setManual({ ...manual, correct_answer: e.target.value })} placeholder="C" />
            </Field>
          </div>
          <Field label="解析 / 复盘" hint="写清为什么错、正确项在哪一句">
            <textarea className="input" rows={4} value={manual.analysis} onChange={(e) => setManual({ ...manual, analysis: e.target.value })} placeholder="定位句是…；我错在…；下次先…" />
          </Field>
          <div className="two-col">
            <Field label="为什么错（可选）">
              <textarea className="input" rows={3} value={manual.why_wrong} onChange={(e) => setManual({ ...manual, why_wrong: e.target.value })} placeholder="被哪个干扰项带偏了" />
            </Field>
            <Field label="下次怎么改（可选）">
              <textarea className="input" rows={3} value={manual.how_to_fix} onChange={(e) => setManual({ ...manual, how_to_fix: e.target.value })} placeholder="下次先做什么、再做什么" />
            </Field>
          </div>
          <div className="two-col">
            <Field label="生词（每行：单词 | 释义）" hint="会自动加入单词本">
              <textarea className="input" rows={4} value={manual.vocabText} onChange={(e) => setManual({ ...manual, vocabText: e.target.value })} placeholder={'vital | 至关重要的\nbenefit | 有益于'} />
            </Field>
            <Field label="中文翻译 / 备注">
              <textarea className="input" rows={4} value={manual.translation} onChange={(e) => setManual({ ...manual, translation: e.target.value })} placeholder="答案解析的中文翻译，或给自己的提醒" />
            </Field>
          </div>
          <Field label="错因标签">
            <div className="tag-row">
              {manual.error_tags.map((t) => (
                <Tag key={t} active onClick={() => setManual({ ...manual, error_tags: manual.error_tags.filter((x) => x !== t) })}>
                  {t} ×
                </Tag>
              ))}
              <TagSelect value={manual.error_tags} onChange={(tags) => setManual({ ...manual, error_tags: tags })} />
            </div>
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={saveManual} disabled={manualSaving}>
              <Save size={18} />
              {manualSaving ? '保存中…' : '存入错题本'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setManual(EMPTY_MANUAL)}>重置</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ParsedQuestion({ q, index, checked, explaining, onCheck, update, onExplain, onAutoExplain }) {
  const [showMore, setShowMore] = useState(false)
  const mine = String(q.my_answer || '').toUpperCase()
  const correct = String(q.correct_answer || '').toUpperCase()
  const verdict = q.is_correct === true ? 'correct' : q.is_correct === false ? 'wrong' : null
  const hasWhyWrong = Boolean(String(q.why_wrong || '').trim())

  return (
    <div className={`parsed-card ${checked ? '' : 'unselected'}`}>
      <div className="parsed-head">
        <label className="check-label">
          <input type="checkbox" checked={checked} onChange={onCheck} />
          <span />
        </label>
        <strong>第 {q.number || index + 1} 题</strong>
        <SectionBadge section={q.section} />
        {verdict && <span className={`verdict ${verdict}`}>{verdict === 'correct' ? '做对了' : '做错了'}</span>}
        {q.confidence === 'low' && <span className="badge badge-muted">识别置信度低</span>}
      </div>

      <div className="two-col">
        <Field label="题型">
          <select className="input input-select" value={q.section} onChange={(e) => update({ section: e.target.value })}>
            {QUESTION_SECTIONS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="细分题型">
          <input className="input" value={q.subtype} onChange={(e) => update({ subtype: e.target.value })} placeholder="细节题 / 推断题" />
        </Field>
      </div>

      <Field label="题干">
        <textarea className="input" rows={3} value={q.question_text} onChange={(e) => update({ question_text: e.target.value })} />
      </Field>

      <Field label="选项（每行一个）">
        <textarea
          className="input"
          rows={Math.min(10, Math.max(4, (q.options || []).length))}
          value={(q.options || []).join('\n')}
          onChange={(e) => update({ options: e.target.value.split('\n') })}
        />
      </Field>

      <div className="answer-row">
        <label>
          <span>我的答案</span>
          <input
            className="input answer-input"
            value={q.my_answer}
            onChange={(e) => update({ my_answer: e.target.value })}
            onBlur={onAutoExplain}
            placeholder="B"
          />
        </label>
        <ArrowRight size={18} className="answer-arrow" />
        <label>
          <span>正确答案</span>
          <input
            className="input answer-input"
            value={q.correct_answer}
            onChange={(e) => update({ correct_answer: e.target.value })}
            onBlur={onAutoExplain}
            placeholder="C"
          />
        </label>
        {verdict && <span className={`verdict ${verdict}`}>{verdict === 'correct' ? '对' : '错'}</span>}
      </div>
      {q.answer_basis && <p className="answer-basis">识别依据：{q.answer_basis}</p>}
      {verdict === 'wrong' && (
        <div className="mistake-assist">
          {explaining ? (
            <span className="mistake-assist-status">
              <span className="spinner" />
              AI 正在分析为什么错…
            </span>
          ) : (
            <button type="button" className="text-btn" onClick={onExplain}>
              <Sparkles size={13} />
              {hasWhyWrong ? '重新分析为什么错' : '让 AI 分析为什么错'}
            </button>
          )}
          {!explaining && !hasWhyWrong && (
            <span className="muted small">改完答案离开输入框，会自动分析</span>
          )}
        </div>
      )}

      <Field label="解析">
        <textarea className="input" rows={5} value={q.analysis} onChange={(e) => update({ analysis: e.target.value })} />
      </Field>

      <div className="two-col diagnosis-fields">
        <Field label="为什么错" hint="具体到哪个干扰项、哪一步思路断了；做对可留空">
          <textarea
            className="input"
            rows={3}
            value={q.why_wrong || ''}
            onChange={(e) => update({ why_wrong: e.target.value })}
            placeholder="AI 会对比你的答案和正确思路，指出具体失误点"
          />
        </Field>
        <Field label="下次怎么改" hint="可执行的 1-3 步">
          <textarea
            className="input"
            rows={3}
            value={q.how_to_fix || ''}
            onChange={(e) => update({ how_to_fix: e.target.value })}
            placeholder="例如：先划题干关键词 → 回原文定位答案句 → 对比同义替换再选"
          />
        </Field>
      </div>

      <div className="tag-row">
        {q.error_tags.map((t) => (
          <Tag key={t} active onClick={() => update({ error_tags: q.error_tags.filter((x) => x !== t) })}>{t} ×</Tag>
        ))}
        <TagSelect value={q.error_tags} onChange={(tags) => update({ error_tags: tags })} />
      </div>

      <button type="button" className="text-btn more-toggle" onClick={() => setShowMore((v) => !v)}>
        {showMore ? '收起上下文与生词' : `展开上下文与生词（${(q.vocab || []).length}）`}
      </button>

      {showMore && (
        <div className="parsed-more">
          <Field label="定位句 / 上下文">
            <textarea className="input" rows={3} value={q.context} onChange={(e) => update({ context: e.target.value })} />
          </Field>
          {!!(q.key_sentences || []).length && (
            <div className="key-sentences">
              <span className="mini-label">关键句</span>
              {q.key_sentences.map((s, i) => (
                <div key={i} className="key-sentence">
                  <p>{s.en}</p>
                  <span>{s.zh}</span>
                </div>
              ))}
            </div>
          )}
          <div className="vocab-editor">
            <div className="mini-head">
              <span className="mini-label">关键生词（保存后可在错题本单独加入单词本）</span>
              <button type="button" className="text-btn" onClick={() => update({ vocab: [...(q.vocab || []), { word: '', meaning: '', phonetic: '', example: '' }] })}>
                <Plus size={13} /> 添加
              </button>
            </div>
            {(q.vocab || []).map((v, i) => (
              <div className="vocab-row" key={i}>
                <input
                  className="input"
                  value={v.word || ''}
                  onChange={(e) => {
                    const next = [...q.vocab]
                    next[i] = { ...next[i], word: e.target.value }
                    update({ vocab: next })
                  }}
                  placeholder="word"
                />
                <input
                  className="input"
                  value={v.meaning || ''}
                  onChange={(e) => {
                    const next = [...q.vocab]
                    next[i] = { ...next[i], meaning: e.target.value }
                    update({ vocab: next })
                  }}
                  placeholder="中文释义"
                />
                <button
                  type="button"
                  className="icon-btn danger"
                  onClick={() => update({ vocab: q.vocab.filter((_, j) => j !== i) })}
                  aria-label="删除生词"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <Field label="给自己的提醒">
            <input className="input" value={q.note} onChange={(e) => update({ note: e.target.value })} placeholder="下次先看题干关键词" />
          </Field>
        </div>
      )}
    </div>
  )
}