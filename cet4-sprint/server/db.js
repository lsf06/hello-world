import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const rootDir = path.resolve(__dirname, '..')
export const dataDir = path.join(rootDir, 'data')
export const uploadsDir = path.join(dataDir, 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })

export const db = new DatabaseSync(path.join(dataDir, 'cet4.db'))
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plan_days (
  date TEXT PRIMARY KEY,
  weekday TEXT,
  phase TEXT,
  theme TEXT,
  kpi TEXT,
  reminder TEXT,
  tasks TEXT,
  is_exam INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS plan_progress (
  date TEXT NOT NULL,
  task_index INTEGER NOT NULL,
  done INTEGER DEFAULT 0,
  PRIMARY KEY (date, task_index)
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT,
  subtype TEXT,
  source TEXT,
  question_text TEXT,
  context TEXT,
  options TEXT,
  my_answer TEXT,
  correct_answer TEXT,
  is_correct INTEGER,
  analysis TEXT,
  translation TEXT,
  why_wrong TEXT,
  how_to_fix TEXT,
  key_sentences TEXT,
  vocab TEXT,
  error_tags TEXT,
  image_path TEXT,
  image_paths TEXT,
  ai_raw TEXT,
  note TEXT,
  mastered INTEGER DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS writings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  prompt TEXT,
  content TEXT,
  image_path TEXT,
  score15 REAL,
  score106 REAL,
  band TEXT,
  overall TEXT,
  dimensions TEXT,
  strengths TEXT,
  improvements TEXT,
  errors TEXT,
  corrected_text TEXT,
  reference_text TEXT,
  key_expressions TEXT,
  raw TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vocab (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL COLLATE NOCASE UNIQUE,
  phonetic TEXT,
  meaning TEXT,
  example TEXT,
  source TEXT,
  interval_index INTEGER DEFAULT 0,
  next_review TEXT,
  times_reviewed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT,
  subtype TEXT,
  mode TEXT,
  planned_seconds INTEGER,
  actual_seconds INTEGER,
  tolerance INTEGER,
  correct_count INTEGER,
  total_count INTEGER,
  note TEXT,
  meta TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  date TEXT,
  news INTEGER,
  conversation INTEGER,
  passage INTEGER,
  cloze INTEGER,
  match_count INTEGER,
  careful INTEGER,
  writing REAL,
  translation REAL,
  listening_score REAL,
  reading_score REAL,
  total REAL,
  gap REAL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checkins (
  date TEXT PRIMARY KEY,
  note TEXT,
  created_at TEXT NOT NULL
);
`)

const questionColumns = db.prepare('PRAGMA table_info(questions)').all().map((c) => c.name)
const addQuestionColumn = (name, type) => {
  if (!questionColumns.includes(name)) db.exec(`ALTER TABLE questions ADD COLUMN ${name} ${type}`)
}
addQuestionColumn('image_paths', 'TEXT')
addQuestionColumn('why_wrong', 'TEXT')
addQuestionColumn('how_to_fix', 'TEXT')
addQuestionColumn('answer_basis', 'TEXT')

const writingColumns = db.prepare('PRAGMA table_info(writings)').all().map((c) => c.name)
const addWritingColumn = (name, type) => {
  if (!writingColumns.includes(name)) db.exec(`ALTER TABLE writings ADD COLUMN ${name} ${type}`)
}
addWritingColumn('comparison', 'TEXT')
addWritingColumn('memorize', 'TEXT')
addWritingColumn('reference_image_paths', 'TEXT')
addWritingColumn('upgraded_sentences', 'TEXT')
addWritingColumn('estimated_target', 'TEXT')

const vocabColumns = db.prepare('PRAGMA table_info(vocab)').all().map((c) => c.name)
if (!vocabColumns.includes('pos')) db.exec("ALTER TABLE vocab ADD COLUMN pos TEXT DEFAULT ''")
if (!vocabColumns.includes('forms')) db.exec("ALTER TABLE vocab ADD COLUMN forms TEXT DEFAULT ''")

const DEFAULT_SETTINGS = {
  exam_date: '2026-12-12T09:00:00+08:00',
  target_total: '480',
  target_writing: '80',
  target_listening: '165',
  target_reading: '165',
  target_translation: '70',
  tolerance: '110',
  ai_base_url: process.env.AI_BASE_URL || '',
  ai_api_key: process.env.AI_API_KEY || '',
  ai_text_model: process.env.AI_TEXT_MODEL || 'gpt-4o-mini',
  ai_vision_model: process.env.AI_VISION_MODEL || 'gpt-4o-mini',
  auto_vocab: '1',
}

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v)

const PLAN_VERSION = '2026-11-17-v2'
const PLAN_LABEL_MAP = {
  听力五步法: '听力篇章精听',
  '晚间①': '仔细阅读2篇',
  '晚间②': '写作/翻译',
}

function syncPlan() {
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan.json'), 'utf8'))
  const insert = db.prepare(
    'INSERT INTO plan_days (date, weekday, phase, theme, kpi, reminder, tasks, is_exam) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const update = db.prepare(
    'UPDATE plan_days SET weekday = ?, phase = ?, theme = ?, kpi = ?, reminder = ?, tasks = ?, is_exam = ? WHERE date = ?',
  )
  const count = db.prepare('SELECT COUNT(*) AS n FROM plan_days').get().n
  const current = db.prepare("SELECT value FROM settings WHERE key = 'plan_version'").get()?.value || ''

  if (count > 0 && current === PLAN_VERSION) return

  if (count > 0) {
    const backupDir = path.join(dataDir, 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const backup = {
      exported_at: new Date().toISOString(),
      plan_version: current,
      plan_days: db.prepare('SELECT * FROM plan_days ORDER BY date').all(),
      plan_progress: db.prepare('SELECT * FROM plan_progress').all(),
    }
    fs.writeFileSync(
      path.join(backupDir, `plan-before-sync-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
      JSON.stringify(backup, null, 2),
    )
  }

  const delProgress = db.prepare('DELETE FROM plan_progress WHERE date = ?')
  const insertProgress = db.prepare('INSERT OR REPLACE INTO plan_progress (date, task_index, done) VALUES (?, ?, 1)')

  db.exec('BEGIN')
  try {
    for (const day of plan) {
      const existing = db.prepare('SELECT * FROM plan_days WHERE date = ?').get(day.date)
      if (!existing) {
        insert.run(
          day.date,
          day.weekday || '',
          day.phase || '',
          day.theme || '',
          day.kpi || '',
          day.reminder || '',
          JSON.stringify(day.tasks || []),
          day.exam ? 1 : 0,
        )
        continue
      }

      const oldTasks = JSON.parse(existing.tasks || '[]')
      const oldDone = db
        .prepare('SELECT task_index FROM plan_progress WHERE date = ? AND done = 1')
        .all(day.date)
        .map((row) => oldTasks[row.task_index]?.label)
        .filter(Boolean)
      const newTasks = day.tasks || []

      update.run(
        day.weekday || '',
        day.phase || '',
        day.theme || '',
        day.kpi || '',
        day.reminder || '',
        JSON.stringify(newTasks),
        day.exam ? 1 : 0,
        day.date,
      )
      delProgress.run(day.date)
      const mapped = new Set()
      for (const label of oldDone) {
        const targets = [PLAN_LABEL_MAP[label] || label]
        if (label === '晚间①') targets.push('仔细阅读1篇')
        const index = newTasks.findIndex((task) => targets.includes(task.label))
        if (index >= 0) mapped.add(index)
      }
      for (const index of mapped) insertProgress.run(day.date, index)
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('plan_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(PLAN_VERSION)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
syncPlan()

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : ''
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value ?? ''))
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const obj = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return obj
}

export function getPublicSettings() {
  const all = getSettings()
  const key = all.ai_api_key || ''
  const masked = key ? (key.length > 10 ? `${key.slice(0, 4)}••••${key.slice(-4)}` : '••••••') : ''
  return {
    ...all,
    ai_api_key: '',
    ai_api_key_masked: masked,
    ai_configured: Boolean(key && all.ai_base_url),
  }
}

export function getAIConfig() {
  const s = getSettings()
  return {
    baseUrl: s.ai_base_url || '',
    apiKey: s.ai_api_key || '',
    textModel: s.ai_text_model || 'gpt-4o-mini',
    visionModel: s.ai_vision_model || s.ai_text_model || 'gpt-4o-mini',
  }
}

export function isoDateLocal(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDaysISO(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return isoDateLocal(d)
}

export function parseJSON(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function mapQuestion(row) {
  if (!row) return null
  return {
    ...row,
    options: parseJSON(row.options, []),
    key_sentences: parseJSON(row.key_sentences, []),
    vocab: parseJSON(row.vocab, []),
    error_tags: parseJSON(row.error_tags, []),
    image_paths: parseJSON(row.image_paths, []),
    is_correct: row.is_correct === null ? null : Boolean(row.is_correct),
    mastered: Boolean(row.mastered),
    ai_raw: undefined,
  }
}

export function mapWriting(row) {
  if (!row) return null
  return {
    ...row,
    dimensions: parseJSON(row.dimensions, []),
    comparison: parseJSON(row.comparison, []),
    strengths: parseJSON(row.strengths, []),
    improvements: parseJSON(row.improvements, []),
    errors: parseJSON(row.errors, []),
    key_expressions: parseJSON(row.key_expressions, []),
    memorize: parseJSON(row.memorize, []),
    reference_image_paths: parseJSON(row.reference_image_paths, []),
    upgraded_sentences: parseJSON(row.upgraded_sentences, []),
    raw: undefined,
  }
}

export function mapSession(row) {
  return row ? { ...row, meta: parseJSON(row.meta, null) } : null
}

const MEANING_SPLIT_RE = /[；;，,、/\n]+/
const POS_PREFIX_RE = /^(?:n|v|vt|vi|a|adj|ad|adv|prep|conj|pron|num|art|aux|int)\.\s*/i

function meaningParts(text) {
  return String(text || '')
    .split(MEANING_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean)
}

function meaningKey(text) {
  return String(text || '')
    .replace(POS_PREFIX_RE, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[（）()【】\[\]\s·、，,；;：:.]/g, '')
    .toLowerCase()
}

function mergeMeaningText(existingText, incomingText) {
  const base = String(existingText || '').trim()
  const incoming = meaningParts(incomingText)
  if (!incoming.length) return { meaning: base, added: 0 }
  const seen = new Set(meaningParts(base).map(meaningKey))
  const additions = []
  for (const part of incoming) {
    const key = meaningKey(part)
    if (!key || seen.has(key)) continue
    seen.add(key)
    additions.push(part)
  }
  if (!additions.length) return { meaning: base, added: 0 }
  return {
    meaning: base ? `${base.replace(/[；;，,、]+$/, '')}；${additions.join('；')}` : additions.join('；'),
    added: additions.length,
  }
}

const FORM_SPLIT_RE = /[；;，,、/\n]+/

function mergeFormsText(existingText, incomingText) {
  const base = String(existingText || '').trim()
  const seen = new Set(
    base
      .split(FORM_SPLIT_RE)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
  const additions = []
  for (const part of String(incomingText || '').split(FORM_SPLIT_RE)) {
    const p = part.trim()
    const key = p.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    additions.push(p)
  }
  if (!additions.length) return base
  return base ? `${base.replace(/[；;，,、]+$/, '')}；${additions.join('；')}` : additions.join('；')
}

export function upsertVocabDetailed(item, source = '') {
  const word = String(item.word || '').trim()
  if (!word) return null
  const today = isoDateLocal()
  const meaning = String(item.meaning || '').trim()
  const phonetic = String(item.phonetic || '').trim()
  const example = String(item.example || '').trim()
  const pos = String(item.pos || '').trim()
  const forms = mergeFormsText('', item.forms)
  const existing = db.prepare('SELECT * FROM vocab WHERE word = ? COLLATE NOCASE').get(word)
  if (existing) {
    const merged = mergeMeaningText(existing.meaning, meaning)
    const mergedForms = mergeFormsText(existing.forms, forms)
    db.prepare(
      'UPDATE vocab SET meaning = ?, phonetic = COALESCE(NULLIF(?, \'\'), phonetic), example = COALESCE(NULLIF(?, \'\'), example), pos = COALESCE(NULLIF(?, \'\'), pos), forms = ?, source = COALESCE(NULLIF(?, \'\'), source) WHERE id = ?',
    ).run(merged.meaning, phonetic, example, pos, mergedForms, source, existing.id)
    return { id: existing.id, created: false, addedMeanings: merged.added }
  }
  const res = db
    .prepare(
      'INSERT INTO vocab (word, phonetic, meaning, example, pos, forms, source, interval_index, next_review, times_reviewed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)',
    )
    .run(word, phonetic, meaning, example, pos, forms, source, today, new Date().toISOString())
  return { id: Number(res.lastInsertRowid), created: true, addedMeanings: meaningParts(meaning).length }
}

export function upsertVocab(item, source = '') {
  const result = upsertVocabDetailed(item, source)
  return result ? result.id : null
}