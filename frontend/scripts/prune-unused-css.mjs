/**
 * Удаляет из CSS-файла страницы правила, чьи классы больше не встречаются в
 * исходниках, к которым этот CSS относится (шаблон, скрипт, строки классов).
 *
 *   node scripts/prune-unused-css.mjs src/pages/TasksPage.css src/pages/TasksPage.vue [ещё .vue …] [--dry]
 *
 * Правило удаляется, только если КАЖДЫЙ селектор в нём содержит хотя бы один
 * класс, которого нет ни в одном из перечисленных файлов. Правила без классов
 * (теги, :root, @font-face), @keyframes и всё, что не удалось разобрать, не трогаются.
 * Пустые @media после чистки удаляются.
 */
import fs from 'node:fs'
import postcss from 'postcss'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const [cssPath, ...sources] = args.filter((a) => a !== '--dry')
if (!cssPath || !sources.length) {
  console.error('usage: prune-unused-css.mjs <file.css> <source.vue> [...] [--dry]')
  process.exit(1)
}

const tokens = new Set()
for (const src of sources) {
  for (const m of fs.readFileSync(src, 'utf8').matchAll(/[A-Za-z_][\w-]*/g)) tokens.add(m[0])
}

const classesOf = (selector) =>
  [...selector.replace(/:(deep|global|slotted)\(/g, '(').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])

const root = postcss.parse(fs.readFileSync(cssPath, 'utf8'))
let removed = 0
let kept = 0
root.walkRules((rule) => {
  if (rule.parent?.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return
  const dead = rule.selectors.every((sel) => {
    const cls = classesOf(sel)
    return cls.length > 0 && cls.some((c) => !tokens.has(c))
  })
  if (dead) {
    removed++
    rule.remove()
  } else kept++
})
root.walkAtRules((at) => {
  if (at.nodes && at.nodes.length === 0) at.remove()
})

const before = fs.readFileSync(cssPath, 'utf8').split('\n').length
const out = root.toString().replace(/\n{3,}/g, '\n\n')
console.log(`${cssPath}: правил удалено ${removed}, оставлено ${kept}; строк ${before} → ${out.split('\n').length}`)
if (!dry) fs.writeFileSync(cssPath, out)
