import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Languages,
  Plus,
  Search,
  Trash2,
  Check,
  X,
  RotateCcw,
  CalendarClock,
  Sparkles,
  ArrowRight,
  Volume2,
  VolumeX,
  Camera,
  Upload,
} from 'lucide-react'
import { api, fmtDate, todayISO } from '../api'
import { useApp } from '../store'
import { EmptyState, Field, Modal, PageHeader, ProgressBar, StatCard } from '../components/UI'

const MAX_TILES = 12

async function tilePhoto(file) {
  if (!file || file.size < 400 * 1024) return [file]
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return [file]
  }
  const { width: w, height: h } = bitmap
  if (!w || !h || w * h < 1_600_000) {
    bitmap.close()
    return [file]
  }
  const tileW = Math.min(w, Math.ceil((w / 2) * 1.1))
  const tileH = Math.min(h, Math.ceil((h / 2) * 1.1))
  const xs = [0, w - tileW]
  const ys = [0, h - tileH]
  const tiles = []
  let index = 0
  for (const y of ys) {
    for (const x of xs) {
      const cw = Math.min(tileW, w - x)
      const ch = Math.min(tileH, h - y)
      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, cw, ch)
      ctx.drawImage(bitmap, x, y, cw, ch, 0, 0, cw, ch)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (blob) {
        tiles.push(new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}-${++index}.jpg`, { type: 'image/jpeg' }))
      }
    }
  }
  bitmap.close()
  return tiles.length ? tiles : [file]
}

function nextLabel(date) {
  if (!date) return '未安排'
  const today = todayISO()
  if (date <= today) return '今天到期'
  const d = new Date(`${today}T00:00:00`)
  const target = new Date(`${date}T00:00:00`)
  const diff = Math.round((target - d) / 86400000)
  if (diff === 1) return '明天'
  if (diff <= 7) return `${diff} 天后`
  return fmtDate(date)
}

function pickEnglishVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || []
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang || ''))
  return (
    english.find((v) => /en-US/i.test(v.lang) && /natural|zira|aria|samantha|google us/i.test(v.name)) ||
    english.find((v) => /en-US/i.test(v.lang)) ||
    english[0] ||
    null
  )
}

function speak(word) {
  const synth = window.speechSynthesis
  if (!synth || !word) return
  try {
    synth.cancel()
    const u = new SpeechSynthesisUtterance(word)
    const voice = pickEnglishVoice()
    if (voice) u.voice = voice
    u.lang = voice?.lang || 'en-US'
    u.rate = 0.9
    synth.speak(u)
  } catch {
    /* ignore */
  }
}

export default function Vocabulary() {
  const { notify, aiConfigured } = useApp()
  const [vocab, setVocab] = useState([])
  const [stats, setStats] = useState({ total: 0, due: 0, learned: 0, today: todayISO() })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')
  const [queue, setQueue] = useState([])
  const [reviewing, setReviewing] = useState(false)
  const [initialCount, setInitialCount] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [lapses, setLapses] = useState({})
  const [retryNote, setRetryNote] = useState('')
  const [autoSpeak, setAutoSpeak] = useState(() => localStorage.getItem('cet4.auto-speak') !== 'off')
  const [cardTick, setCardTick] = useState(0)
  const lastAutoSpeak = useRef({ word: '', at: 0 })
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ word: '', phonetic: '', meaning: '', example: '', pos: '', forms: '' })
  const [saving, setSaving] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [photoFiles, setPhotoFiles] = useState([])
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoWords, setPhotoWords] = useState([])
  const [photoSelected, setPhotoSelected] = useState([])
  const [photoSaving, setPhotoSaving] = useState(false)
  const photoInputRef = useRef(null)
  const photoReq = useRef(0)

  const load = async () => {
    try {
      const data = await api.get('/api/vocab')
      setVocab(data.vocab || [])
      setStats(data.stats)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const dueList = useMemo(() => vocab.filter((v) => v.next_review <= todayISO()), [vocab])
  const current = queue[0]

  useEffect(() => {
    localStorage.setItem('cet4.auto-speak', autoSpeak ? 'on' : 'off')
  }, [autoSpeak])

  useEffect(() => {
    if (!reviewing || !current || !autoSpeak) return
    const now = Date.now()
    if (lastAutoSpeak.current.word === current.word && now - lastAutoSpeak.current.at < 600) return
    lastAutoSpeak.current = { word: current.word, at: now }
    speak(current.word)
  }, [reviewing, current?.id, cardTick, autoSpeak])

  const startReview = () => {
    const items = dueList.slice(0, 60)
    if (!items.length) {
      notify('今天没有到期单词')
      return
    }
    setQueue(items)
    setInitialCount(items.length)
    setRevealed(false)
    setLapses({})
    setRetryNote('')
    setReviewing(true)
    setCardTick((t) => t + 1)
    if (autoSpeak) {
      lastAutoSpeak.current = { word: items[0].word, at: Date.now() }
      speak(items[0].word)
    }
  }

  const answer = async (known) => {
    if (!current) return
    if (!known) {
      setLapses((prev) => ({ ...prev, [current.id]: (prev[current.id] || 0) + 1 }))
      setQueue((prev) => (prev.length > 1 ? [...prev.slice(1), prev[0]] : prev))
      setRetryNote(`「${current.word}」排到队尾了，等会儿再记一次，认识才算完成。`)
      setRevealed(false)
      setCardTick((t) => t + 1)
      return
    }
    const lapsed = Boolean(lapses[current.id])
    try {
      await api.post(`/api/vocab/${current.id}/review`, { known: true, lapsed })
      setQueue((prev) => prev.slice(1))
      setRevealed(false)
      setRetryNote('')
      setCardTick((t) => t + 1)
      setLapses((prev) => {
        const next = { ...prev }
        delete next[current.id]
        return next
      })
      if (queue.length === 1) {
        const data = await api.get('/api/vocab')
        setVocab(data.vocab || [])
        setStats(data.stats)
      }
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const addWord = async () => {
    if (!form.word.trim()) {
      notify('单词不能为空', 'error')
      return
    }
    setSaving(true)
    try {
      await api.post('/api/vocab', { ...form, source: '手动添加' })
      setForm({ word: '', phonetic: '', meaning: '', example: '', pos: '', forms: '' })
      setAddOpen(false)
      await load()
      notify('单词已加入词库')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (word) => {
    if (!window.confirm(`删除单词 ${word.word}？`)) return
    try {
      await api.del(`/api/vocab/${word.id}`)
      setVocab((prev) => prev.filter((v) => v.id !== word.id))
      setStats((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }))
      notify('单词已删除')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const addPhotoFiles = (list) => {
    const incoming = Array.from(list || []).filter((f) => /^image\//.test(f.type))
    if (!incoming.length) {
      if (list?.length) notify('请选择图片文件（JPG / PNG / WEBP）', 'error')
      return
    }
    const room = 6 - photoFiles.length
    if (room <= 0) {
      notify('一次最多 6 张图片', 'error')
      return
    }
    if (incoming.length > room) notify(`最多一次 6 张，已加入前 ${room} 张`, 'error')
    setPhotoFiles([
      ...photoFiles,
      ...incoming.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) })),
    ])
    setPhotoWords([])
    setPhotoSelected([])
  }

  const removePhotoFile = (url) => {
    URL.revokeObjectURL(url)
    setPhotoFiles((prev) => prev.filter((p) => p.url !== url))
    setPhotoWords([])
    setPhotoSelected([])
  }

  const resetPhoto = () => {
    photoReq.current += 1
    photoFiles.forEach((p) => URL.revokeObjectURL(p.url))
    setPhotoFiles([])
    setPhotoWords([])
    setPhotoSelected([])
    setPhotoBusy(false)
    setPhotoSaving(false)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  const closePhoto = () => {
    resetPhoto()
    setPhotoOpen(false)
  }

  const analyzePhoto = async () => {
    if (!aiConfigured) {
      notify('先在设置里配置 AI 接口，才能识别单词照片', 'error')
      return
    }
    if (!photoFiles.length) {
      notify('请先上传单词照片', 'error')
      return
    }
    const reqId = ++photoReq.current
    setPhotoBusy(true)
    try {
      const fd = new FormData()
      const sources = photoFiles.length <= 2
        ? (await Promise.all(photoFiles.map((p) => tilePhoto(p.file)))).flat().slice(0, MAX_TILES)
        : photoFiles.slice(0, 6).map((p) => p.file)
      sources.forEach((file) => fd.append('images', file))
      const data = await api.upload('/api/ai/extract-vocab-photo', fd)
      if (reqId !== photoReq.current) return
      const words = data.words || []
      setPhotoWords(words)
      setPhotoSelected(words.map(() => true))
      if (data.failed) notify(`找到 ${words.length} 个词，但有 ${data.failed} 块图片没识别成功，可点「重新识别」补全`, 'error')
      else notify(`找到 ${words.length} 个词，核对后加入单词本`)
    } catch (err) {
      if (reqId === photoReq.current) notify(err.message, 'error')
    } finally {
      if (reqId === photoReq.current) setPhotoBusy(false)
    }
  }

  const togglePhotoWord = (index) => {
    setPhotoSelected((prev) => prev.map((v, i) => (i === index ? !v : v)))
  }

  const toggleAllPhotoWords = () => {
    const all = photoWords.length > 0 && photoSelected.filter(Boolean).length === photoWords.length
    setPhotoSelected(photoWords.map(() => !all))
  }

  const updatePhotoWord = (index, patch) => {
    setPhotoWords((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)))
  }

  const removePhotoWord = (index) => {
    setPhotoWords((prev) => prev.filter((_, i) => i !== index))
    setPhotoSelected((prev) => prev.filter((_, i) => i !== index))
  }

  const savePhotoWords = async () => {
    const items = photoWords
      .filter((_, i) => photoSelected[i])
      .map((v) => ({
        word: String(v.word || '').trim(),
        meaning: String(v.meaning || '').trim(),
        phonetic: v.phonetic || '',
        example: v.example || '',
        pos: v.pos || '',
        forms: v.forms || '',
      }))
      .filter((v) => v.word && v.meaning)
    if (!items.length) {
      notify('至少选一个有中文释义的单词', 'error')
      return
    }
    setPhotoSaving(true)
    try {
      const data = await api.post('/api/vocab/bulk', { items, source: '单词照片' })
      const parts = []
      if (data.added) parts.push(`新增 ${data.added} 个`)
      if (data.updated) parts.push(`补充释义 ${data.updated} 个`)
      if (data.skipped) parts.push(`跳过重复 ${data.skipped} 个`)
      notify(parts.length ? parts.join('，') : '这些词和释义都已经在单词本里了')
      closePhoto()
      await load()
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setPhotoSaving(false)
    }
  }

  const filtered = vocab.filter((v) => {
    if (tab === 'due' && v.next_review > todayISO()) return false
    if (tab === 'learned' && (v.times_reviewed || 0) < 3) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      return (
        v.word.toLowerCase().includes(q) ||
        String(v.meaning || '').toLowerCase().includes(q) ||
        String(v.forms || '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const reviewedCount = initialCount - queue.length
  const retryTotal = Object.values(lapses).reduce((sum, n) => sum + n, 0)
  const selectedPhotoCount = photoSelected.filter(Boolean).length

  return (
    <div>
      <PageHeader
        eyebrow="VOCAB RECALL"
        title="单词本"
        desc="只收真正绊倒过你的词。不认识的卡会反复出现，全部按「记住了」才算完成。"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setPhotoOpen(true)}>
              <Camera size={16} /> 拍照收词
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={16} /> 加单词
            </button>
          </>
        }
      />

      <section className="stats-row stats-row-3">
        <StatCard label="词库总数" value={stats.total} unit="个" hint="荧光笔重点词自动进来" icon={Languages} tone="teal" />
        <StatCard label="今天到期" value={stats.due} unit="个" hint={stats.due ? '先清到期卡' : '今天的已清完'} icon={CalendarClock} tone="orange" />
        <StatCard label="已熟悉" value={stats.learned} unit="个" hint="复习 3 次以上" icon={Check} tone="violet" />
      </section>

      <div className="vocab-layout">
        <div className="card review-card">
          {reviewing && current ? (
            <>
              <div className="review-head">
                <div>
                  <span className="card-kicker">今日复习</span>
                  <h2>{reviewedCount} / {initialCount} 已认识</h2>
                </div>
                <div className="review-head-actions">
                  <button
                    type="button"
                    className={`text-btn speak-toggle ${autoSpeak ? 'on' : ''}`}
                    onClick={() => setAutoSpeak((v) => !v)}
                    aria-pressed={autoSpeak}
                    title={autoSpeak ? '关闭自动发音' : '打开自动发音'}
                  >
                    {autoSpeak ? <Volume2 size={14} /> : <VolumeX size={14} />}
                    {autoSpeak ? '自动发音开' : '自动发音关'}
                  </button>
                  <button type="button" className="text-btn" onClick={() => setReviewing(false)}>
                    <X size={14} /> 退出
                  </button>
                </div>
              </div>
              <ProgressBar value={reviewedCount} max={initialCount || 1} color="var(--teal)" height={5} />
              <p className="review-remaining">
                还剩 {queue.length} 张{retryTotal ? ` · 已重来 ${retryTotal} 次` : ''}
              </p>
              {retryNote && <p className="review-retry">{retryNote}</p>}

              <div className="flashcard">
                <button type="button" className="speak-btn" onClick={() => speak(current.word)} title="朗读">
                  <Volume2 size={18} />
                </button>
                <div className="flash-word">{current.word}</div>
                <div className="flash-meta">
                  {current.pos && <span className="flash-pos">{current.pos}</span>}
                  {current.phonetic && <span className="flash-phonetic">{current.phonetic}</span>}
                </div>
                {current.forms && <p className="flash-forms">变形：{current.forms}</p>}
                <div className="flash-source">{current.source || '词库'}</div>

                {revealed ? (
                  <div className="flash-reveal">
                    <div className="flash-meaning">{current.meaning || '（暂无释义）'}</div>
                    {current.example && <p className="flash-example">{current.example}</p>}
                    <div className="flash-buttons">
                      <button type="button" className="btn btn-ghost btn-lg" onClick={() => answer(false)}>
                        <RotateCcw size={17} /> 还不认识
                      </button>
                      <button type="button" className="btn btn-primary btn-lg" onClick={() => answer(true)}>
                        <Check size={17} /> 记住了
                      </button>
                    </div>
                    <p className="muted small">按「还不认识」不算完成：这张会排到队尾，直到你按「记住了」为止。</p>
                  </div>
                ) : (
                  <div className="flash-reveal-front">
                    <p>先在心里说出中文意思和例句，再翻面。</p>
                    <button type="button" className="btn btn-dark btn-lg" onClick={() => setRevealed(true)}>
                      显示释义
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : reviewing && !current ? (
            <div className="review-done">
              <span className="success-icon"><Sparkles size={32} /></span>
              <h2>今天的到期卡清完了</h2>
              <p>{initialCount} 张全部过到「认识」才算完成。明天会按间隔继续提醒，别忘了回来。</p>
              <div className="success-actions">
                <button type="button" className="btn btn-primary" onClick={() => setReviewing(false)}>回到词库</button>
                <Link to="/timer" className="btn btn-ghost">去练一组听力</Link>
              </div>
            </div>
          ) : (
            <div className="review-idle">
              <span className="review-big-number">{stats.due}</span>
              <h2>{stats.due ? '个单词今天到期' : '今天没有到期单词'}</h2>
              <p>{stats.due ? '按「还不认识」的卡会反复出现，全部按「记住了」才算完成。' : '可以提前复习，或者去错题里把生词补进词库。'}</p>
              <div className="review-actions">
                {stats.due > 0 ? (
                  <button type="button" className="btn btn-primary btn-lg" onClick={startReview}>
                    <Sparkles size={17} /> 开始复习
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-lg" onClick={() => { setQueue(vocab.slice(0, 30)); setInitialCount(Math.min(30, vocab.length)); setReviewing(true); }} disabled={!vocab.length}>
                    提前复习
                  </button>
                )}
                <Link to="/wrong" className="btn btn-ghost btn-lg">
                  从错题补词 <ArrowRight size={15} />
                </Link>
              </div>
            </div>
          )}
        </div>

        <aside className="vocab-aside">
          <div className="card side-card">
            <span className="card-kicker">复习节奏</span>
            <h3>按遗忘曲线滚</h3>
            <div className="interval-line">
              {[1, 3, 7, 15, 30].map((d, i) => (
                <span key={d} className="interval-step">
                  <b>{d}</b><em>天</em>
                  {i < 4 && <i />}
                </span>
              ))}
            </div>
            <p className="muted small">认识就往后走一档；重来过的词只排到 1 天后，直到你真的记住。</p>
          </div>
          <div className="card side-card side-card-soft">
            <span className="card-kicker">使用建议</span>
            <ul className="tip-list">
              <li>午休 13:20 先过一轮单词卡。</li>
              <li>不从头背单词书，只背做错时遇到的词。</li>
              <li>12 月 7 日起停止加新词，只翻旧的。</li>
            </ul>
          </div>
        </aside>
      </div>

      <section className="card vocab-list-card">
        <div className="card-head">
          <div>
            <span className="card-kicker">全部单词</span>
            <h2>我的易错词</h2>
          </div>
          <div className="vocab-filters">
            <label className="search-box search-sm">
              <Search size={15} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜单词或释义" />
            </label>
            <div className="seg-control seg-sm">
              {[['all', '全部'], ['due', '到期'], ['learned', '已熟悉']].map(([key, label]) => (
                <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="inline-empty"><span className="spinner" /> 加载中…</div>
        ) : filtered.length ? (
          <div className="vocab-table">
            {filtered.map((v) => {
              const overdue = v.next_review <= todayISO()
              return (
                <div className="vocab-item" key={v.id}>
                  <div className="vocab-word-col">
                    <strong>{v.word}</strong>
                    <span>{[v.pos, v.phonetic].filter(Boolean).join(' · ')}</span>
                  </div>
                  <div className="vocab-meaning-col">
                    <p>{v.meaning || '（暂无释义）'}</p>
                    {v.forms && <span className="vocab-forms">变形：{v.forms}</span>}
                    {v.example && <span>{v.example}</span>}
                  </div>
                  <div className="vocab-meta-col">
                    <span className={`next-review ${overdue ? 'due' : ''}`}>
                      <CalendarClock size={13} /> {nextLabel(v.next_review)}
                    </span>
                    <span className="muted small">{v.source || ''}</span>
                  </div>
                  <div className="vocab-actions">
                    <button type="button" className="icon-btn" onClick={() => speak(v.word)} aria-label="朗读">
                      <Volume2 size={15} />
                    </button>
                    <button type="button" className="icon-btn danger" onClick={() => remove(v)} aria-label="删除">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={Languages}
            title={search || tab !== 'all' ? '没有符合条件的单词' : '词库还是空的'}
            desc={search || tab !== 'all' ? '换个筛选条件试试。' : '解析错题时勾选生词，或手动添加。'}
            action={
              !search && tab === 'all' ? (
                <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>添加第一个单词</button>
              ) : null
            }
          />
        )}
      </section>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="添加单词"
        subtitle="只加真正影响理解的词，不要凑数。"
        width={520}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)}>取消</button>
            <button type="button" className="btn btn-primary" onClick={addWord} disabled={saving}>{saving ? '添加中…' : '加入词库'}</button>
          </>
        }
      >
        <div className="two-col">
          <Field label="单词" required>
            <input className="input" value={form.word} onChange={(e) => setForm({ ...form, word: e.target.value })} placeholder="vital" autoFocus />
          </Field>
          <Field label="音标">
            <input className="input" value={form.phonetic} onChange={(e) => setForm({ ...form, phonetic: e.target.value })} placeholder="/ˈvaɪtl/" />
          </Field>
        </div>
        <Field label="中文释义" required>
          <input className="input" value={form.meaning} onChange={(e) => setForm({ ...form, meaning: e.target.value })} placeholder="至关重要的" />
        </Field>
        <div className="two-col">
          <Field label="词性">
            <input className="input" value={form.pos} onChange={(e) => setForm({ ...form, pos: e.target.value })} placeholder="n. / v. / adj." />
          </Field>
          <Field label="词形变化 / 派生">
            <input className="input" value={form.forms} onChange={(e) => setForm({ ...form, forms: e.target.value })} placeholder="varies；varied；variety" />
          </Field>
        </div>
        <Field label="例句">
          <textarea className="input" rows={3} value={form.example} onChange={(e) => setForm({ ...form, example: e.target.value })} placeholder="Reading is vital for passing CET-4." />
        </Field>
      </Modal>

      <Modal
        open={photoOpen}
        onClose={closePhoto}
        title="拍照收词"
        subtitle="粉色荧光笔的词抄全部中文；蓝笔只抄线覆盖到的字，没划到的释义不算；红笔、印刷线、没标记的不收。"
        width={780}
        footer={
          photoWords.length ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={closePhoto}>关闭</button>
              <button type="button" className="btn btn-ghost" onClick={analyzePhoto} disabled={photoBusy || photoSaving}>
                重新识别
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={savePhotoWords}
                disabled={photoSaving || !selectedPhotoCount}
              >
                {photoSaving ? '加入中…' : `加入单词本（${selectedPhotoCount}）`}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={closePhoto}>取消</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={analyzePhoto}
                disabled={photoBusy || !photoFiles.length}
              >
                {photoBusy ? '识别中…' : '开始识别'}
              </button>
            </>
          )
        }
      >
        <div className="vocab-photo-rules">
          <span><i className="rule-dot highlight" /> 荧光笔：词 + 全部中文</span>
          <span><i className="rule-dot blue" /> 蓝笔划线：只抄线划到的中文</span>
          <span className="muted">红笔 / 印刷线 / 没标记：忽略</span>
        </div>

        {photoFiles.length ? (
          <div className="photo-grid vocab-photo-grid">
            {photoFiles.map((p, index) => (
              <div className="photo-thumb" key={p.url}>
                <a href={p.url} target="_blank" rel="noreferrer" className="photo-thumb-link" title="查看大图">
                  <img src={p.url} alt={`单词照片 ${index + 1}`} />
                </a>
                <span className="photo-index">{index + 1}</span>
                <button
                  type="button"
                  className="photo-remove"
                  onClick={() => removePhotoFile(p.url)}
                  aria-label={`移除第 ${index + 1} 张图片`}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            {photoFiles.length < 6 && (
              <button type="button" className="photo-add" onClick={() => photoInputRef.current?.click()}>
                <Plus size={20} />
                <span>继续添加</span>
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="dropzone vocab-photo-drop"
            onClick={() => photoInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              addPhotoFiles(e.dataTransfer.files)
            }}
          >
            <span className="dropzone-icon"><Upload size={24} /></span>
            <strong>点击或拖拽上传单词照片（1-6 张）</strong>
            <span>单词书、单词卡、笔记页都可以；拍正、拍清楚中文</span>
          </button>
        )}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => {
            addPhotoFiles(e.target.files)
            e.target.value = ''
          }}
        />

        {photoBusy ? (
          <div className="inline-empty"><span className="spinner" /> 正在逐块扫描卡片、找粉色词和蓝线，约 2-4 分钟，请别关页面…</div>
        ) : photoWords.length > 0 ? (
          <div className="vocab-photo-results">
            <div className="vocab-photo-head">
              <div>
                <span className="card-kicker">识别结果</span>
                <h3>{photoWords.length} 个词，已选 {selectedPhotoCount} 个</h3>
              </div>
              <button type="button" className="text-btn" onClick={toggleAllPhotoWords}>
                {selectedPhotoCount === photoWords.length ? '取消全选' : '全选'}
              </button>
            </div>
            {photoWords.map((v, i) => (
              <div className={`vocab-photo-row ${photoSelected[i] ? '' : 'off'}`} key={`${v.word}-${i}`}>
                <label className="check-label">
                  <input type="checkbox" checked={Boolean(photoSelected[i])} onChange={() => togglePhotoWord(i)} />
                  <span />
                </label>
                <input className="input photo-word" value={v.word} onChange={(e) => updatePhotoWord(i, { word: e.target.value })} />
                <input className="input photo-meaning" value={v.meaning} onChange={(e) => updatePhotoWord(i, { meaning: e.target.value })} />
                <div className="photo-meta">
                  <input
                    className="input photo-pos"
                    value={v.pos || ''}
                    onChange={(e) => updatePhotoWord(i, { pos: e.target.value })}
                    placeholder="词性 n./v."
                  />
                  <input
                    className="input photo-forms"
                    value={v.forms || ''}
                    onChange={(e) => updatePhotoWord(i, { forms: e.target.value })}
                    placeholder="变形：varies；varied；variety"
                  />
                </div>
                <span className={`vocab-mark ${v.mark}`}>{v.mark === 'blue-underline' ? '蓝笔划线' : '荧光笔'}</span>
                <button type="button" className="icon-btn danger" onClick={() => removePhotoWord(i)} aria-label="移除">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : photoFiles.length ? (
          <p className="form-note">识别规则：粉色荧光笔的词抄全部中文；蓝笔只抄线覆盖到的字；红笔和印刷线不算。</p>
        ) : null}
      </Modal>
    </div>
  )
}