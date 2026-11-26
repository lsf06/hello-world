export const SECTIONS = [
  { key: '短篇新闻', group: '听力', color: '#6366F1' },
  { key: '长对话', group: '听力', color: '#8B5CF6' },
  { key: '听力篇章', group: '听力', color: '#A855F7' },
  { key: '选词填空', group: '阅读', color: '#0EA5E9' },
  { key: '长篇匹配', group: '阅读', color: '#06B6D4' },
  { key: '仔细阅读', group: '阅读', color: '#0D9488' },
  { key: '写作', group: '写作', color: '#E85D2A' },
  { key: '翻译', group: '翻译', color: '#C2410C' },
  { key: '其他', group: '其他', color: '#64748B' },
]

export const SECTION_MAP = Object.fromEntries(SECTIONS.map((s) => [s.key, s]))

export const QUESTION_SECTIONS = SECTIONS.map((s) => s.key)

export const ERROR_TAGS = [
  '定位错误',
  '同义替换未识别',
  '词汇不认识',
  '长难句看不懂',
  '绝对化选项误选',
  '过度推断',
  '时间不够',
  '粗心',
  '听音辨词错误',
  '连读/语速不适',
  '干扰项误选',
  '语法/词性',
  '上下文逻辑',
  '主旨概括错误',
  '主谓一致',
  '时态',
  '冠词',
  '单复数',
  '拼写',
  '搭配',
  '中式英语',
  '连接词单一',
  '句式单调',
  '词汇重复',
  '要点遗漏',
  '字数不足',
  '跑题',
  '漏译',
  '词性误用',
  '句子结构',
]

export const TIMER_PRESETS = {
  writing: {
    key: 'writing',
    label: '写作',
    section: '写作',
    minutes: 30,
    color: '#E85D2A',
    desc: '30 分钟写满 120 词，套模板，写完不再改。',
    tips: ['先花 2 分钟看题、列框架', '三段式：现象 + 两个理由 + 结论', '最后 5 分钟只查拼写、单复数、时态', '不要现场造难句，模板句直接用'],
  },
  listening: {
    key: 'listening',
    label: '听力',
    section: '听力',
    minutes: 25,
    color: '#8B5CF6',
    desc: '25 分钟 25 题，边听边涂卡，没听清就放过。',
    tips: ['播放间隙先看选项，圈名词和动词', '答案常在 but / so / 最高级后面', '长对话答案多在回答的那句', '新闻重点听第一句'],
  },
  reading: {
    key: 'reading',
    label: '阅读',
    section: '阅读',
    minutes: 40,
    color: '#0D9488',
    desc: '40 分钟固定顺序：仔细阅读 → 长篇匹配 → 选词填空。',
    tips: ['仔细阅读 20 分钟：先看题干，不看选项', '匹配 12 分钟：划专有名词和数字', '选词 8 分钟：先标词性，不恋战', '原文没说的，一律不选'],
    segments: [
      { name: '仔细阅读', minutes: 20 },
      { name: '长篇匹配', minutes: 12 },
      { name: '选词填空', minutes: 8 },
    ],
  },
  translation: {
    key: 'translation',
    label: '翻译',
    section: '翻译',
    minutes: 30,
    color: '#C2410C',
    desc: '30 分钟一段汉译英，先写主干，不会的词换简单词。',
    tips: ['先圈每句的信息点，不漏译', '先写主谓宾，再补修饰', '不会的词换简单同义词，不要空着', '全文时态统一，主谓一致'],
  },
  full: {
    key: 'full',
    label: '整卷模考',
    section: '整卷',
    minutes: 125,
    color: '#17202E',
    desc: '写作 → 听力 → 阅读 → 翻译，严格 125 分钟，中途不许停。',
    tips: ['手机放远一点，中途不许暂停', '每个板块到点就收，不回头', '听力边听边涂卡', '按 9:10 开考模拟真实节奏'],
    segments: [
      { name: '写作', minutes: 30, key: 'writing' },
      { name: '听力', minutes: 25, key: 'listening' },
      { name: '阅读', minutes: 40, key: 'reading' },
      { name: '翻译', minutes: 30, key: 'translation' },
    ],
  },
}

export const AI_PRESETS = [
  {
    id: 'qwen',
    name: '通义千问 · 百炼按量计费（推荐）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    textModel: 'qwen-plus',
    visionModel: 'qwen-vl-max',
  },
  {
    id: 'bailian-token-plan',
    name: '阿里百炼 Token Plan（北京）',
    baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    textModel: '',
    visionModel: '',
  },
  {
    id: 'bailian-token-plan-intl',
    name: '阿里百炼 Token Plan（新加坡）',
    baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    textModel: '',
    visionModel: '',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM（支持图片）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    textModel: 'glm-4-plus',
    visionModel: 'glm-4v-plus',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow（支持图片）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    textModel: 'Qwen/Qwen2.5-72B-Instruct',
    visionModel: 'Qwen/Qwen2-VL-72B-Instruct',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    textModel: 'gpt-4o-mini',
    visionModel: 'gpt-4o-mini',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek（deepseek-flash 支持图片）',
    baseUrl: 'https://api.deepseek.com/v1',
    textModel: 'deepseek-chat',
    visionModel: 'deepseek-flash',
  },
  {
    id: 'custom',
    name: '自定义 OpenAI 兼容接口',
    baseUrl: '',
    textModel: '',
    visionModel: '',
  },
]

export const GATES = [
  {
    id: 1,
    date: '2026-11-21',
    name: '闸门① · 拆分模考',
    criteria: '听力 ≥ 110 / 阅读 ≥ 100',
    detail: '零基础基线分，只用来定位短板。',
  },
  {
    id: 2,
    date: '2026-11-28',
    name: '闸门② · 拆分模考',
    criteria: '听力 ≥ 125 / 阅读 ≥ 120 / 翻译 ≥ 55',
    detail: '不达标就砍选词填空和高级词，时间给仔细阅读和听力。',
  },
  {
    id: 3,
    date: '2026-11-29',
    name: '闸门③ · 全真模拟①',
    criteria: '总分 ≥ 360',
    detail: '第一次整套，允许低；重点看时间够不够。',
  },
  {
    id: 4,
    date: '2026-12-05',
    name: '闸门④ · 全真模拟②',
    criteria: '总分 ≥ 420，且四板块都不低于目标分 70%',
    detail: '单块塌方就降到“只做会做的”，保总分。',
  },
  {
    id: 5,
    date: '2026-12-06',
    name: '闸门⑤ · 全真模拟③',
    criteria: '总分 ≥ 440',
    detail: '连续两次不到 420，切“保 425 打法”。',
  },
  {
    id: 6,
    date: '2026-12-10',
    name: '闸门⑥ · 考前终检',
    criteria: '模板闭卷默写 2 套、听力 1 套、结构说清',
    detail: '模板默不出就只背议论模板，书信硬套结构。',
    manual: true,
  },
]

export const WRITING_TIPS = [
  '三段式：现象/观点 → 两个理由 → 结论，不跑题。',
  '开头结尾各点一次题目关键词。',
  'important → vital，help → benefit，good → beneficial。',
  '写完留 5 分钟只查：拼写、单复数、主谓一致、时态。',
]

export const TRANSLATION_TIPS = [
  '先写简单句，保证每句都有主谓。',
  '不会的词换简单同义词，绝不空着。',
  '源远流长 → have a long history。',
  '先圈信息点，逐点翻译，避免漏译。',
]

export const SECTION_TARGET = {
  写作: 80,
  听力: 165,
  阅读: 165,
  翻译: 70,
}