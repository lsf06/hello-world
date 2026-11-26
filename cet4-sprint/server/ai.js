import { getAIConfig } from './db.js'

export class AIError extends Error {
  constructor(message, code = 'AI_ERROR', status = 502) {
    super(message)
    this.code = code
    this.status = status
  }
}

function resolveConfig(overrides = {}) {
  const saved = getAIConfig()
  const baseUrl = String(overrides.baseUrl || saved.baseUrl || '').trim()
  const apiKey = String(overrides.apiKey || saved.apiKey || '').trim()
  const textModel = String(overrides.textModel || saved.textModel || 'gpt-4o-mini').trim()
  const visionModel = String(overrides.visionModel || saved.visionModel || textModel).trim()
  if (!baseUrl || !apiKey) {
    throw new AIError('还没有配置 AI 接口。请到「设置」填写 Base URL、API Key 和模型名称。', 'AI_NOT_CONFIGURED', 400)
  }
  return { baseUrl, apiKey, textModel, visionModel }
}

function normalizeBaseUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').replace(/\/+$/, '')
}

function endpointOf(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`
}

async function callChat({ messages, model, temperature = 0.2, maxTokens = 4096, overrides = {} }) {
  const config = resolveConfig(overrides)
  const target = model || config.textModel

  const attempt = async (maxOut) => {
    const payload = JSON.stringify({
      model: target,
      messages,
      temperature,
      max_tokens: maxOut,
    })
    const send = async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 180000)
      try {
        return await fetch(endpointOf(config.baseUrl), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: payload,
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
    }
    let res
    try {
      res = await send()
    } catch (err) {
      if (err.name === 'AbortError') throw new AIError('AI 接口响应超时（180秒），请稍后重试或换一个模型。')
      console.warn('[AI] 连接中断，重试一次：', err.message)
      try {
        res = await send()
      } catch (retryErr) {
        if (retryErr.name === 'AbortError') throw new AIError('AI 接口响应超时（180秒），请稍后重试或换一个模型。')
        throw new AIError(`无法连接 AI 接口：${retryErr.message}`)
      }
    }

    const text = await res.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new AIError(`AI 接口返回了非 JSON 内容（HTTP ${res.status}）：${text.slice(0, 200)}`)
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new AIError('AI 密钥无效或已失效，请到「设置」重新填写 API Key。', 'AI_AUTH', 502)
      }
      if (res.status === 402) {
        throw new AIError('AI 账户余额不足，请充值后再试。', 'AI_BALANCE', 502)
      }
      const msg = data?.error?.message || data?.message || text.slice(0, 300)
      throw new AIError(`AI 接口报错（HTTP ${res.status}）：${msg}`)
    }
    const choice = data?.choices?.[0]
    const raw = choice?.message?.content
    const content = Array.isArray(raw)
      ? raw.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('\n')
      : String(raw || '')
    return {
      content,
      finish: choice?.finish_reason || 'unknown',
      reasoning: String(choice?.message?.reasoning_content || '').length,
    }
  }

  let out = await attempt(maxTokens)
  if (!out.content.trim() && out.finish === 'length' && out.reasoning > 0) {
    out = await attempt(Math.min(8192, Math.max(maxTokens * 4, 1024)))
  }
  if (!out.content.trim()) {
    throw new AIError(
      `AI 没有返回内容（finish_reason=${out.finish}，推理 ${out.reasoning} 字符），请检查模型名称是否支持当前请求。`,
    )
  }
  return out.content
}

function extractJson(text) {
  let t = String(text).trim()
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    return JSON.parse(t)
  } catch {
    /* continue */
  }
  const objStart = t.indexOf('{')
  const objEnd = t.lastIndexOf('}')
  if (objStart !== -1 && objEnd > objStart) {
    try {
      return JSON.parse(t.slice(objStart, objEnd + 1))
    } catch {
      /* continue */
    }
  }
  const arrStart = t.indexOf('[')
  const arrEnd = t.lastIndexOf(']')
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(t.slice(arrStart, arrEnd + 1))
    } catch {
      /* continue */
    }
  }
  throw new AIError('AI 返回的格式无法解析，请重试一次。')
}

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined || value === '') return []
  return [value]
}

function asText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

function normalizeVocab(list) {
  const seen = new Set()
  return asArray(list)
    .map((v) => {
      if (typeof v === 'string') return { word: v, phonetic: '', meaning: '', example: '', pos: '', forms: '' }
      const formValue = v.forms ?? v.word_forms ?? v.inflections
      return {
        word: asText(v.word || v.en),
        phonetic: asText(v.phonetic),
        meaning: asText(v.meaning || v.zh),
        example: asText(v.example),
        pos: asText(v.pos || v.part_of_speech || v.pos_tag),
        forms: Array.isArray(formValue)
          ? formValue.map(asText).filter(Boolean).join('；')
          : asText(formValue),
      }
    })
    .filter((v) => {
      const key = v.word.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function finalizeMarkedVocab(list) {
  const items = normalizeVocab(list).filter((v) => v.meaning && /[a-zA-Z]/.test(v.word))
  const phraseWords = new Set()
  for (const item of items) {
    const parts = item.word.toLowerCase().split(/\s+/).filter(Boolean)
    if (parts.length > 1) for (const part of parts) phraseWords.add(part)
  }
  return items
    .filter((item) => {
      const word = item.word.trim().toLowerCase()
      if (!word) return false
      return word.split(/\s+/).length > 1 || !phraseWords.has(word)
    })
    .slice(0, 30)
}

const MARKED_SCAN_PROMPT = `你是大学英语四级（CET-4）辅导老师。这次只做一件事：逐行扫描所有图片，收集「荧光笔高亮 + 旁边有学生手写中文」的四级重点词和固定搭配。

扫描步骤（必须按顺序做）：
1. 先看整页，找出所有荧光笔色块。淡黄、浅粉、浅橙、荧光绿、灰黄细带都算；红笔手写、印刷下划线/波浪线/粗体/括号注释/圈画都不算高亮。
2. 从左上到右下逐行扫描，包括句首、行末、页边、题目与文章之间、折痕附近；不要只挑大词、粗体词或有下划线的词。
3. 对每个色块，抄出被高亮覆盖的印刷英文原词，必须与原文拼写完全一致；不要改成词典原形，只还原复数、时态、比较级等屈折变化。
4. 看这个词的上/下/左/右有没有学生手写中文，有就逐字抄下来；看不清也先按看到的字形填，不要用词典释义代替。只认红笔/铅笔手写；印刷在括号里的中文注释（如 blink（眨眼））不算手写中文，遇到这种不要收。
5. 两个条件同时满足才收：有荧光笔 + 有手写中文。只有一个条件的不收。
6. 高亮常常很淡、只覆盖词的下半部分或边缘，也常常是一道灰黄色细带；不要因为色块不完整就漏掉。手写中文常是词上方或下方一行很小的红字，逐行检查。

筛选：只删这几类——人名地名等专有名词、纯虚词（while、across、via、during 这类介词连词）、整句或从句（不是词或固定搭配）。catch、bedtime、shut-eye、treating、celebrating、striking、fall on、thanks to 这类句中小词或短语，只要满足两个条件就必须收，不要以「中学基础词」「超纲词」为理由删除。其余满足条件的实词和固定搭配全部保留。
去重：同一个词只收一次；已收短语就不要再单列其中单词（如收了 day-to-day essential 就不再单列 essential）。两张图都要扫描，不要只看第一张。最多输出 40 个候选，按考频从高到低排序。每个词再给 pos（n. / v. / adj. / adv. / prep. / conj. / phrase）和 forms（2-4 个常用变形或派生，用「；」分隔；变形只放 forms，不要单列成新词）。

只输出 JSON，不要 Markdown。格式：
{"marked_vocab":[{"word":"...","phonetic":"/.../","meaning":"手写中文原文","example":"原文中出现的短语","pos":"v.","forms":"varies；varied；varying","location":"第几段第几行+前后3个词","highlight":"黄/粉/橙/绿","confidence":"high|medium|low"}]}`

async function scanMarkedVocab({ images, config }) {
  if (!images.length) return null
  const raw = await callChat({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: MARKED_SCAN_PROMPT },
        ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    }],
    model: config.visionModel,
    temperature: 0.02,
    maxTokens: 64000,
  })
  const data = extractJson(raw)
  return finalizeMarkedVocab(data.marked_vocab)
}

async function verifyMarkedVocab({ images, candidates, config }) {
  if (!candidates.length) return []
  const prompt = `下面是从图片中初筛出的「荧光笔 + 手写中文」候选词。请对照图片逐条复核，输出最终名单。
对每个候选依次问三个问题：
1) 图片里被高亮的印刷词与 word 是否一致（允许漏掉词尾的复数/时态差异）？
2) 高亮是否真的覆盖这个词，而不是覆盖旁边的词？印刷下划线、红笔线、圈画都不算高亮。
3) 词旁是否有学生手写中文？印刷在括号里的中文注释不算手写（如 blink（眨眼）），这种不要保留。
保留原则：只要 1) 和 2) 成立、且附近确实有中文手写，就保留；手写模糊但看得出有中文，也保留（confidence 标 low），meaning 用初筛值。宁可多留一个，也不要漏掉学生标过的词。
只有在以下情况删除：完全没有荧光笔；完全没有手写中文；专有名词；纯虚词；整句或从句而不是词/固定搭配。
特别注意：catch、bedtime、shut-eye、treating、celebrating、striking、fall on、thanks to、record、patterns、average、findings 这类词必须保留，不要以「中学基础词」「超纲词」「太简单」为理由删除。
复核完后，再重新扫一遍整页，补上初筛漏掉的「荧光笔 + 手写中文」词或固定搭配，特别注意句首、行末、页边、题目之间、折痕附近。
去重规则不变：固定搭配整体收；同一个词只收一次，收了短语就不再单列其中单词。最多 30 个，按考频排序。
复核时保留候选的 pos（词性）和 forms（变形），缺失就补全；forms 用「；」分隔，变形不要单列成新词。
只输出 JSON，不要 Markdown。格式：
{"marked_vocab":[{"word":"...","phonetic":"/.../","meaning":"手写中文原文","example":"原文短语","pos":"v.","forms":"varies；varied；varying"}],"removed":[{"word":"...","reason":"..."}]}

候选：
${JSON.stringify(candidates.map((v) => ({ word: v.word, meaning: v.meaning, example: v.example, pos: v.pos, forms: v.forms })))}`
  const raw = await callChat({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    }],
    model: config.visionModel,
    temperature: 0,
    maxTokens: 64000,
  })
  const data = extractJson(raw)
  return finalizeMarkedVocab(data.marked_vocab)
}

export function normalizeAnswerLetter(value) {
  const text = asText(value).toUpperCase()
  const match = text.match(/\b[A-Z]\b/)
  return match ? match[0] : ''
}

function buildWhyWrong(myAnswer, correctAnswer, analysis) {
  const brief = analysis.length > 180 ? `${analysis.slice(0, 180)}…` : analysis
  return `你选了 ${myAnswer || '未识别'}，正确答案是 ${correctAnswer || '未识别'}。${brief ? `对照解析看依据：${brief}` : '回原文定位答案句，再比较你选的选项和正确选项的差别。'}`
}

function normalizeQuestion(item, index) {
  const q = item && typeof item === 'object' ? item : {}
  const options = asArray(q.options).map((o) => asText(o)).filter(Boolean)
  const vocab = normalizeVocab(q.vocab)
  const myAnswer = normalizeAnswerLetter(q.my_answer)
  const correctAnswer = normalizeAnswerLetter(q.correct_answer)
  const isCorrect = myAnswer && correctAnswer ? myAnswer === correctAnswer : null
  const analysis = asText(q.analysis)
  let whyWrong = asText(q.why_wrong || q.why).trim()
  if (isCorrect === false && !whyWrong) whyWrong = buildWhyWrong(myAnswer, correctAnswer, analysis)
  if (isCorrect === true) whyWrong = ''
  const keySentences = asArray(q.key_sentences)
    .map((s) => {
      if (typeof s === 'string') return { en: s, zh: '' }
      return { en: asText(s.en || s.sentence), zh: asText(s.zh || s.translation) }
    })
    .filter((s) => s.en)
  return {
    number: asText(q.number || index + 1),
    section: asText(q.section),
    subtype: asText(q.subtype),
    question_text: asText(q.question_text || q.question),
    context: asText(q.context),
    options,
    my_answer: myAnswer,
    answer_basis: asText(q.answer_basis),
    answer_marks: asText(q.answer_marks),
    correct_answer: correctAnswer,
    is_correct: isCorrect,
    analysis,
    why_wrong: whyWrong,
    how_to_fix: asText(q.how_to_fix || q.how_to_improve || q.improvement),
    translation: asText(q.translation),
    key_sentences: keySentences,
    vocab,
    error_tags: asArray(q.error_tags).map(asText).filter(Boolean).slice(0, 4),
    note: asText(q.note),
    confidence: asText(q.confidence || 'medium'),
  }
}

function mergeVerifiedQuestions(questions, verified) {
  const byNumber = new Map()
  asArray(verified).forEach((v, i) => {
    if (v && typeof v === 'object') byNumber.set(String(v.number ?? i + 1), v)
  })
  return questions.map((q, i) => {
    const v = byNumber.get(String(q.number ?? i + 1)) || verified[i]
    if (!v || typeof v !== 'object') return q
    const myAnswer = v.my_answer !== undefined ? normalizeAnswerLetter(v.my_answer) : q.my_answer
    const correctAnswer = v.correct_answer !== undefined ? normalizeAnswerLetter(v.correct_answer) : q.correct_answer
    const isCorrect = myAnswer && correctAnswer ? myAnswer === correctAnswer : null
    const analysis = asText(v.analysis) || q.analysis
    let whyWrong = asText(v.why_wrong).trim()
    if (isCorrect === true) whyWrong = ''
    if (isCorrect === false && !whyWrong) whyWrong = buildWhyWrong(myAnswer, correctAnswer, analysis)
    const tags = asArray(v.error_tags).map(asText).filter(Boolean).slice(0, 4)
    return {
      ...q,
      my_answer: myAnswer,
      answer_basis: asText(v.answer_basis) || q.answer_basis,
      correct_answer: correctAnswer,
      is_correct: isCorrect,
      analysis,
      why_wrong: whyWrong,
      how_to_fix: asText(v.how_to_fix) || q.how_to_fix,
      error_tags: tags.length ? tags : q.error_tags,
      note: asText(v.note) || q.note,
      confidence: asText(v.confidence) || q.confidence,
    }
  })
}

async function verifyAnswers({ questions, passageText, config }) {
  const passage = asText(passageText).trim()
  if (!questions.length || passage.length < 120) return null
  const payload = {
    passage_text: passage,
    questions: questions.map((q) => ({
      number: q.number,
      question_text: q.question_text,
      options: q.options,
      answer_marks: q.answer_marks,
      answer_basis: q.answer_basis,
      context: q.context,
    })),
  }
  const prompt = `你是大学英语四级（CET-4）阅读老师。下面是一篇文章的完整转写、若干选择题，以及学生在图片上的手写痕迹描述。请独立复核每道题。
判断正确答案：
1. 只根据 passage_text 判断正确答案，不要因为 my_answer 或任何已有判断而改变；每个答案必须能在文章中找到直接依据。长篇匹配和选词填空的答案字母可到 O，必须原样保留，不要因为超过 D 就置空。
2. 两个选项都像时，选依据最直接、最贴合题干的那一个，并说明另一个为什么是陷阱（偷换程度、范围过大、答非所问、把例子当结论等）。
3. 注意区分「例子」和「整体结论」：问 Europeans 时不能把一个国家的特殊情况当成整体主因。
判断学生作答（按优先级）：
(a) 题号左侧、右侧或上方独立写出的大写字母是学生作答，优先级最高；
(b) 没有旁写字母时，被圈住或涂黑的选项字母是学生作答；
(c) 勾、叉、斜线是批改标记：勾在某选项上表示该选项是正确答案，叉或斜线表示学生排除的选项，不算作答；
(d) 旁写字母和圈选冲突时，旁写字母是 my_answer，圈选/勾选字母作为 correct_answer 的参考；
(e) 只有勾/叉、没有旁写字母或圈选时，my_answer 留空；痕迹描述看不清也留空，不要猜。
其他要求：
- is_correct 只有在 my_answer 和 correct_answer 都明确时才给 true/false，任一为空返回 null，且必须与两个字母一致。
- 做错时 why_wrong 必须填写：学生选了哪个干扰项、这个干扰项为什么诱人（原文哪句容易被误读）、思路断在哪一步；做对时留空。
- analysis 用中文写清定位句、同义替换和排除理由；how_to_fix 给 1-3 条可执行动作。
- answer_basis 写你判断学生作答的依据（如：题号左侧手写 D；B 旁是批改勾，不算作答）。
只输出 JSON，不要 Markdown。题号必须与输入一一对应。格式：
{"questions":[{"number":"1","my_answer":"A/B/C/D/空","answer_basis":"...","correct_answer":"A/B/C/D","is_correct":true或false或null,"analysis":"中文解析","why_wrong":"做错时必填，做对留空","how_to_fix":"1-3 条","error_tags":["标签"],"note":"一句提醒，可留空","confidence":"high|medium|low"}]}

材料：
${JSON.stringify(payload)}`
  try {
    const raw = await callChat({
      messages: [{ role: 'user', content: prompt }],
      model: config.textModel,
      temperature: 0,
      maxTokens: 12000,
    })
    const data = extractJson(raw)
    return Array.isArray(data?.questions) ? data.questions : null
  } catch (err) {
    console.warn('[AI] 答案复核失败，保留第一轮识别：', err.message)
    return null
  }
}

export async function analyzeQuestion({ imagesBase64 = [], text, section }) {
  const images = (Array.isArray(imagesBase64) ? imagesBase64 : [imagesBase64]).filter(Boolean)
  const sectionHint = section && section !== '自动判断' ? `用户标记的题型是「${section}」。以图片内容为准，如果明显不符请纠正。` : '请自行判断题型。'
  const multiHint = images.length > 1
    ? `用户上传了 ${images.length} 张图片，可能是同一套题的文章页、题目页、正反面或多页练习。请把它们当作同一组材料综合分析：文章页的信息用于解释题目页，跨图重复出现的题目只输出一次，题号沿用图片上的原始题号。`
    : ''
  const prompt = `你是大学英语四级（CET-4）辅导老师，擅长把学生做过的题目拆解成可以复盘的数据。请阅读用户提供的题目图片或文字，完成以下任务：
1. 识别所有题目（可以是一道，也可以是同一页上的多道题；多张图片时按顺序合并识别），识别题干、选项和学生作答。作答标记按以下优先级判断：
(a) 题号左侧、右侧或上方空白处独立写出的大写字母（例如题号旁一个大大的 D）是学生作答，优先级最高；
(b) 没有这种旁写字母时，被圈住或涂黑的选项字母是学生作答；
(c) 打勾、打叉、斜线通常是批改标记：勾在某选项上表示该选项是正确答案，叉或斜线表示学生排除的选项，都不要当成学生作答；
(d) 同一题既有旁写字母、又有圈选或勾选且字母不同时，旁写字母是 my_answer，圈选/勾选的字母作为 correct_answer 的参考；
(e) 只有勾/叉、没有任何旁写字母或圈选时，my_answer 留空；
(f) 仍然看不清就留空，绝对不要猜一个字母。
2. 独立根据文章判断正确答案，不要因为学生选了某项就认为它正确。答案必须有原文直接依据；两个选项都像时，选依据最直接、最贴合题干的那一个，并说明另一个为什么是陷阱（偷换程度、范围过大、答非所问、把例子当结论等）。然后比较 my_answer 和 correct_answer：只有两者都明确时才给 is_correct（相同 true，不同 false），任一为空就返回 null；is_correct 必须和两个字母一致。
2.1 长篇匹配（长篇阅读）和选词填空的答案字母可能到 O（如 F、J、K），必须完整保留，不要截成 A-D；选项按图片原编号全部列出，有几个列几个。
3. 用中文写清解析：答案线索在原文哪一句、同义替换是什么、干扰项为什么错。零基础学生要能看懂。特别注意区分「例子」和「整体结论」，例如问 Europeans 时不能把一个国家的特殊情况当成整体主因。
4. 提取导致这道题出错的关键生词（只要真正影响理解的，不要凑数），每个词补 pos（词性，n./v./adj./adv./prep./conj./phrase）和 forms（2-4 个常用变形或派生，用「；」分隔；变形不要单列成词）。
5. 提取答案所在的关键英文句子并翻译。
6. 给这道错题打 1-3 个错因标签。
7. 判断学生为什么会错：把学生的答案和正确思路逐项对比，指出是在定位、同义替换、词汇、逻辑还是干扰项上被带偏。做错时 why_wrong 必须填写、不能留空：先写清楚学生选了哪个字母/干扰项，再写这个干扰项为什么诱人（原文哪一句容易被误读），最后写思路断在哪一步；做对时才留空。再写出下次遇到同类题的具体改法（1-3 步，必须可执行）。
8. 收集学生重点标记的单词，放进顶层 marked_vocab。判定必须同时满足两个条件：(a) 单词被荧光笔高亮——颜色可能很淡（淡黄、浅粉、灰黄细带也算），只要词上有高亮色块即可，普通下划线、波浪线、圈画、星号不算；(b) 单词旁边有学生手写的中文注释。两个条件同时满足才收，只划线或圈画、没有中文注释的词不收。只去掉人名地名等专有名词、纯虚词（while、across、via、during 这类介词连词）和整句/从句。其余实词（名词、动词、形容词、副词）全部保留，不要因为词简单常见就漏掉 catch、bedtime、shut-eye、reluctant、concern、uneasy、bother 这类词。固定搭配按整体收，临时组合不收；同一单词和包含它的短语不要重复收录（如已收 day-to-day essential 就不要再单列 essential）。两张图都要逐行检查，不要只看第一张。按考频从高到低排序，超过 30 个才截取前 30 个。这些词即使与错题无关、所在页面没有题目也要提取；同一个词只列一次；只还原复数、时态、比较级等屈折变化，派生词保持原样（原文 abstracted 不要改成 abstract，minor 不要写成 minority）；meaning 直接用学生在图片上写的中文注释。
${multiHint}
${sectionHint}

错因标签优先从下面选择（也可以补充更准确的）：
定位错误、同义替换未识别、词汇不认识、长难句看不懂、绝对化选项误选、过度推断、时间不够、粗心、听音辨词错误、连读/语速不适、干扰项误选、语法/词性、上下文逻辑、主旨概括错误。

再次强调：题号旁独立写出的大写字母优先当作学生作答；没有旁写字母时，圈住的选项才是学生答案；另一个选项旁的勾通常表示正确答案。不要把批改勾当成学生作答，也不要在看不清时猜 my_answer。判断正确项时只依据原文，不要迎合学生答案。

只输出 JSON，不要输出 Markdown。格式：
{
  "questions": [
    {
      "number": "题号，如 1",
      "section": "仔细阅读|长篇匹配|选词填空|听力篇章|长对话|短篇新闻|写作|翻译|其他",
      "subtype": "更具体的题型，如 细节题/推断题/主旨题/词义题",
      "question_text": "题干原文",
      "context": "定位句或必要上下文（英文，可留空）",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "my_answer": "学生圈选/手写的答案，如 B；长篇匹配、选词填空可到 O；没看清就留空，不要猜",
      "answer_marks": "逐项如实描述这道题周围的手写痕迹和位置，不要下结论，如：题号左侧蓝色大写 D；A 上红色斜线；B 旁红色勾；C 被圈住",
      "answer_basis": "按优先级判断学生作答的依据，如：题号左侧手写 D；B 旁是批改勾，不算作答；未识别到作答",
      "correct_answer": "正确答案，如 C；长篇匹配、选词填空可到 O",
      "is_correct": "两者都明确时：相同 true，不同 false，任一为空 null",
      "analysis": "中文解析，必须说明定位句和排除理由",
      "why_wrong": "做错时必填：学生选了哪个干扰项、为什么被带偏、哪一步断了；做对留空",
      "how_to_fix": "下次怎么改：1-3 条可执行动作，如先看题干关键词、回原文定位、划出同义替换再对比选项",
      "translation": "题目/定位句的中文翻译",
      "key_sentences": [{"en": "...", "zh": "..."}],
      "vocab": [{"word": "...", "phonetic": "/.../", "meaning": "中文释义", "example": "例句", "pos": "v.", "forms": "varies；varied；varying"}],
      "error_tags": ["错因标签"],
      "note": "给学生的一句提醒，可留空",
      "confidence": "high|medium|low"
    }
  ],
  "passage_text": "把图片里的英文文章逐段完整转写出来（多张图按顺序合并）；没有文章就留空",
  "marked_vocab": [{"word": "...", "phonetic": "/.../", "meaning": "中文释义", "example": "原文中出现的短语或例句", "pos": "v.", "forms": "varies；varied；varying"}],
  "overall_note": "如果图片模糊或信息不完整，在这里说明；否则留空"
}

图片里如果只有一道题，questions 数组也保留一个元素；如果只有符合条件（荧光笔 + 手写中文）的重点词、没有完整题目，questions 返回空数组 []，marked_vocab 仍要提取。看不清的字段留空字符串，不要编造。${text ? `\n\n用户补充的文字内容：\n${text}` : ''}`

  const messages = []
  if (images.length) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    })
  } else {
    messages.push({ role: 'user', content: prompt })
  }

  const config = resolveConfig()
  const raw = await callChat({
    messages,
    model: images.length ? config.visionModel : config.textModel,
    temperature: 0.05,
    maxTokens: images.length ? 64000 : 16000,
  })
  const data = extractJson(raw)
  const list = Array.isArray(data) ? data : data.questions
  let questions = asArray(list).map(normalizeQuestion).filter((q) => q.question_text || q.options.length)
  let markedVocab = finalizeMarkedVocab(Array.isArray(data) ? [] : data.marked_vocab)
  if (!questions.length && !markedVocab.length) {
    throw new AIError('AI 没有识别出题目或「荧光笔 + 手写中文」的重点词，请换一张更清晰、正对题目的照片。')
  }
  if (images.length) {
    const [verified, scanned] = await Promise.all([
      questions.length
        ? verifyAnswers({
            questions,
            passageText: Array.isArray(data) ? '' : data.passage_text,
            config,
          })
        : Promise.resolve(null),
      scanMarkedVocab({ images, config }).catch((err) => {
        console.warn('[AI] 荧光笔单词独立扫描失败，保留第一轮结果：', err.message)
        return null
      }),
    ])
    if (verified) questions = mergeVerifiedQuestions(questions, verified)
    if (scanned?.length) markedVocab = scanned
  }
  return {
    questions,
    marked_vocab: markedVocab,
    overall_note: asText(Array.isArray(data) ? '' : data.overall_note),
    passage_text: asText(Array.isArray(data) ? '' : data.passage_text),
    model: images.length ? `${config.visionModel} + ${config.textModel} 复核` : config.textModel,
  }
}

export async function explainMistake({ question = {}, passageText = '' }) {
  const mine = normalizeAnswerLetter(question.my_answer)
  const correct = normalizeAnswerLetter(question.correct_answer)
  if (!mine || !correct) {
    throw new AIError('需要「我的答案」和「正确答案」都是字母，才能分析错因。', 'AI_BAD_INPUT', 400)
  }
  if (mine === correct) {
    throw new AIError('两个答案相同，这道题不算错题。', 'AI_BAD_INPUT', 400)
  }
  const options = asArray(question.options).map(asText).filter(Boolean)
  const optionText = (letter) => {
    const hit = options.find((o) => new RegExp(`^\\s*${letter}[.、:：)]`, 'i').test(o))
    return hit ? hit.replace(/^\s*[A-Z][.、:：)]\s*/i, '') : ''
  }
  const payload = {
    section: asText(question.section),
    subtype: asText(question.subtype),
    question_text: asText(question.question_text),
    options,
    my_answer: mine,
    my_option_text: optionText(mine),
    correct_answer: correct,
    correct_option_text: optionText(correct),
    locating_context: asText(question.context),
    first_pass_analysis: asText(question.analysis),
    passage_text: asText(passageText),
  }
  const prompt = `你是大学英语四级（CET-4）阅读老师。学生这道题做错了：他选了 ${mine}，正确答案是 ${correct}。请只做一件事：把「他为什么错」讲透。

要求：
1. 必须具体到选项文本和原文词句。先指出他选的 ${mine} 错在哪：偷换了什么（范围过大/程度过强、主体或对象替换、因果倒置、时间条件不符、把例子当结论、答非所问等）。如果原文里有让 ${mine} 看起来对的那句话，引用它，并指出是哪个词把它否掉。
2. 再说明正确答案 ${correct} 的依据：原文定位句（有 passage_text 或 locating_context 就用原文，没有就写「依据题干与选项」），以及题干和原文之间的同义替换。
3. 指出学生最可能断在哪一步：没定位到答案句 / 没识别同义替换 / 关键词不认识 / 逻辑关系看反 / 被干扰项带偏 / 粗心。必须结合这道题，不要泛泛而谈。
4. 如果材料不足以断定原文依据，就基于题干和选项做逻辑分析，明确说明是推断，不要编造原文句子。
5. 语言用中文，像老师当面讲题；why_wrong 150-300 字，不要套话，不要重复题干。
6. how_to_fix 给 2-3 条针对这道题的可执行动作，每条一行，以数字编号。
7. error_tags 从这些里选 1-3 个：定位错误、同义替换未识别、词汇不认识、长难句看不懂、绝对化选项误选、过度推断、时间不够、粗心、干扰项误选、语法/词性、上下文逻辑、主旨概括错误。
8. trap 用一个短语概括 ${mine} 的陷阱类型；locating_sentence 抄原文定位句，没有就留空。

只输出 JSON，不要 Markdown：
{"why_wrong":"...","how_to_fix":"1. ...\\n2. ...","error_tags":["..."],"trap":"...","locating_sentence":"..."}

材料：
${JSON.stringify(payload)}`
  const config = resolveConfig()
  const raw = await callChat({
    messages: [{ role: 'user', content: prompt }],
    model: config.textModel,
    temperature: 0.2,
    maxTokens: 2500,
  })
  const data = extractJson(raw)
  const whyWrong = asText(data.why_wrong).trim()
  if (!whyWrong) throw new AIError('AI 没有返回错因分析，请再试一次。')
  return {
    why_wrong: whyWrong,
    how_to_fix: asText(data.how_to_fix).trim(),
    error_tags: asArray(data.error_tags).map(asText).filter(Boolean).slice(0, 3),
    trap: asText(data.trap).trim(),
    locating_sentence: asText(data.locating_sentence).trim(),
  }
}

export async function extractMarkedVocab({ imagesBase64 = [] }) {
  const images = (Array.isArray(imagesBase64) ? imagesBase64 : [imagesBase64]).filter(Boolean)
  if (!images.length) throw new AIError('没有可用的图片')
  const config = resolveConfig()
  const candidates = await scanMarkedVocab({ images, config })
  if (!candidates.length) {
    throw new AIError('图片里没有找到「荧光笔标记 + 手写中文」的单词，换一张能看清标注的照片试试。')
  }
  let markedVocab = candidates
  try {
    const verified = await verifyMarkedVocab({ images, candidates, config })
    if (verified.length) markedVocab = verified
  } catch (err) {
    console.warn('[AI] 荧光笔单词复核失败，保留初筛结果：', err.message)
  }
  return { marked_vocab: markedVocab.slice(0, 30) }
}

const VOCAB_PHOTO_PROMPT = `你在读 CET-4 单词卡、单词书或阅读笔记的照片。卡片上的英文有绿色和粉色/品红色两种印刷色：粉色/品红色单词是用户用粉色荧光笔标出的重点，绿色只是普通印刷色。中文是黑色，部分中文下面有蓝笔画的线。

请完成两个独立任务：

任务1 粉色词（pink_words）：逐行扫描每个面板，找出所有粉色/品红色的英文词，一个都不能漏（注意每个面板的第一行和最后一行）。每个词抄下全部中文释义，包括同一行和下一行的所有词性、所有义项，用「；」连接。
- 例：current 是粉色 → 当前的；流行的；潮流；电流。
- 例：acknowledge 是粉色 → 承认；确认；报偿。
- 绿色字母且没有粉色底色 → 不是粉色词，不要放进这个任务。

任务2 蓝线词（blue_words）：找出中文释义下面有蓝色笔画的词（绿色、粉色词都算）。只抄蓝线压到的中文，线没压到的字必须去掉，哪怕它在同一行、同一个义项里。
- 例：pose 的释义「造成；提出 vi. 摆姿势；假装」中只有「造成」「假装」有蓝线 → 造成；假装。
- 例：yield 的释义「屈服；倒塌 vi. 产生；让出」中只有「屈服」「产生」有蓝线 → 屈服；产生。
- 例：challenge 的释义「艰巨的任务；怀疑；挑战 vt. 反对」中只有「艰巨的任务」「挑战」有蓝线 → 艰巨的任务；挑战。
- 例：sympathy 只有「赞同」有蓝线 → 赞同。
- 例：specific 的「详情」被蓝线划过（可能跨两行）→ 详情。
- 蓝线可能从一行中间开始、跨多个义项或在下一行继续；只抄线覆盖到的字。宁可少抄，也不要抄没划线的字。
- 蓝色笔是圆珠笔/中性笔的直线、波浪线、双线；红笔、黑笔、铅笔、印刷下划线都不算蓝线。如果蓝线在英文下面（文章笔记），就抄这个英文对应的中文。

逐个面板扫描，不要漏。不要收既没有粉色也没有蓝线的词。中文逐字照抄，不要概括，不要查词典。

每个词还要补两个字段：
- pos：判断主要词性，用 n. / v. / adj. / adv. / prep. / conj. / pron. / num. / phrase 表示；一词多性写「v.；n.」。
- forms：给 2-4 个最常用的变形或派生，用「；」分隔（动词给三单/过去式/过去分词/-ing；名词给复数；形容词给比较级/最高级；派生如 vary→variety、various）。没有就留空。变形只放在 forms 里，不要当成新词另外收。

只输出 JSON，不要 Markdown：
{"pink_words":[{"word":"英文","meaning":"全部中文","pos":"v.","forms":"varies；varied；varying；variety"}],"blue_words":[{"word":"英文","meaning":"蓝线划到的中文","pos":"v.","forms":"..."}]}`

function mergeFormText(existingText, incomingText) {
  const split = (text) =>
    String(text || '')
      .split(/[；;，,、/\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  const list = split(existingText)
  const seen = new Set(list.map((s) => s.toLowerCase()))
  for (const form of split(incomingText)) {
    const key = form.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push(form)
  }
  return list.join('；')
}

function finalizePhotoVocab(list) {
  const map = new Map()
  for (const v of asArray(list)) {
    const word = asText(v.word).trim()
    const meaning = asText(v.meaning).trim()
    if (!word || !meaning || !/[a-zA-Z]/.test(word)) continue
    const key = word.toLowerCase()
    const mark = v.mark === 'blue-underline' ? 'blue-underline' : 'highlighter'
    const pos = asText(v.pos || v.part_of_speech)
    const forms = asText(Array.isArray(v.forms) ? v.forms.join('；') : v.forms)
    const existing = map.get(key)
    if (existing) {
      if (!existing.meaning.includes(meaning)) existing.meaning += `；${meaning}`
      if (!existing.pos && pos) existing.pos = pos
      existing.forms = mergeFormText(existing.forms, forms)
      if (mark === 'highlighter') existing.mark = 'highlighter'
      continue
    }
    map.set(key, {
      word,
      meaning,
      phonetic: asText(v.phonetic),
      example: asText(v.example),
      pos,
      forms,
      mark,
      confidence: ['high', 'medium', 'low'].includes(v.confidence) ? v.confidence : 'medium',
    })
  }
  return [...map.values()].slice(0, 60)
}

function normalizePhotoVocab(data) {
  const pink = asArray(data.pink_words || data.highlighter_words)
  const blue = asArray(data.blue_words || data.underline_words)
  if (!pink.length && !blue.length) {
    return finalizePhotoVocab(data.words || data.vocab || data.marked_vocab)
  }
  return [
    ...pink.map((v) => ({ ...v, mark: 'highlighter' })),
    ...blue.map((v) => ({ ...v, mark: 'blue-underline' })),
  ]
}

function mergePhotoVocab(items) {
  const map = new Map()
  const add = (v, mark) => {
    const word = asText(v.word).trim()
    const meaning = asText(v.meaning).trim()
    if (!word || !meaning || !/[a-zA-Z]/.test(word)) return
    const key = word.toLowerCase()
    const pos = asText(v.pos || v.part_of_speech)
    const forms = asText(Array.isArray(v.forms) ? v.forms.join('；') : v.forms)
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { word, meaning, phonetic: '', example: '', pos, forms, mark, confidence: 'medium' })
      return
    }
    if (!prev.pos && pos) prev.pos = pos
    prev.forms = mergeFormText(prev.forms, forms)
    if (mark === 'highlighter') {
      if (prev.mark !== 'highlighter' || meaning.length > prev.meaning.length) {
        prev.meaning = meaning
        prev.mark = 'highlighter'
      }
      return
    }
    if (prev.mark === 'highlighter') return
    if (prev.meaning.includes(meaning)) return
    if (meaning.includes(prev.meaning)) {
      prev.meaning = meaning
    } else {
      prev.meaning += `；${meaning}`
    }
  }
  for (const v of items) add(v, v.mark === 'blue-underline' ? 'blue-underline' : 'highlighter')
  return [...map.values()].slice(0, 80)
}
export async function extractVocabPhoto({ imagesBase64 = [] }) {
  const images = (Array.isArray(imagesBase64) ? imagesBase64 : [imagesBase64]).filter(Boolean)
  if (!images.length) throw new AIError('没有可用的图片')
  const config = resolveConfig()
  const batches = []
  for (let i = 0; i < images.length; i += 2) batches.push(images.slice(i, i + 2))
  const runBatch = (batch) => callChat({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: VOCAB_PHOTO_PROMPT },
        ...batch.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    }],
    model: config.visionModel,
    temperature: 0,
    maxTokens: 64000,
  })
  const results = await Promise.allSettled(batches.map(runBatch))
  for (let i = 0; i < results.length; i++) {
    if (results[i].status !== 'rejected') continue
    console.warn(`[AI] 第 ${i + 1} 组图片并发识别失败，改为单独重试：`, results[i].reason?.message)
    try {
      results[i] = { status: 'fulfilled', value: await runBatch(batches[i]) }
    } catch (err) {
      console.warn(`[AI] 第 ${i + 1} 组图片重试仍失败：`, err.message)
      results[i] = { status: 'rejected', reason: err }
    }
  }
  const items = []
  let failed = 0
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      failed += 1
      console.warn(`[AI] 第 ${index + 1} 组图片识别失败：`, result.reason?.message)
      return
    }
    try {
      items.push(...normalizePhotoVocab(extractJson(result.value)))
    } catch (err) {
      failed += 1
      console.warn(`[AI] 第 ${index + 1} 组图片解析失败：`, err.message)
    }
  })
  const words = mergePhotoVocab(items)
  if (!words.length) {
    const firstError = results.find((r) => r.status === 'rejected')
    if (firstError) throw firstError.reason
    throw new AIError('没有找到「荧光笔」或「蓝笔划线」且带中文的单词，换一张更清晰的照片试试。')
  }
  return { words, failed }
}

const WRITING_SCHEMA = `{
  "score15": 0到15的数字（可含0.5）,
  "band": "分数档说明，如 10-12分档",
  "overall": "总体评价，2-3句中文，必须点出得分和失分的主要原因",
  "dimensions": [
    {"name": "内容切题", "score": 0到5, "max": 5, "comment": "中文点评，引用学生原文作证据"},
    {"name": "结构连贯", "score": 0到5, "max": 5, "comment": "中文点评"},
    {"name": "语言准确", "score": 0到5, "max": 5, "comment": "中文点评"}
  ],
  "comparison": [
    {"point": "参考答案/题目要求的内容点或结构要求", "student": "学生作文里的对应写法，没写就写“未写”", "status": "到位|偏差|遗漏", "note": "中文说明怎么补或怎么改"}
  ],
  "strengths": ["做到的优点，1-3条"],
  "improvements": ["最该改的地方，1-3条，按优先级排序"],
  "errors": [
    {"type": "主谓一致|时态|冠词|单复数|拼写|搭配|中式英语|连接词单一|句式单调|词汇重复|要点遗漏|字数不足|跑题", "original": "原文片段", "correction": "修改后", "explanation": "一句话说明"}
  ],
  "corrected_text": "在保留学生原意和水平的前提下改好的全文",
  "upgraded_sentences": ["把原句升级后的2-3个句子"],
  "memorize": [
    {"type": "短语|专有名词|句型|词汇|拼写", "text": "要背的英文（专有名词可带中文）", "note": "中文用法或记忆点"}
  ],
  "reference_text": "学生提供了参考答案就逐字转录；没提供就给一篇符合题目要求的简洁范文",
  "estimated_target": "按80分目标看，当前差距是什么"
}`

const TRANSLATION_SCHEMA = `{
  "score15": 0到15的数字（可含0.5）,
  "band": "分数档说明",
  "overall": "总体评价，2-3句中文，必须点出得分和失分的主要原因",
  "dimensions": [
    {"name": "信息完整", "score": 0到5, "max": 5, "comment": "中文点评，指出漏译/错译的信息点"},
    {"name": "语法准确", "score": 0到5, "max": 5, "comment": "中文点评"},
    {"name": "表达地道", "score": 0到5, "max": 5, "comment": "中文点评"}
  ],
  "comparison": [
    {"point": "参考译文里的一个信息点或关键表达", "student": "学生译文里的对应写法，没译就写“未译”", "status": "到位|偏差|遗漏", "note": "中文说明差别和改法"}
  ],
  "strengths": ["优点"],
  "improvements": ["最该改的地方，按优先级排序"],
  "errors": [
    {"type": "主谓一致|时态|单复数|冠词|拼写|搭配|中式英语|漏译|词性误用|句子结构|连接词", "original": "原文片段", "correction": "修改后", "explanation": "一句话说明"}
  ],
  "key_expressions": [
    {"zh": "中文表达", "en": "推荐英文表达"}
  ],
  "memorize": [
    {"type": "短语|专有名词|句型|词汇|拼写", "text": "要背的英文（专有名词可带中文）", "note": "中文用法或记忆点"}
  ],
  "corrected_text": "在学生译文基础上改通顺的版本",
  "reference_text": "学生提供了参考答案就逐字转录，不要改写；没提供就给一份符合四级水平的参考译文",
  "estimated_target": "按70分目标看，当前差距是什么"
}`

export async function gradeWork({ kind, prompt, content, imageBase64, referenceText = '', referenceImages = [] }) {
  const isTranslation = kind === 'translation'
  const taskName = isTranslation ? '汉译英段落翻译' : '短文写作'
  const schema = isTranslation ? TRANSLATION_SCHEMA : WRITING_SCHEMA
  const hasReference = Boolean(referenceText || referenceImages.length)
  const system = `你是大学英语四级阅卷组的英语老师，正在批改学生的${taskName}。四级${taskName}满分 15 分，折算 106.5 分。
学生是零基础冲刺，目标${isTranslation ? '70/106.5（约 10 分）' : '80/106.5（约 11.5 分）'}。

评分与批改要求：
1. 先确认材料：学生答卷（文字或图片）和参考答案（文字或图片，可能没有）。图片中的手写内容必须逐字识别；参考答案图片必须逐字转录到 reference_text，不要改写、不要意译、不要补全。
2. 按四级评分标准严格、客观打分（可 0.5 分），不要为了鼓励而虚高，也不要无依据压分。分数必须和 comparison、errors、improvements 对得上，能自圆其说。
3. comparison 逐点对照${hasReference ? '参考答案' : '题目要求'}：${isTranslation ? '中文原文的每个信息点是否译出、是否译错' : '题目的每个内容点是否写到、结构是否完整'}。status 只能是 到位/偏差/遗漏；student 写学生实际写法，没写就写“未写/未译”；note 写怎么补、怎么改。最多 12 条。
4. errors 只列学生答卷中真实存在的错误，引用原文片段并给出可直接替换的改法，最多 12 条；不要编造。
5. memorize 是给学生之后背的清单：从参考答案、题目和本次错误中提炼最该记的短语/固定搭配、专有名词、常用句型、易错词汇。type 只能是 短语/专有名词/句型/词汇/拼写；text 写英文（专有名词可带中文），note 写中文用法或记忆点。5-10 条，宁精不滥，不要和学生已经写对的内容重复。
6. corrected_text 保留学生原有水平，只改错，不要整篇换成高级范文。
7. ${hasReference ? 'reference_text 必须来自学生提供的参考答案。' : `没有参考答案时，reference_text ${isTranslation ? '给出一份符合四级水平的参考译文' : '给出一篇符合题目要求的简洁范文'}。`}
8. overall、strengths、improvements、comment、note 全部用中文；improvements 按“改了最提分”的顺序排。
9. 没提供参考答案也没提供题目时，仍然按文本本身评分，但 comparison 只写能从答卷判断的内容点。
10. 只输出 JSON，不要输出 Markdown。格式：
${schema}`

  const parts = []
  parts.push(`【题目/原文】\n${prompt || '（学生未填写，请根据内容判断）'}`)
  parts.push(`【学生${isTranslation ? '译文' : '作文'}文字】\n${content || (imageBase64 ? '（见图片）' : '')}`)
  if (referenceText) parts.push(`【参考答案文字】\n${referenceText}`)
  if (imageBase64 || referenceImages.length) {
    parts.push(`【图片说明】第 1 张是学生的${isTranslation ? '译文' : '作文'}手写稿${referenceImages.length ? `；后面 ${referenceImages.length} 张是参考答案` : ''}。`)
  }

  const messages = [{ role: 'system', content: system }]
  if (imageBase64 || referenceImages.length) {
    const userContent = [{ type: 'text', text: parts.join('\n\n') }]
    if (imageBase64) userContent.push({ type: 'image_url', image_url: { url: imageBase64 } })
    for (const url of referenceImages) userContent.push({ type: 'image_url', image_url: { url } })
    messages.push({ role: 'user', content: userContent })
  } else {
    messages.push({ role: 'user', content: parts.join('\n\n') })
  }

  const config = resolveConfig()
  const raw = await callChat({
    messages,
    model: imageBase64 || referenceImages.length ? config.visionModel : config.textModel,
    temperature: 0.15,
    maxTokens: 6000,
  })
  const data = extractJson(raw)
  const score15raw = Number(data.score15)
  const score15 = Number.isFinite(score15raw) ? Math.max(0, Math.min(15, score15raw)) : 0
  const dims = asArray(data.dimensions).map((d, i) => ({
    name: asText(d?.name) || `维度${i + 1}`,
    score: Number(d?.score) || 0,
    max: Number(d?.max) || 5,
    comment: asText(d?.comment),
  }))
  const errors = asArray(data.errors)
    .map((e) => ({
      type: asText(e?.type) || '其他',
      original: asText(e?.original),
      correction: asText(e?.correction),
      explanation: asText(e?.explanation),
    }))
    .filter((e) => e.original || e.correction)
    .slice(0, 12)
  const comparison = asArray(data.comparison)
    .map((c) => {
      const status = asText(c?.status)
      return {
        point: asText(c?.point),
        student: asText(c?.student),
        status: ['到位', '偏差', '遗漏'].includes(status) ? status : '偏差',
        note: asText(c?.note),
      }
    })
    .filter((c) => c.point)
    .slice(0, 12)
  const memorize = asArray(data.memorize)
    .map((m) => {
      const type = asText(m?.type)
      return {
        type: ['短语', '专有名词', '句型', '词汇', '拼写'].includes(type) ? type : '短语',
        text: asText(m?.text || m?.en),
        note: asText(m?.note || m?.zh),
      }
    })
    .filter((m) => m.text)
    .slice(0, 12)

  return {
    kind,
    score15: Math.round(score15 * 2) / 2,
    score106: Math.round((score15 / 15) * 106.5 * 10) / 10,
    band: asText(data.band) || `${score15}分档`,
    overall: asText(data.overall),
    dimensions: dims,
    comparison,
    strengths: asArray(data.strengths).map(asText).filter(Boolean).slice(0, 5),
    improvements: asArray(data.improvements).map(asText).filter(Boolean).slice(0, 5),
    errors,
    corrected_text: asText(data.corrected_text),
    reference_text: asText(data.reference_text),
    key_expressions: asArray(data.key_expressions)
      .map((k) => ({ zh: asText(k?.zh), en: asText(k?.en) }))
      .filter((k) => k.zh || k.en),
    memorize,
    upgraded_sentences: asArray(data.upgraded_sentences).map(asText).filter(Boolean).slice(0, 4),
    estimated_target: asText(data.estimated_target),
    model: imageBase64 || referenceImages.length ? config.visionModel : config.textModel,
    raw,
  }
}

export async function testConnection(overrides = {}) {
  const config = resolveConfig(overrides)
  const content = await callChat({
    messages: [{ role: 'user', content: '只回复四个字：连接成功。不要解释，不要展开思考。' }],
    model: config.textModel,
    temperature: 0,
    maxTokens: 1024,
    overrides,
  })
  return { ok: true, message: String(content).trim().slice(0, 60), model: config.textModel }
}

const NON_CHAT_MODEL = /(embedding|rerank|tts|asr|realtime|audio|image|video|-i2v|-t2v|-r2v|wan[0-9])/i
const VISION_MODEL =
  /(^|[-_/])(vl|vision|omni)([-_]|$)|qwen-vl|qwen3\.8-(max|plus|flash)|qwen3\.[67]-(plus|flash)|glm-4(\.\d+)?v|kimi-k2\.[5-9]|gpt-(4o|4\.1|5)|gemini|claude-(3|4)/i

function normalizeModelEntry({ id, name, provider, vision, chat }) {
  const modelId = String(id || '').trim()
  if (!modelId) return null
  const deepseekFlash = /deepseek.*flash/i.test(modelId)
  return {
    id: modelId,
    name: String(name || modelId),
    provider: String(provider || ''),
    vision: deepseekFlash ? true : vision === undefined ? VISION_MODEL.test(modelId) : Boolean(vision),
    chat: chat === undefined ? !NON_CHAT_MODEL.test(modelId) : Boolean(chat),
  }
}

function parseOpenAIModels(data) {
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : []
  return list
    .map((m) => {
      if (typeof m === 'string') return normalizeModelEntry({ id: m })
      if (!m || typeof m !== 'object') return null
      const modalities = [
        ...(Array.isArray(m.input_modalities) ? m.input_modalities : []),
        ...(Array.isArray(m.modalities) ? m.modalities : []),
      ]
      const caps = Array.isArray(m.capabilities) ? m.capabilities : []
      const vision =
        modalities.length || caps.length
          ? modalities.some((x) => /image|vision/i.test(String(x))) || caps.includes('VU')
          : undefined
      const chat = Array.isArray(m.output_modalities) && m.output_modalities.length
        ? m.output_modalities.some((x) => /text/i.test(String(x)))
        : undefined
      return normalizeModelEntry({ id: m.id, name: m.name, provider: m.owned_by, vision, chat })
    })
    .filter(Boolean)
}

function parseDashScopeModels(data) {
  const list = data?.output?.models
  if (!Array.isArray(list)) return null
  return list
    .map((m) => {
      const requestModality = Array.isArray(m?.inference_metadata?.request_modality)
        ? m.inference_metadata.request_modality
        : []
      const responseModality = Array.isArray(m?.inference_metadata?.response_modality)
        ? m.inference_metadata.response_modality
        : []
      const caps = Array.isArray(m?.capabilities) ? m.capabilities : []
      const vision =
        requestModality.length || caps.length
          ? requestModality.some((x) => /image|video/i.test(String(x))) || caps.includes('VU')
          : undefined
      const chat = responseModality.length
        ? responseModality.some((x) => /text/i.test(String(x)))
        : undefined
      return normalizeModelEntry({ id: m?.model || m?.id, name: m?.name, provider: m?.provider, vision, chat })
    })
    .filter(Boolean)
}

async function getModelsJson(url, apiKey) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    const text = await res.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      /* keep null */
    }
    return { ok: res.ok, status: res.status, data, text }
  } catch (err) {
    if (err.name === 'AbortError') throw new AIError('获取模型列表超时（25秒），请稍后重试。', 'AI_TIMEOUT', 504)
    throw new AIError(`无法连接模型列表接口：${err.message}`, 'AI_NETWORK', 502)
  } finally {
    clearTimeout(timer)
  }
}

function finishModelList(models, source) {
  const seen = new Set()
  const unique = []
  for (const m of models) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    unique.push(m)
  }
  unique.sort((a, b) => a.id.localeCompare(b.id))
  return {
    models: unique,
    count: unique.length,
    chatCount: unique.filter((m) => m.chat).length,
    visionCount: unique.filter((m) => m.vision && m.chat).length,
    source,
  }
}

export async function listModels(overrides = {}) {
  const config = resolveConfig(overrides)
  const base = normalizeBaseUrl(config.baseUrl)
  const errors = []
  let res = null
  try {
    res = await getModelsJson(`${base}/models`, config.apiKey)
  } catch (err) {
    errors.push(err.message)
  }
  if (res?.ok) {
    const models = parseOpenAIModels(res.data)
    if (models.length) return finishModelList(models, 'openai')
    errors.push('OpenAI 兼容接口返回的模型列表为空')
  } else if (res) {
    errors.push(
      `/models 返回 HTTP ${res.status}${res.status === 401 || res.status === 403 ? '（API Key 无效或无权限）' : ''}`,
    )
  }

  let host = ''
  try {
    host = new URL(base).hostname
  } catch {
    /* ignore */
  }
  if (host) {
    const origin = new URL(base).origin
    const collected = []
    const seenIds = new Set()
    let total = Infinity
    for (let page = 1; page <= 50 && collected.length < total; page += 1) {
      let pageRes = null
      try {
        pageRes = await getModelsJson(`${origin}/api/v1/models?page_no=${page}&page_size=100&language=zh-CN`, config.apiKey)
      } catch (err) {
        errors.push(err.message)
        break
      }
      if (!pageRes.ok) {
        const msg = pageRes.data?.message || pageRes.data?.code || `HTTP ${pageRes.status}`
        errors.push(`/api/v1/models 返回 ${msg}${pageRes.status === 401 || pageRes.status === 403 ? '（API Key 无效或无权限）' : ''}`)
        break
      }
      const parsed = parseDashScopeModels(pageRes.data)
      if (!parsed) {
        errors.push('百炼模型列表格式无法识别')
        break
      }
      let added = 0
      for (const m of parsed) {
        if (seenIds.has(m.id)) continue
        seenIds.add(m.id)
        collected.push(m)
        added += 1
      }
      const reportedTotal = Number(pageRes.data?.output?.total)
      total = Number.isFinite(reportedTotal) ? reportedTotal : collected.length
      if (!added) break
    }
    if (collected.length) return finishModelList(collected, 'dashscope')
  }

  throw new AIError(
    `获取模型列表失败：${errors.join('；') || '接口无响应'}。可以先手动填写模型名。`,
    'AI_MODELS_FAILED',
    502,
  )
}