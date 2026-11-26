import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Database,
  Download,
  KeyRound,
  PlugZap,
  RefreshCw,
  Save,
  Sparkles,
  Target,
  Trash2,
  Upload,
} from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import { Field, PageHeader, ProgressBar } from '../components/UI'
import { AI_PRESETS } from '../constants'

const TARGET_KEYS = [
  ['target_writing', '写作'],
  ['target_listening', '听力'],
  ['target_reading', '阅读'],
  ['target_translation', '翻译'],
]

const TOKEN_PLAN_FALLBACK = [
  ['auto', false],
  ['qwen3.8-max', true],
  ['qwen3.8-flash', true],
  ['qwen3.7-max', false],
  ['qwen3.7-plus', true],
  ['qwen3.6-plus', true],
  ['qwen3.6-flash', true],
  ['deepseek-v4-pro', false],
  ['deepseek-v4-flash', false],
  ['deepseek-v3.2', false],
  ['kimi-k2.7-code', false],
  ['kimi-k2.6', true],
  ['kimi-k2.5', true],
  ['glm-5.2', false],
  ['glm-5.1', false],
  ['glm-5', false],
  ['MiniMax-M2.5', false],
].map(([id, vision]) => ({ id, name: id, provider: 'bailian', chat: true, vision }))

const TEXT_MODEL_PREFERENCES = [
  /^auto$/i,
  /qwen3\.7-max/i,
  /deepseek-v4-flash/i,
  /qwen-plus/i,
  /deepseek-chat/i,
]

const VISION_MODEL_PREFERENCES = [
  /qwen3\.8-(flash|max)/i,
  /qwen3\.[67]-plus/i,
  /qwen-vl-max/i,
  /glm-4v/i,
  /gpt-4o/i,
]

const VISION_OVERRIDE = /deepseek.*flash/i
const isVisionModel = (m) => Boolean(m.vision) || VISION_OVERRIDE.test(m.id)

function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SettingsPage() {
  const { settings, refreshSettings, refreshDashboard, notify } = useApp()
  const [examForm, setExamForm] = useState({
    exam_date: '',
    target_total: 480,
    target_writing: 80,
    target_listening: 165,
    target_reading: 165,
    target_translation: 70,
    tolerance: 110,
    auto_vocab: true,
  })
  const [aiForm, setAiForm] = useState({
    preset: 'qwen',
    ai_base_url: '',
    ai_api_key: '',
    ai_text_model: '',
    ai_vision_model: '',
  })
  const [savingExam, setSavingExam] = useState(false)
  const [savingAi, setSavingAi] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [modelCatalog, setModelCatalog] = useState(null)
  const [modelsBusy, setModelsBusy] = useState(false)
  const [modelError, setModelError] = useState('')
  const [clearScope, setClearScope] = useState(null)
  const [clearing, setClearing] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!settings) return
    setExamForm({
      exam_date: toLocalInput(settings.exam_date),
      target_total: Number(settings.target_total) || 480,
      target_writing: Number(settings.target_writing) || 80,
      target_listening: Number(settings.target_listening) || 165,
      target_reading: Number(settings.target_reading) || 165,
      target_translation: Number(settings.target_translation) || 70,
      tolerance: Number(settings.tolerance) || 110,
      auto_vocab: settings.auto_vocab === '1' || settings.auto_vocab === true,
    })
    const matched = AI_PRESETS.find((p) => p.baseUrl && p.baseUrl === settings.ai_base_url)
    setAiForm({
      preset: matched?.id || 'custom',
      ai_base_url: settings.ai_base_url || '',
      ai_api_key: '',
      ai_text_model: settings.ai_text_model || '',
      ai_vision_model: settings.ai_vision_model || '',
    })
  }, [settings])

  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('cet4.ai-model-catalog') || 'null')
      if (cached?.models?.length) setModelCatalog(cached)
    } catch {
      /* ignore */
    }
  }, [])

  const targetSum = useMemo(
    () =>
      ['target_writing', 'target_listening', 'target_reading', 'target_translation'].reduce(
        (s, k) => s + (Number(examForm[k]) || 0),
        0,
      ),
    [examForm],
  )

  const chatModels = useMemo(() => (modelCatalog?.models || []).filter((m) => m.chat), [modelCatalog])
  const visionModels = useMemo(() => chatModels.filter(isVisionModel), [chatModels])
  const textModels = useMemo(() => {
    const plain = chatModels.filter((m) => !isVisionModel(m))
    return plain.length ? plain : chatModels
  }, [chatModels])
  const catalogStale = Boolean(
    modelCatalog?.baseUrl && modelCatalog.baseUrl !== aiForm.ai_base_url.trim(),
  )
  const showModelSelects = Boolean(modelCatalog?.models?.length) && !catalogStale

  const applyPreset = (id) => {
    const preset = AI_PRESETS.find((p) => p.id === id)
    if (!preset) return
    setAiForm((f) => ({
      ...f,
      preset: id,
      ai_base_url: preset.baseUrl || (id === 'custom' ? f.ai_base_url : ''),
      ai_text_model: preset.textModel || (id === 'custom' ? f.ai_text_model : ''),
      ai_vision_model: preset.visionModel || (id === 'custom' ? f.ai_vision_model : ''),
    }))
    setTestResult(null)
    setModelError('')
  }

  const applyCatalog = (catalog) => {
    setModelCatalog(catalog)
    try {
      localStorage.setItem('cet4.ai-model-catalog', JSON.stringify(catalog))
    } catch {
      /* ignore */
    }
    const chat = catalog.models.filter((m) => m.chat)
    const plain = chat.filter((m) => !isVisionModel(m))
    const textPool = plain.length ? plain : chat
    const vision = chat.filter(isVisionModel)
    const pick = (list, current, preferences) => {
      if (list.some((m) => m.id === current)) return current
      for (const re of preferences) {
        const hit = list.find((m) => re.test(m.id))
        if (hit) return hit.id
      }
      return list[0]?.id || ''
    }
    setAiForm((f) => ({
      ...f,
      ai_text_model:
        pick(textPool, f.ai_text_model.trim(), TEXT_MODEL_PREFERENCES) || f.ai_text_model,
      ai_vision_model:
        pick(vision, f.ai_vision_model.trim(), VISION_MODEL_PREFERENCES) || f.ai_vision_model,
    }))
  }

  const loadModels = async () => {
    if (!aiForm.ai_base_url.trim()) {
      notify('先填写接口地址 Base URL', 'error')
      return
    }
    setModelsBusy(true)
    setModelError('')
    try {
      const data = await api.post('/api/settings/ai-models', {
        baseUrl: aiForm.ai_base_url.trim(),
        apiKey: aiForm.ai_api_key.trim() || undefined,
      })
      applyCatalog({ ...data, baseUrl: aiForm.ai_base_url.trim(), savedAt: Date.now() })
      notify(`已拉取 ${data.count} 个模型，可直接下拉选择`)
    } catch (err) {
      if (/token-plan/i.test(aiForm.ai_base_url)) {
        const models = TOKEN_PLAN_FALLBACK
        applyCatalog({
          models,
          count: models.length,
          chatCount: models.length,
          visionCount: models.filter((m) => m.vision).length,
          source: 'builtin',
          baseUrl: aiForm.ai_base_url.trim(),
          savedAt: Date.now(),
        })
        setModelError(`${err.message} 已先用百炼 Token Plan 官方支持列表填充，仍需点「测试连接」确认 Key 有效。`)
      } else {
        setModelError(err.message)
      }
    } finally {
      setModelsBusy(false)
    }
  }

  const saveExam = async () => {
    setSavingExam(true)
    try {
      await api.put('/api/settings', {
        exam_date: examForm.exam_date ? new Date(examForm.exam_date).toISOString() : undefined,
        target_total: Number(examForm.target_total),
        target_writing: Number(examForm.target_writing),
        target_listening: Number(examForm.target_listening),
        target_reading: Number(examForm.target_reading),
        target_translation: Number(examForm.target_translation),
        tolerance: Number(examForm.tolerance),
        auto_vocab: examForm.auto_vocab ? '1' : '0',
      })
      await refreshSettings()
      await refreshDashboard()
      notify('目标与考试信息已保存')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSavingExam(false)
    }
  }

  const saveAi = async () => {
    setSavingAi(true)
    try {
      const payload = {
        ai_base_url: aiForm.ai_base_url.trim(),
        ai_text_model: aiForm.ai_text_model.trim(),
        ai_vision_model: aiForm.ai_vision_model.trim(),
      }
      if (aiForm.ai_api_key.trim()) payload.ai_api_key = aiForm.ai_api_key.trim()
      await api.put('/api/settings', payload)
      await refreshSettings()
      setAiForm((f) => ({ ...f, ai_api_key: '' }))
      notify('AI 配置已保存')
      setTestResult(null)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSavingAi(false)
    }
  }

  const clearKey = async () => {
    if (!window.confirm('清除已保存的 API Key？清除后拍照解析和批改将不可用。')) return
    try {
      await api.put('/api/settings', { ai_api_key: '', clear_ai_key: true })
      await refreshSettings()
      notify('API Key 已清除')
      setTestResult(null)
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const testAi = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.post('/api/settings/test-ai', {
        baseUrl: aiForm.ai_base_url.trim(),
        apiKey: aiForm.ai_api_key.trim() || undefined,
        textModel: aiForm.ai_text_model.trim() || undefined,
      })
      setTestResult({ ok: true, message: `连接成功 · ${result.model || '模型已响应'}` })
    } catch (err) {
      setTestResult({ ok: false, message: err.message })
    } finally {
      setTesting(false)
    }
  }

  const exportData = () => {
    const link = document.createElement('a')
    link.href = '/api/export'
    link.click()
    notify('正在导出备份文件')
  }

  const importData = async (file) => {
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!data.version) throw new Error('这不是冲刺舱的备份文件')
      if (!window.confirm('导入会覆盖当前所有学习记录（不影响 API Key）。继续？')) return
      await api.post('/api/import', data)
      await Promise.all([refreshSettings(), refreshDashboard()])
      notify('备份已导入')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const clearData = async () => {
    if (!clearScope) return
    setClearing(true)
    try {
      await api.del(`/api/data?scope=${clearScope}`)
      await Promise.all([refreshSettings(), refreshDashboard()])
      notify(clearScope === 'all' ? '全部数据已清空' : '学习记录已清空')
      setClearScope(null)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="settings-page">
      <PageHeader
        eyebrow="SETUP"
        title="设置"
        desc="目标分、AI 接口、数据备份。所有记录默认只保存在这台电脑上。"
      />

      <div className="settings-grid">
        <section className="card settings-card">
          <div className="block-head">
            <span className="head-icon"><Target size={18} /></span>
            <div>
              <h2>目标与考试</h2>
              <p>首页倒计时、模考差距、闸门判断都以这里为准。</p>
            </div>
          </div>

          <Field label="考试时间" hint="默认 2026-12-12 09:00（北京时间）">
            <input
              className="input"
              type="datetime-local"
              value={examForm.exam_date}
              onChange={(e) => setExamForm({ ...examForm, exam_date: e.target.value })}
            />
          </Field>

          <div className="two-col">
            <Field label="目标总分">
              <input
                className="input"
                type="number"
                min="425"
                max="710"
                value={examForm.target_total}
                onChange={(e) => setExamForm({ ...examForm, target_total: e.target.value })}
              />
            </Field>
            <Field label="计时容忍度（%）" hint="110% 表示比官方时长多给 10%">
              <input
                className="input"
                type="number"
                min="50"
                max="200"
                value={examForm.tolerance}
                onChange={(e) => setExamForm({ ...examForm, tolerance: e.target.value })}
              />
            </Field>
          </div>

          <div className="target-grid">
            {TARGET_KEYS.map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={examForm[key]}
                  onChange={(e) => setExamForm({ ...examForm, [key]: e.target.value })}
                />
              </Field>
            ))}
          </div>

          <div className="target-sum">
            <div className="target-sum-head">
              <span>四板块合计</span>
              <b className={targetSum > Number(examForm.target_total) ? 'neg' : 'pos'}>{targetSum} 分</b>
            </div>
            <ProgressBar value={targetSum} max={Number(examForm.target_total) || 480} color="var(--teal)" height={6} />
            <p className={targetSum > Number(examForm.target_total) ? 'notice-warn' : 'muted small'}>
              {targetSum > Number(examForm.target_total)
                ? '四板块目标加起来超过总分目标，建议把阅读或听力目标调低一点。'
                : `合计低于目标总分 ${Math.max(0, (Number(examForm.target_total) || 0) - targetSum)} 分，留作容错空间。`}
            </p>
          </div>

          <label className="check-label">
            <input
              type="checkbox"
              checked={examForm.auto_vocab}
              onChange={(e) => setExamForm({ ...examForm, auto_vocab: e.target.checked })}
            />
            手动录题时，自动把生词加入单词本（拍照解析只加荧光笔重点词）
          </label>

          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={saveExam} disabled={savingExam}>
              <Save size={16} />
              {savingExam ? '保存中…' : '保存目标'}
            </button>
          </div>
        </section>

        <section className="card settings-card">
          <div className="block-head">
            <span className="head-icon"><Sparkles size={18} /></span>
            <div>
              <h2>AI 接口</h2>
              <p>用于拍照解析、作文与翻译打分。不配置也能手动录题、记分。</p>
            </div>
            <span className={`badge ${settings?.ai_configured ? 'badge-teal' : 'badge-muted'}`}>
              {settings?.ai_configured ? '已连接' : '未配置'}
            </span>
          </div>

          <Field label="服务商">
            <select className="input input-select" value={aiForm.preset} onChange={(e) => applyPreset(e.target.value)}>
              {AI_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>

          <Field label="接口地址 Base URL" hint="按量计费：https://dashscope.aliyuncs.com/compatible-mode/v1；Token Plan 用 token-plan.*.maas.aliyuncs.com/compatible-mode/v1">
            <input
              className="input"
              value={aiForm.ai_base_url}
              onChange={(e) => setAiForm({ ...aiForm, ai_base_url: e.target.value })}
              placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            />
          </Field>

          <Field
            label="API Key"
            hint={settings?.ai_api_key_masked ? `已保存：${settings.ai_api_key_masked}，留空表示不修改` : '只保存在本机数据库，不会上传到别处'}
          >
            <div className="input-with-icon">
              <KeyRound size={15} />
              <input
                className="input"
                type="password"
                autoComplete="off"
                value={aiForm.ai_api_key}
                onChange={(e) => setAiForm({ ...aiForm, ai_api_key: e.target.value })}
                placeholder={settings?.ai_api_key_masked || 'sk-…'}
              />
            </div>
          </Field>

          <div className="two-col">
            <Field label="文字模型" hint="批改作文 / 翻译 · 不支持识图">
              {showModelSelects && textModels.length ? (
                <select
                  className="input input-select"
                  value={aiForm.ai_text_model}
                  onChange={(e) => setAiForm({ ...aiForm, ai_text_model: e.target.value })}
                >
                  {aiForm.ai_text_model && !textModels.some((m) => m.id === aiForm.ai_text_model) && (
                    <option value={aiForm.ai_text_model}>{aiForm.ai_text_model}（当前值）</option>
                  )}
                  {textModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name !== m.id ? `${m.id} · ${m.name}` : m.id}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  value={aiForm.ai_text_model}
                  onChange={(e) => setAiForm({ ...aiForm, ai_text_model: e.target.value })}
                  placeholder="先拉取模型，或填 qwen-plus"
                />
              )}
            </Field>
            <Field label="视觉模型" hint="拍照解析题目 · 可识图">
              {showModelSelects && visionModels.length ? (
                <select
                  className="input input-select"
                  value={aiForm.ai_vision_model}
                  onChange={(e) => setAiForm({ ...aiForm, ai_vision_model: e.target.value })}
                >
                  {aiForm.ai_vision_model && !visionModels.some((m) => m.id === aiForm.ai_vision_model) && (
                    <option value={aiForm.ai_vision_model}>{aiForm.ai_vision_model}（当前值）</option>
                  )}
                  {visionModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name !== m.id ? `${m.id} · ${m.name}` : m.id}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  value={aiForm.ai_vision_model}
                  onChange={(e) => setAiForm({ ...aiForm, ai_vision_model: e.target.value })}
                  placeholder="先拉取模型，或填 qwen-vl-max"
                />
              )}
            </Field>
          </div>

          {modelCatalog ? (
            <p className="form-note">
              已识别 {modelCatalog.count} 个模型：可对话 {chatModels.length} 个，其中支持识图 {visionModels.length} 个，
              已按是否识图分别放进两个下拉。
              {modelCatalog.source === 'dashscope'
                ? '（百炼原生列表）'
                : modelCatalog.source === 'builtin'
                  ? '（Token Plan 官方列表）'
                  : '（OpenAI 兼容列表）'}
              {catalogStale ? ' 当前列表来自另一个接口地址，换了地址请重新拉取。' : ''}
            </p>
          ) : (
            <p className="form-note">填好接口地址和 Key 后点「拉取模型」，会自动列出账号可用模型并填好默认项。</p>
          )}

          {/token-plan/i.test(aiForm.ai_base_url) && (
            <div className="notice notice-warn">
              <AlertTriangle size={15} />
              Token Plan 官方仅限 AI 编程工具 / Agent 使用，在自定义应用里直接调用可能违反使用条款，Key 有被限流或封禁的风险。长期使用建议换成百炼「按量计费」的 API Key。
            </div>
          )}

          {modelError && (
            <div className="notice notice-warn">
              <AlertTriangle size={15} />
              {modelError}
            </div>
          )}

          {testResult && (
            <div className={`notice ${testResult.ok ? 'notice-ok' : 'notice-warn'}`}>
              {testResult.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              {testResult.message}
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={saveAi} disabled={savingAi}>
              <Save size={16} />
              {savingAi ? '保存中…' : '保存 AI 配置'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={loadModels} disabled={modelsBusy || !aiForm.ai_base_url.trim()}>
              <RefreshCw size={16} />
              {modelsBusy ? '拉取中…' : '拉取模型'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={testAi} disabled={testing || !aiForm.ai_base_url}>
              <PlugZap size={16} />
              {testing ? '测试中…' : '测试连接'}
            </button>
            {settings?.ai_api_key_masked && (
              <button type="button" className="text-btn danger-text" onClick={clearKey}>
                清除 Key
              </button>
            )}
          </div>
        </section>

        <section className="card settings-card">
          <div className="block-head">
            <span className="head-icon"><Database size={18} /></span>
            <div>
              <h2>数据备份</h2>
              <p>换电脑或重装前导出一次；导入会覆盖当前学习记录。</p>
            </div>
          </div>

          <div className="data-actions">
            <button type="button" className="data-action" onClick={exportData}>
              <Download size={20} />
              <div>
                <strong>导出备份</strong>
                <span>错题、批改、单词、计划、模考打包成 JSON</span>
              </div>
            </button>
            <button type="button" className="data-action" onClick={() => fileRef.current?.click()}>
              <Upload size={20} />
              <div>
                <strong>导入备份</strong>
                <span>用之前的备份恢复全部学习记录</span>
              </div>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => importData(e.target.files?.[0])}
            />
          </div>

          <div className="danger-zone">
            <div>
              <strong>清空数据</strong>
              <p>清空后无法恢复，建议先导出备份。</p>
            </div>
            <div className="danger-actions">
              <button type="button" className="btn btn-ghost danger" onClick={() => setClearScope('learning')}>
                <Trash2 size={15} />
                清空学习记录
              </button>
              <button type="button" className="btn btn-ghost danger" onClick={() => setClearScope('all')}>
                <Trash2 size={15} />
                清空全部（含计划勾选）
              </button>
            </div>
          </div>

          {clearScope && (
            <div className="confirm-box">
              <AlertTriangle size={18} />
              <div>
                <strong>{clearScope === 'all' ? '确定清空全部数据？' : '确定清空学习记录？'}</strong>
                <p>
                  {clearScope === 'all'
                    ? '错题、批改、单词、计时、模考、打卡和计划勾选都会删除，设置保留。'
                    : '错题、批改、单词、计时、模考会删除，计划勾选和打卡保留。'}
                </p>
              </div>
              <div className="confirm-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setClearScope(null)}>
                  取消
                </button>
                <button type="button" className="btn btn-primary btn-sm danger-fill" onClick={clearData} disabled={clearing}>
                  {clearing ? '清空中…' : '确认清空'}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="card settings-card about-card">
          <div className="block-head">
            <span className="head-icon"><CalendarClock size={18} /></span>
            <div>
              <h2>关于</h2>
              <p>四级冲刺舱 · 26 天到 480</p>
            </div>
          </div>
          <ul className="about-list">
            <li>数据存储在本机 <code>cet4-sprint/data/cet4.db</code>，不会上传云端。</li>
            <li>AI 请求只会发送你上传的题目图片、作文和翻译文本。</li>
            <li>目标 480：写作 80 / 听力 165 / 阅读 165 / 翻译 70，425 过线。</li>
            <li>计划日期 2026-11-16 → 2026-12-11，考试 12-12 上午 9:00。</li>
          </ul>
        </section>
      </div>
    </div>
  )
}