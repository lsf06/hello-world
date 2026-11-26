import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import {
  db,
  rootDir,
  uploadsDir,
  getSettings,
  getPublicSettings,
  setSetting,
  isoDateLocal,
  addDaysISO,
  mapQuestion,
  mapWriting,
  mapSession,
  upsertVocab,
  upsertVocabDetailed,
} from './db.js'
import { analyzeQuestion, explainMistake, extractMarkedVocab, extractVocabPhoto, gradeWork, testConnection, listModels, normalizeAnswerLetter, AIError } from './ai.js'

const app = express()
const PORT = Number(process.env.PORT || 5174)

app.use(cors())
app.use(express.json({ limit: '25mb' }))
app.use('/uploads', express.static(uploadsDir))

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const extByMime = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }
    const ext = extByMime[file.mimetype] || '.jpg'
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    cb(null, name)
  },
})
const imageFilter = (_req, file, cb) => {
  if (!/^image\/(jpeg|jpg|png|webp)$/.test(file.mimetype)) {
    return cb(new Error('只支持 JPG / PNG / WEBP 图片'))
  }
  cb(null, true)
}
const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024, files: 12 },
  fileFilter: imageFilter,
})
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 12 },
  fileFilter: imageFilter,
})

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

function imageToDataURL(file) {
  if (!file) return null
  const buf = fs.readFileSync(file.path)
  return `data:${file.mimetype};base64,${buf.toString('base64')}`
}

function uploadPath(file) {
  return file ? `/uploads/${file.filename}` : ''
}

function pathToDataURL(imagePath) {
  if (!imagePath) return null
  const file = path.join(uploadsDir, path.basename(imagePath))
  if (!fs.existsSync(file)) return null
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(file).toLowerCase()]
  if (!mime) return null
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
}

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

const EDITABLE_SETTINGS = new Set([
  'exam_date',
  'target_total',
  'target_writing',
  'target_listening',
  'target_reading',
  'target_translation',
  'tolerance',
  'ai_base_url',
  'ai_api_key',
  'ai_text_model',
  'ai_vision_model',
  'auto_vocab',
])

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }))

app.get('/api/settings', (_req, res) => {
  res.json(getPublicSettings())
})

app.put('/api/settings', (req, res) => {
  const body = req.body || {}
  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE_SETTINGS.has(key)) continue
    if (key === 'ai_api_key') {
      if (body.clear_ai_key) setSetting(key, '')
      else if (String(value || '').trim()) setSetting(key, String(value).trim())
      continue
    }
    setSetting(key, value)
  }
  res.json(getPublicSettings())
})

app.post('/api/settings/test-ai', asyncHandler(async (req, res) => {
  const b = req.body || {}
  const result = await testConnection({
    baseUrl: b.baseUrl,
    apiKey: b.apiKey,
    textModel: b.textModel,
  })
  res.json(result)
}))

app.post('/api/settings/ai-models', asyncHandler(async (req, res) => {
  const b = req.body || {}
  const result = await listModels({
    baseUrl: b.baseUrl,
    apiKey: b.apiKey,
  })
  res.json(result)
}))

/* ------------------------------------------------------------------ */
/* plan & checkins                                                     */
/* ------------------------------------------------------------------ */

function loadPlan() {
  const days = db.prepare('SELECT * FROM plan_days ORDER BY date').all().map((d) => {
    const tasks = JSON.parse(d.tasks || '[]')
    const progress = db.prepare('SELECT task_index, done FROM plan_progress WHERE date = ?').all(d.date)
    const doneSet = new Set(progress.filter((p) => p.done).map((p) => p.task_index))
    const mappedTasks = tasks.map((t, i) => ({ ...t, done: doneSet.has(i) }))
    return {
      date: d.date,
      weekday: d.weekday,
      phase: d.phase,
      theme: d.theme,
      kpi: d.kpi,
      reminder: d.reminder,
      is_exam: Boolean(d.is_exam),
      tasks: mappedTasks,
      done_count: mappedTasks.filter((t) => t.done).length,
      task_count: mappedTasks.length,
    }
  })
  const totalTasks = days.reduce((s, d) => s + d.task_count, 0)
  const doneTasks = days.reduce((s, d) => s + d.done_count, 0)
  const completedDays = days.filter((d) => d.task_count > 0 && d.done_count === d.task_count).length
  return {
    days,
    stats: {
      total_days: days.length,
      completed_days: completedDays,
      total_tasks: totalTasks,
      done_tasks: doneTasks,
      completion: totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0,
    },
  }
}

app.get('/api/plan', (_req, res) => res.json(loadPlan()))

app.post('/api/plan/toggle', (req, res) => {
  const { date, index, done } = req.body || {}
  if (!date || index === undefined) return res.status(400).json({ error: '缺少 date 或 index' })
  db.prepare(
    'INSERT INTO plan_progress (date, task_index, done) VALUES (?, ?, ?) ON CONFLICT(date, task_index) DO UPDATE SET done = excluded.done',
  ).run(String(date), Number(index), done ? 1 : 0)
  if (done) {
    db.prepare('INSERT OR IGNORE INTO checkins (date, note, created_at) VALUES (?, ?, ?)').run(
      String(date),
      '',
      new Date().toISOString(),
    )
  }
  res.json({ ok: true })
})

function computeStreak() {
  const activity = new Set()
  for (const r of db.prepare('SELECT DISTINCT date FROM plan_progress WHERE done = 1').all()) activity.add(r.date)
  for (const r of db.prepare('SELECT date FROM checkins').all()) activity.add(r.date)
  const today = isoDateLocal()
  let cursor = today
  let streak = 0
  if (!activity.has(cursor)) cursor = addDaysISO(cursor, -1)
  while (activity.has(cursor)) {
    streak += 1
    cursor = addDaysISO(cursor, -1)
  }
  return { streak, today_done: activity.has(today) }
}

app.get('/api/checkins', (_req, res) => {
  const rows = db.prepare('SELECT * FROM checkins ORDER BY date DESC').all()
  res.json({ checkins: rows, ...computeStreak() })
})

app.post('/api/checkins', (req, res) => {
  const date = req.body?.date || isoDateLocal()
  const note = String(req.body?.note || '')
  db.prepare(
    'INSERT INTO checkins (date, note, created_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET note = excluded.note',
  ).run(date, note, new Date().toISOString())
  res.json({ ok: true, date, ...computeStreak() })
})

/* ------------------------------------------------------------------ */
/* questions                                                           */
/* ------------------------------------------------------------------ */

app.get('/api/questions', (req, res) => {
  const { section, tag, mastered, q, limit } = req.query
  const clauses = []
  const params = []
  if (section) {
    clauses.push('section = ?')
    params.push(section)
  }
  if (tag) {
    clauses.push('error_tags LIKE ?')
    params.push(`%${tag}%`)
  }
  if (mastered === '1') clauses.push('mastered = 1')
  if (mastered === '0') clauses.push('mastered = 0')
  if (q) {
    clauses.push('(question_text LIKE ? OR context LIKE ? OR note LIKE ? OR analysis LIKE ?)')
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const lim = Math.min(Number(limit) || 300, 500)
  const rows = db.prepare(`SELECT * FROM questions ${where} ORDER BY created_at DESC LIMIT ${lim}`).all(...params)
  const total = db.prepare(`SELECT COUNT(*) AS n FROM questions ${where}`).get(...params).n
  res.json({ questions: rows.map(mapQuestion), total })
})

app.post('/api/questions', (req, res) => {
  const b = req.body || {}
  if (!b.question_text && !(b.options || []).length) {
    return res.status(400).json({ error: '题目内容不能为空' })
  }
  const myAnswer = normalizeAnswerLetter(b.my_answer)
  const correctAnswer = normalizeAnswerLetter(b.correct_answer)
  if (myAnswer) b.my_answer = myAnswer
  if (correctAnswer) b.correct_answer = correctAnswer
  if (myAnswer && correctAnswer) b.is_correct = myAnswer === correctAnswer
  const createdAt = new Date().toISOString()
  const info = db
    .prepare(
      `INSERT INTO questions
      (section, subtype, source, question_text, context, options, my_answer, correct_answer, is_correct,
       analysis, translation, why_wrong, how_to_fix, answer_basis, key_sentences, vocab, error_tags, image_path, image_paths, ai_raw, note, mastered, review_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      b.section || '其他',
      b.subtype || '',
      b.source || '拍照解析',
      b.question_text || '',
      b.context || '',
      JSON.stringify(b.options || []),
      b.my_answer || '',
      b.correct_answer || '',
      b.is_correct === null || b.is_correct === undefined ? null : b.is_correct ? 1 : 0,
      b.analysis || '',
      b.translation || '',
      b.why_wrong || '',
      b.how_to_fix || '',
      b.answer_basis || '',
      JSON.stringify(b.key_sentences || []),
      JSON.stringify(b.vocab || []),
      JSON.stringify(b.error_tags || []),
      b.image_path || '',
      JSON.stringify(Array.isArray(b.image_paths) ? b.image_paths.filter(Boolean) : []),
      b.ai_raw ? JSON.stringify(b.ai_raw) : '',
      b.note || '',
      b.mastered ? 1 : 0,
      0,
      createdAt,
    )
  const id = Number(info.lastInsertRowid)
  const autoVocab = getSettings().auto_vocab !== '0' && b.source === '手动录题'
  if (autoVocab && Array.isArray(b.vocab)) {
    for (const v of b.vocab) upsertVocab(v, `错题 #${id}`)
  }
  res.json(mapQuestion(db.prepare('SELECT * FROM questions WHERE id = ?').get(id)))
})

app.patch('/api/questions/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing = db.prepare('SELECT * FROM questions WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: '错题不存在' })
  const b = { ...(req.body || {}) }
  const myAnswer = normalizeAnswerLetter('my_answer' in b ? b.my_answer : existing.my_answer)
  const correctAnswer = normalizeAnswerLetter('correct_answer' in b ? b.correct_answer : existing.correct_answer)
  if ('my_answer' in b || 'correct_answer' in b) {
    b.my_answer = myAnswer
    b.correct_answer = correctAnswer
    b.is_correct = myAnswer && correctAnswer ? myAnswer === correctAnswer : null
  }
  const fields = []
  const params = []
  const jsonFields = ['options', 'key_sentences', 'vocab', 'error_tags']
  for (const key of ['section', 'subtype', 'question_text', 'context', 'my_answer', 'correct_answer', 'analysis', 'translation', 'why_wrong', 'how_to_fix', 'answer_basis', 'note', 'mastered', 'is_correct']) {
    if (key in b) {
      fields.push(`${key} = ?`)
      params.push(key === 'mastered' ? (b[key] ? 1 : 0) : key === 'is_correct' ? (b[key] === null ? null : b[key] ? 1 : 0) : b[key])
    }
  }
  for (const key of jsonFields) {
    if (key in b) {
      fields.push(`${key} = ?`)
      params.push(JSON.stringify(b[key]))
    }
  }
  if (!fields.length) return res.json(mapQuestion(existing))
  params.push(id)
  db.prepare(`UPDATE questions SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  res.json(mapQuestion(db.prepare('SELECT * FROM questions WHERE id = ?').get(id)))
})

app.post('/api/questions/:id/review', (req, res) => {
  const id = Number(req.params.id)
  const existing = db.prepare('SELECT * FROM questions WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: '错题不存在' })
  const mastered = req.body?.mastered
  db.prepare('UPDATE questions SET review_count = review_count + 1, mastered = COALESCE(?, mastered) WHERE id = ?').run(
    mastered === undefined ? null : mastered ? 1 : 0,
    id,
  )
  res.json(mapQuestion(db.prepare('SELECT * FROM questions WHERE id = ?').get(id)))
})

app.post('/api/questions/:id/vocab', (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: '错题不存在' })
  const vocab = JSON.parse(row.vocab || '[]')
  let added = 0
  for (const v of vocab) {
    if (upsertVocab(v, `错题 #${id}`)) added += 1
  }
  res.json({ ok: true, added })
})

app.post('/api/questions/:id/extract-vocab', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: '错题不存在' })
  const stored = JSON.parse(row.image_paths || '[]')
  const imagePaths = stored.length ? stored : row.image_path ? [row.image_path] : []
  const imagesBase64 = imagePaths.map(pathToDataURL).filter(Boolean)
  if (!imagesBase64.length) return res.status(400).json({ error: '这道题没有保存原图，无法提取标记词' })
  const result = await extractMarkedVocab({ imagesBase64 })
  for (const v of result.marked_vocab) upsertVocab(v, `错题 #${id}`)
  res.json({ ok: true, marked_vocab: result.marked_vocab, added: result.marked_vocab.length })
}))

app.delete('/api/questions/:id', (req, res) => {
  db.prepare('DELETE FROM questions WHERE id = ?').run(Number(req.params.id))
  res.json({ ok: true })
})

/* ------------------------------------------------------------------ */
/* writings                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/writings', (req, res) => {
  const kind = req.query.kind
  const rows = kind
    ? db.prepare('SELECT * FROM writings WHERE kind = ? ORDER BY created_at DESC LIMIT 100').all(kind)
    : db.prepare('SELECT * FROM writings ORDER BY created_at DESC LIMIT 100').all()
  res.json({ writings: rows.map(mapWriting) })
})

app.get('/api/writings/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM writings WHERE id = ?').get(Number(req.params.id))
  if (!row) return res.status(404).json({ error: '记录不存在' })
  res.json(mapWriting(row))
})

app.delete('/api/writings/:id', (req, res) => {
  db.prepare('DELETE FROM writings WHERE id = ?').run(Number(req.params.id))
  res.json({ ok: true })
})

/* ------------------------------------------------------------------ */
/* AI: analyze / grade                                                 */
/* ------------------------------------------------------------------ */

app.post('/api/ai/analyze-question', upload.array('images', 12), asyncHandler(async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : []
  const imagesBase64 = files.map(imageToDataURL).filter(Boolean)
  const text = String(req.body?.text || '').trim()
  if (!imagesBase64.length && !text) return res.status(400).json({ error: '请上传题目图片或粘贴题目文字' })
  const result = await analyzeQuestion({
    imagesBase64,
    text,
    section: String(req.body?.section || '自动判断'),
  })
  const imagePaths = files.map(uploadPath).filter(Boolean)
  res.json({ ...result, image_paths: imagePaths, image_path: imagePaths[0] || '' })
}))

app.post('/api/ai/explain-mistake', asyncHandler(async (req, res) => {
  const question = req.body?.question || {}
  const passageText = String(req.body?.passage_text || '')
  const result = await explainMistake({ question, passageText })
  res.json(result)
}))

app.post('/api/ai/extract-vocab-photo', memoryUpload.array('images', 12), asyncHandler(async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : []
  const imagesBase64 = files.map((file) => `data:${file.mimetype};base64,${file.buffer.toString('base64')}`)
  if (!imagesBase64.length) return res.status(400).json({ error: '请上传单词照片' })
  const result = await extractVocabPhoto({ imagesBase64 })
  res.json(result)
}))

app.post('/api/ai/grade', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'reference_images', maxCount: 4 },
]), asyncHandler(async (req, res) => {
  const kind = req.body?.kind === 'translation' ? 'translation' : 'writing'
  const content = String(req.body?.content || '').trim()
  const prompt = String(req.body?.prompt || '').trim()
  const referenceText = String(req.body?.reference_text || '').trim()
  const answerFile = req.files?.image?.[0]
  const referenceFiles = req.files?.reference_images || []
  const imageBase64 = imageToDataURL(answerFile)
  const referenceImages = referenceFiles.map(imageToDataURL).filter(Boolean)
  if (!content && !imageBase64) return res.status(400).json({ error: '请粘贴作文/译文，或上传手写照片' })
  const result = await gradeWork({ kind, prompt, content, imageBase64, referenceText, referenceImages })
  const info = db
    .prepare(
      `INSERT INTO writings
      (kind, prompt, content, image_path, score15, score106, band, overall, dimensions, comparison, strengths, improvements,
       errors, corrected_text, reference_text, key_expressions, memorize, reference_image_paths, upgraded_sentences,
       estimated_target, raw, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      kind,
      prompt,
      content || '（图片提交）',
      uploadPath(answerFile),
      result.score15,
      result.score106,
      result.band,
      result.overall,
      JSON.stringify(result.dimensions),
      JSON.stringify(result.comparison),
      JSON.stringify(result.strengths),
      JSON.stringify(result.improvements),
      JSON.stringify(result.errors),
      result.corrected_text,
      result.reference_text,
      JSON.stringify(result.key_expressions),
      JSON.stringify(result.memorize),
      JSON.stringify(referenceFiles.map(uploadPath).filter(Boolean)),
      JSON.stringify(result.upgraded_sentences),
      result.estimated_target,
      result.raw || '',
      new Date().toISOString(),
    )
  const saved = db.prepare('SELECT * FROM writings WHERE id = ?').get(Number(info.lastInsertRowid))
  res.json(mapWriting(saved))
}))

/* ------------------------------------------------------------------ */
/* vocab                                                               */
/* ------------------------------------------------------------------ */

app.get('/api/vocab', (req, res) => {
  const { due, q } = req.query
  const today = isoDateLocal()
  let rows
  if (due === '1') {
    rows = db.prepare('SELECT * FROM vocab WHERE next_review <= ? ORDER BY next_review ASC, id DESC').all(today)
  } else if (q) {
    rows = db
      .prepare('SELECT * FROM vocab WHERE word LIKE ? OR meaning LIKE ? ORDER BY id DESC LIMIT 500')
      .all(`%${q}%`, `%${q}%`)
  } else {
    rows = db.prepare('SELECT * FROM vocab ORDER BY id DESC LIMIT 500').all()
  }
  const total = db.prepare('SELECT COUNT(*) AS n FROM vocab').get().n
  const dueCount = db.prepare('SELECT COUNT(*) AS n FROM vocab WHERE next_review <= ?').get(today).n
  const learned = db.prepare('SELECT COUNT(*) AS n FROM vocab WHERE times_reviewed >= 3').get().n
  res.json({ vocab: rows, stats: { total, due: dueCount, learned, today } })
})

app.post('/api/vocab', (req, res) => {
  const b = req.body || {}
  if (!String(b.word || '').trim()) return res.status(400).json({ error: '单词不能为空' })
  const id = upsertVocab(b, b.source || '手动添加')
  res.json(db.prepare('SELECT * FROM vocab WHERE id = ?').get(id))
})

app.post('/api/vocab/bulk', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  let added = 0
  let updated = 0
  let skipped = 0
  for (const item of items) {
    const result = upsertVocabDetailed(item, req.body?.source || '批量添加')
    if (!result) continue
    if (result.created) added += 1
    else if (result.addedMeanings > 0) updated += 1
    else skipped += 1
  }
  res.json({ ok: true, added, updated, skipped })
})

app.patch('/api/vocab/:id', (req, res) => {
  const id = Number(req.params.id)
  const b = req.body || {}
  const fields = []
  const params = []
  for (const key of ['word', 'phonetic', 'meaning', 'example', 'pos', 'forms', 'source']) {
    if (key in b) {
      fields.push(`${key} = ?`)
      params.push(b[key])
    }
  }
  if (!fields.length) return res.json(db.prepare('SELECT * FROM vocab WHERE id = ?').get(id))
  params.push(id)
  db.prepare(`UPDATE vocab SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  res.json(db.prepare('SELECT * FROM vocab WHERE id = ?').get(id))
})

app.post('/api/vocab/:id/review', (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM vocab WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: '单词不存在' })
  const intervals = [1, 3, 7, 15, 30]
  const known = Boolean(req.body?.known)
  const lapsed = Boolean(req.body?.lapsed)
  let idx = row.interval_index || 0
  idx = known && !lapsed ? Math.min(idx + 1, intervals.length - 1) : 0
  const days = known ? intervals[idx] : 1
  const next = addDaysISO(isoDateLocal(), days)
  db.prepare(
    'UPDATE vocab SET interval_index = ?, next_review = ?, times_reviewed = times_reviewed + 1 WHERE id = ?',
  ).run(idx, next, id)
  res.json({ ...db.prepare('SELECT * FROM vocab WHERE id = ?').get(id), next_review_in: days })
})

app.delete('/api/vocab/:id', (req, res) => {
  db.prepare('DELETE FROM vocab WHERE id = ?').run(Number(req.params.id))
  res.json({ ok: true })
})

/* ------------------------------------------------------------------ */
/* sessions                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/sessions', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 200)
  const rows = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?').all(limit)
  res.json({ sessions: rows.map(mapSession) })
})

app.post('/api/sessions', (req, res) => {
  const b = req.body || {}
  const info = db
    .prepare(
      `INSERT INTO sessions
      (section, subtype, mode, planned_seconds, actual_seconds, tolerance, correct_count, total_count, note, meta, started_at, ended_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      b.section || '综合',
      b.subtype || '',
      b.mode || 'focus',
      Number(b.planned_seconds) || 0,
      Number(b.actual_seconds) || 0,
      Number(b.tolerance) || 100,
      b.correct_count === null || b.correct_count === undefined || b.correct_count === '' ? null : Number(b.correct_count),
      b.total_count === null || b.total_count === undefined || b.total_count === '' ? null : Number(b.total_count),
      b.note || '',
      JSON.stringify(b.meta || null),
      b.started_at || '',
      b.ended_at || new Date().toISOString(),
      new Date().toISOString(),
    )
  res.json(mapSession(db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(info.lastInsertRowid))))
})

app.delete('/api/sessions/:id', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(Number(req.params.id))
  res.json({ ok: true })
})

/* ------------------------------------------------------------------ */
/* mocks                                                               */
/* ------------------------------------------------------------------ */

function computeMock(b) {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0))
  const news = clamp(b.news, 0, 7)
  const conversation = clamp(b.conversation, 0, 8)
  const passage = clamp(b.passage, 0, 10)
  const cloze = clamp(b.cloze, 0, 10)
  const matchCount = clamp(b.match_count, 0, 10)
  const careful = clamp(b.careful, 0, 10)
  const writing = clamp(b.writing, 0, 106.5)
  const translation = clamp(b.translation, 0, 106.5)
  const listening = Math.round((news * 7.1 + conversation * 7.1 + passage * 14.2) * 10) / 10
  const reading = Math.round((cloze * 3.55 + matchCount * 7.1 + careful * 14.2) * 10) / 10
  const total = Math.round((listening + reading + writing + translation) * 10) / 10
  const target = Number(getSettings().target_total) || 480
  return {
    news,
    conversation,
    passage,
    cloze,
    match_count: matchCount,
    careful,
    writing,
    translation,
    listening_score: listening,
    reading_score: reading,
    total,
    gap: Math.round((target - total) * 10) / 10,
  }
}

app.get('/api/mocks', (_req, res) => {
  const rows = db.prepare('SELECT * FROM mocks ORDER BY date ASC, id ASC').all()
  res.json({ mocks: rows })
})

app.post('/api/mocks', (req, res) => {
  const b = req.body || {}
  const c = computeMock(b)
  const date = b.date || isoDateLocal()
  const name = b.name || `${date} 模考`
  const info = db
    .prepare(
      `INSERT INTO mocks
      (name, date, news, conversation, passage, cloze, match_count, careful, writing, translation,
       listening_score, reading_score, total, gap, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name,
      date,
      c.news,
      c.conversation,
      c.passage,
      c.cloze,
      c.match_count,
      c.careful,
      c.writing,
      c.translation,
      c.listening_score,
      c.reading_score,
      c.total,
      c.gap,
      b.note || '',
      new Date().toISOString(),
    )
  res.json(db.prepare('SELECT * FROM mocks WHERE id = ?').get(Number(info.lastInsertRowid)))
})

app.delete('/api/mocks/:id', (req, res) => {
  db.prepare('DELETE FROM mocks WHERE id = ?').run(Number(req.params.id))
  res.json({ ok: true })
})

/* ------------------------------------------------------------------ */
/* analytics                                                           */
/* ------------------------------------------------------------------ */

const TAG_ADVICE = {
  定位错误: '仔细阅读先看题干划关键词，回原文定位答案句；每天 2 篇，10 分钟/篇。',
  同义替换未识别: '把错题里的同义替换整理进单词本，长篇匹配只练关键词对应。',
  词汇不认识: '先清今天的到期单词；错题生词已经自动进词库，按 1/3/7/15 天滚动。',
  长难句看不懂: '每天拆 5 句：找谓语→划主干→标从句，不逐词翻译。',
  绝对化选项误选: '选项里出现 must / only / never / all 先警惕，原文没说的不选。',
  过度推断: '严格遵守“原文没说的不选”，答案必须能在定位句或前后一句找到依据。',
  时间不够: '用计时器先跑 110% 时长，再收紧到 100%；阅读固定 20/12/8 分钟。',
  粗心: '做完留 2 分钟专查拼写、单复数、主谓一致。',
  听音辨词错误: '听力五步法精听：听不清的句子反复 3-5 遍，再跟读 3 遍。',
  '连读/语速不适': '每天 1 组精听 + 跟读，重点抓 but / so / 最高级后面的答案句。',
  干扰项误选: '对完答案后给每个错误选项写一句“错在哪”，比重复刷题有用。',
  '语法/词性': '选词填空先标词性再代入；写作翻译先保证主谓一致。',
  上下文逻辑: '关注 however / therefore / for example 等信号词，答案常在转折后。',
  主旨概括错误: '新闻重点听首句，篇章重点听开头和结尾；先定主旨再选细节。',
  主谓一致: '写完留 2 分钟逐句找主语和谓语，第三人称单数、时态保持一致。',
  时态: '动笔前先定时间线（过去/现在/将来），全文时态统一。',
  冠词: '可数名词单数前必须有 a/an/the；复数泛指不加 the。',
  单复数: '检查 every/each/one of 后的单复数，以及名词与谓语是否一致。',
  拼写: '把反复拼错的词加入单词本，考前只看自己的错词。',
  搭配: '只记高频固定搭配，不要临场直译中文搭配。',
  中式英语: '先写简单句（主谓宾），再补修饰；不会的词换简单同义词。',
  连接词单一: '准备 but / however / therefore / besides / as a result 五个连接词轮换。',
  句式单调: '每段至少用一次从句或非谓语，但不要硬堆长难句。',
  词汇重复: '把 important 换成 vital，help 换成 benefit，good 换成 beneficial。',
  要点遗漏: '翻译先圈每个信息点，逐点对应，宁可简单也不要漏。',
  字数不足: '作文写满 120 词：开头 2 句 + 两个理由各 2 句 + 结尾 2 句。',
  跑题: '开头和结尾各点一次题目关键词，确保不跑题。',
  漏译: '翻译前先给中文分段，每段至少一个英文句子。',
  词性误用: '翻译时先确定词性（名词/动词/形容词），再选词。',
  句子结构: '长句拆成 2-3 个简单句，保证每句都有主谓。',
}

function latestMock() {
  return db.prepare('SELECT * FROM mocks ORDER BY date DESC, id DESC LIMIT 1').get()
}

function estimateScores() {
  const settings = getSettings()
  const targets = {
    listening: Number(settings.target_listening) || 165,
    reading: Number(settings.target_reading) || 165,
    writing: Number(settings.target_writing) || 80,
    translation: Number(settings.target_translation) || 70,
  }
  const mock = latestMock()
  const out = {}
  if (mock) {
    out.listening = { value: mock.listening_score, max: 248.5, target: targets.listening, source: `模考 ${mock.date}`, tested: true }
    out.reading = { value: mock.reading_score, max: 248.5, target: targets.reading, source: `模考 ${mock.date}`, tested: true }
    out.writing = { value: mock.writing, max: 106.5, target: targets.writing, source: `模考 ${mock.date}`, tested: true }
    out.translation = { value: mock.translation, max: 106.5, target: targets.translation, source: `模考 ${mock.date}`, tested: true }
  } else {
    for (const [section, max, target] of [
      ['listening', 248.5, targets.listening],
      ['reading', 248.5, targets.reading],
    ]) {
      const row = db
        .prepare(
          `SELECT SUM(correct_count) AS correct, SUM(total_count) AS total, MAX(created_at) AS last
           FROM sessions WHERE section = ? AND correct_count IS NOT NULL AND total_count > 0`,
        )
        .get(section)
      if (row && row.total) {
        out[section] = {
          value: Math.round((row.correct / row.total) * max * 10) / 10,
          max,
          target,
          source: '计时训练估算',
          tested: true,
        }
      } else {
        out[section] = { value: null, max, target, source: '暂无数据', tested: false }
      }
    }
    for (const [kind, max, target] of [
      ['writing', 106.5, targets.writing],
      ['translation', 106.5, targets.translation],
    ]) {
      const rows = db
        .prepare('SELECT score106 FROM writings WHERE kind = ? ORDER BY created_at DESC LIMIT 3')
        .all(kind)
      if (rows.length) {
        const avg = rows.reduce((s, r) => s + Number(r.score106 || 0), 0) / rows.length
        out[kind] = { value: Math.round(avg * 10) / 10, max, target, source: '最近批改均值', tested: true }
      } else {
        out[kind] = { value: null, max, target, source: '暂无数据', tested: false }
      }
    }
  }
  const total = Object.values(out).reduce((s, x) => s + (x.value || 0), 0)
  const testedAll = Object.values(out).some((x) => x.tested)
  return { sections: out, total: Math.round(total * 10) / 10, target: Number(settings.target_total) || 480, tested: testedAll }
}

function groupStats(rows, keyFn, options = {}) {
  const map = new Map()
  for (const row of rows) {
    const key = keyFn(row) || '其他'
    if (!map.has(key)) map.set(key, { key, total: 0, correct: 0, wrong: 0, unknown: 0, mastered: 0 })
    const g = map.get(key)
    g.total += 1
    if (row.is_correct === 1) g.correct += 1
    else if (row.is_correct === 0) g.wrong += 1
    else g.unknown += 1
    if (row.mastered) g.mastered += 1
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      accuracy: g.correct + g.wrong ? Math.round((g.correct / (g.correct + g.wrong)) * 100) : null,
    }))
    .sort((a, b) => (options.sortBy === 'accuracy' ? (a.accuracy ?? 101) - (b.accuracy ?? 101) : b.total - a.total))
}

function buildRecommendations({ bySection, bySubtype, errorTags, score, dueVocab, sessions }) {
  const recs = []
  const tag = errorTags[0]
  if (tag && tag.count >= 1) {
    recs.push({
      priority: 1,
      title: `错得最多：${tag.tag}（${tag.count} 次）`,
      reason: '这是你目前最稳定的失分来源，先改这一个。',
      action: TAG_ADVICE[tag.tag] || '把同类错题重做一遍，写清每题错因，再做 2 道同类新题验证。',
      link: '/wrong',
    })
  }
  const weakSection = bySection
    .filter((s) => s.accuracy !== null && s.correct + s.wrong >= 2)
    .sort((a, b) => (a.accuracy ?? 100) - (b.accuracy ?? 100))[0]
  if (weakSection && (!tag || weakSection.accuracy < 70)) {
    recs.push({
      priority: 2,
      title: `${weakSection.key} 正确率 ${weakSection.accuracy}%`,
      reason: `已记录 ${weakSection.total} 道，仍有 ${weakSection.wrong} 道错题。`,
      action: TAG_ADVICE[weakSection.key] || '先用计时器做一组专项，再按错因复盘。',
      link: '/wrong',
    })
  }
  if (dueVocab > 0) {
    recs.push({
      priority: 3,
      title: `今天有 ${dueVocab} 个单词到期`,
      reason: '单词是听力和阅读的共同瓶颈，先清到期卡。',
      action: '打开单词本，用过一遍“认识/不认识”决定下次复习时间。',
      link: '/vocab',
    })
  }
  if (score.tested && score.total < score.target) {
    recs.push({
      priority: 2,
      title: `估算 ${score.total} 分，离目标还差 ${Math.max(0, Math.round((score.target - score.total) * 10) / 10)} 分`,
      reason: '按当前四板块成绩折算，优先补离目标最远的板块。',
      action: '看学情分析里的板块差距，只补最弱一块，不要四块平均用力。',
      link: '/analytics',
    })
  }
  const overrun = sessions.find((s) => s.avg_actual > s.avg_planned * 1.1 && s.avg_planned > 0)
  if (overrun) {
    recs.push({
      priority: 4,
      title: `${overrun.section}平均超时 ${Math.round((overrun.avg_actual / overrun.avg_planned - 1) * 100)}%`,
      reason: '平时不限时，考场上会挤占其他板块。',
      action: '下一次先用 110% 时长，做完整套后收回到 100%。',
      link: '/timer',
    })
  }
  if (!recs.length) {
    recs.push({
      priority: 1,
      title: '先建立第一条错题记录',
      reason: '有了错题数据，系统才能告诉你该补哪里。',
      action: '拍照上传一道刚做错的题，或手动录入，标签会自动进入分析。',
      link: '/capture',
    })
  }
  return recs.slice(0, 4)
}

function buildAnalytics() {
  const questions = db.prepare('SELECT * FROM questions ORDER BY created_at DESC').all().map(mapQuestion)
  const writings = db.prepare('SELECT * FROM writings ORDER BY created_at DESC').all().map(mapWriting)
  const sessionsRaw = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all()
  const mocks = db.prepare('SELECT * FROM mocks ORDER BY date ASC, id ASC').all()
  const settings = getSettings()
  const today = isoDateLocal()

  const answered = questions.filter((q) => q.is_correct !== null)
  const correct = answered.filter((q) => q.is_correct === true).length
  const bySection = groupStats(questions, (q) => q.section)
  const bySubtype = groupStats(questions, (q) => q.subtype || q.section, { sortBy: 'accuracy' })

  const tagMap = new Map()
  for (const q of questions) {
    for (const t of q.error_tags || []) tagMap.set(t, (tagMap.get(t) || 0) + 1)
  }
  for (const w of writings) {
    for (const e of w.errors || []) {
      const t = e.type || '其他'
      tagMap.set(t, (tagMap.get(t) || 0) + 1)
    }
  }
  const errorTags = [...tagMap.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)

  const days = []
  for (let i = 13; i >= 0; i -= 1) {
    const date = addDaysISO(today, -i)
    const qAdded = questions.filter((q) => (q.created_at || '').slice(0, 10) === date)
    const doneTasks = db.prepare('SELECT COUNT(*) AS n FROM plan_progress WHERE date = ? AND done = 1').get(date).n
    const minutes = sessionsRaw
      .filter((s) => (s.created_at || '').slice(0, 10) === date)
      .reduce((sum, s) => sum + Math.round((s.actual_seconds || 0) / 60), 0)
    days.push({
      date,
      label: date.slice(5),
      added: qAdded.length,
      wrong: qAdded.filter((q) => q.is_correct === false).length,
      minutes,
      tasks: doneTasks,
    })
  }

  const sessionMap = new Map()
  for (const s of sessionsRaw) {
    const key = s.section || '综合'
    if (!sessionMap.has(key)) sessionMap.set(key, { section: key, count: 0, seconds: 0, planned: 0, correct: 0, total: 0 })
    const g = sessionMap.get(key)
    g.count += 1
    g.seconds += s.actual_seconds || 0
    g.planned += s.planned_seconds || 0
    if (s.correct_count !== null && s.total_count) {
      g.correct += s.correct_count
      g.total += s.total_count
    }
  }
  const sessionStats = [...sessionMap.values()].map((g) => ({
    section: g.section,
    count: g.count,
    avg_actual: g.count ? Math.round(g.seconds / g.count) : 0,
    avg_planned: g.count ? Math.round(g.planned / g.count) : 0,
    accuracy: g.total ? Math.round((g.correct / g.total) * 100) : null,
  }))

  const writingErrorsMap = new Map()
  const translationErrorsMap = new Map()
  for (const w of writings) {
    const target = w.kind === 'translation' ? translationErrorsMap : writingErrorsMap
    for (const e of w.errors || []) {
      const t = e.type || '其他'
      target.set(t, (target.get(t) || 0) + 1)
    }
  }
  const toArr = (m) =>
    [...m.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count)

  const writingRecords = writings.filter((w) => w.kind === 'writing')
  const translationRecords = writings.filter((w) => w.kind === 'translation')
  const avg = (arr, key) => (arr.length ? Math.round((arr.reduce((s, x) => s + Number(x[key] || 0), 0) / arr.length) * 10) / 10 : null)

  const dueVocab = db.prepare('SELECT COUNT(*) AS n FROM vocab WHERE next_review <= ?').get(today).n
  const vocabTotal = db.prepare('SELECT COUNT(*) AS n FROM vocab').get().n
  const score = estimateScores()

  const recommendations = buildRecommendations({
    bySection,
    bySubtype,
    errorTags,
    score,
    dueVocab,
    sessions: sessionStats,
  })

  return {
    overview: {
      questions: questions.length,
      answered: answered.length,
      correct,
      accuracy: answered.length ? Math.round((correct / answered.length) * 100) : null,
      wrong: questions.filter((q) => q.is_correct !== true).length,
      mastered: questions.filter((q) => q.mastered).length,
      writing_count: writingRecords.length,
      translation_count: translationRecords.length,
      writing_avg: avg(writingRecords, 'score106'),
      translation_avg: avg(translationRecords, 'score106'),
      total_minutes: Math.round(sessionsRaw.reduce((s, x) => s + (x.actual_seconds || 0), 0) / 60),
      vocab_total: vocabTotal,
      vocab_due: dueVocab,
      target: Number(settings.target_total) || 480,
    },
    bySection,
    bySubtype,
    errorTags,
    daily: days,
    sessions: sessionStats,
    writingErrors: toArr(writingErrorsMap),
    translationErrors: toArr(translationErrorsMap),
    score,
    recommendations,
    mocks,
  }
}

app.get('/api/analytics', (_req, res) => res.json(buildAnalytics()))

/* ------------------------------------------------------------------ */
/* dashboard                                                           */
/* ------------------------------------------------------------------ */

app.get('/api/dashboard', (_req, res) => {
  const settings = getSettings()
  const examDate = settings.exam_date || '2026-12-12T09:00:00+08:00'
  const exam = new Date(examDate)
  const now = new Date()
  const msLeft = Math.max(0, exam.getTime() - now.getTime())
  const today = isoDateLocal()
  const plan = loadPlan()
  const todayPlan = plan.days.find((d) => d.date === today)
  const nextPlan = plan.days.find((d) => d.date >= today)
  const displayDay = todayPlan || nextPlan || null
  const analytics = buildAnalytics()
  const streak = computeStreak()
  const recentQuestions = db
    .prepare('SELECT * FROM questions ORDER BY created_at DESC LIMIT 3')
    .all()
    .map(mapQuestion)
  const recentWritings = db
    .prepare('SELECT * FROM writings ORDER BY created_at DESC LIMIT 2')
    .all()
    .map(mapWriting)
  const dueVocab = db.prepare('SELECT COUNT(*) AS n FROM vocab WHERE next_review <= ?').get(today).n
  const todayFocus = displayDay?.tasks?.[0]?.text || '先做一组听力五步法，保持耳朵在线。'

  res.json({
    exam: {
      date: examDate,
      target: Number(settings.target_total) || 480,
      days_left: Math.ceil(msLeft / 86400000),
      ms_left: msLeft,
      passed: msLeft <= 0,
    },
    today,
    plan: {
      day: displayDay,
      is_today: displayDay?.date === today,
      stats: plan.stats,
    },
    focus: analytics.recommendations[0],
    today_focus: todayFocus,
    score: analytics.score,
    overview: analytics.overview,
    streak,
    due_vocab: dueVocab,
    phase: displayDay?.phase || '',
    recent: { questions: recentQuestions, writings: recentWritings },
    daily: analytics.daily.slice(-7),
  })
})

/* ------------------------------------------------------------------ */
/* backup / reset                                                      */
/* ------------------------------------------------------------------ */

app.get('/api/export', (_req, res) => {
  const settings = getSettings()
  delete settings.ai_api_key
  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    settings,
    plan_progress: db.prepare('SELECT * FROM plan_progress').all(),
    questions: db.prepare('SELECT * FROM questions').all(),
    writings: db.prepare('SELECT * FROM writings').all(),
    vocab: db.prepare('SELECT * FROM vocab').all(),
    sessions: db.prepare('SELECT * FROM sessions').all(),
    mocks: db.prepare('SELECT * FROM mocks').all(),
    checkins: db.prepare('SELECT * FROM checkins').all(),
  }
  res.setHeader('Content-Disposition', `attachment; filename="cet4-backup-${isoDateLocal()}.json"`)
  res.json(payload)
})

app.post('/api/import', (req, res) => {
  const data = req.body || {}
  if (!data.version) return res.status(400).json({ error: '备份文件格式不正确' })
  try {
    db.exec('BEGIN')
    for (const table of ['plan_progress', 'questions', 'writings', 'vocab', 'sessions', 'mocks', 'checkins']) {
      db.exec(`DELETE FROM ${table}`)
    }
    if (data.settings) {
      for (const [k, v] of Object.entries(data.settings)) {
        if (k === 'ai_api_key') continue
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v))
      }
    }
    const insertRows = (table, rows) => {
      if (!Array.isArray(rows) || !rows.length) return
      const cols = Object.keys(rows[0])
      const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      for (const row of rows) stmt.run(...cols.map((c) => row[c]))
    }
    insertRows('plan_progress', data.plan_progress)
    insertRows('questions', data.questions)
    insertRows('writings', data.writings)
    insertRows('vocab', data.vocab)
    insertRows('sessions', data.sessions)
    insertRows('mocks', data.mocks)
    insertRows('checkins', data.checkins)
    db.exec('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    res.status(500).json({ error: `导入失败：${err.message}` })
  }
})

app.delete('/api/data', (req, res) => {
  const scope = req.query.scope || 'learning'
  if (scope === 'all') {
    for (const table of ['plan_progress', 'questions', 'writings', 'vocab', 'sessions', 'mocks', 'checkins']) {
      db.exec(`DELETE FROM ${table}`)
    }
  } else {
    for (const table of ['questions', 'writings', 'vocab', 'sessions', 'mocks']) db.exec(`DELETE FROM ${table}`)
  }
  res.json({ ok: true })
})

/* ------------------------------------------------------------------ */
/* static & errors                                                     */
/* ------------------------------------------------------------------ */

const distDir = path.join(rootDir, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use((err, _req, res, _next) => {
  const status = err.status || (err instanceof AIError ? err.status : 500)
  const message = err.message || '服务器错误'
  if (status >= 500) console.error(err)
  res.status(status).json({ error: message, code: err.code || 'SERVER_ERROR' })
})

const server = app.listen(PORT, () => {
  console.log(`[CET4] API server running at http://127.0.0.1:${PORT}`)
})
server.requestTimeout = 10 * 60 * 1000