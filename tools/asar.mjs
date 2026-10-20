// tools/asar.mjs -- 只读检查打包后的 DSH（app.asar）。
//
// 为什么需要它：DSH 装到本机时实现代码全在 app.asar 里，PowerShell、ripgrep 都读不进去。
// 本插件依赖四处引擎契约（见 AGENTS.md），DSH 升级后要用这个工具重新核对，不要靠记忆。
//
// 用法：
//   node tools/asar.mjs check                     # 逐条核对本插件依赖的引擎契约
//   node tools/asar.mjs list   [过滤串] [输出文件]  # 列出归档内文件
//   node tools/asar.mjs grep   <正则> [路径过滤]    # 在归档内按行搜索
//   node tools/asar.mjs extract <输出目录> [过滤串]  # 提取文件到目录
//   node tools/asar.mjs versions                  # 打印关键引擎包版本
//
// 归档路径默认取 $DSH_ASAR，否则用下面的 DEFAULT_ARCHIVE；也可以用 --archive=<路径> 覆盖。
import { readFileSync, writeFileSync, mkdirSync, openSync, readSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DEFAULT_ARCHIVE = 'D:\\Tools\\DeepSeek\\resources\\app.asar'

const argv = process.argv.slice(2)
const archiveArg = argv.find((value) => value.startsWith('--archive='))
const args = argv.filter((value) => !value.startsWith('--archive='))
const mode = args[0] ?? 'check'
const archive = archiveArg?.slice('--archive='.length) ?? process.env.DSH_ASAR ?? DEFAULT_ARCHIVE

// ---- 归档读取 ----

/** 读 asar 头，返回条目索引与文件数据起始偏移。 */
function readIndex(path) {
  const fd = openSync(path, 'r')
  const sizeBuf = Buffer.alloc(8)
  readSync(fd, sizeBuf, 0, 8, 0)
  const headerSize = sizeBuf.readUInt32LE(4)
  const headerBuf = Buffer.alloc(headerSize)
  readSync(fd, headerBuf, 0, headerSize, 8)
  // pickle 布局：4 字节载荷长度，4 字节字符串长度，随后是 JSON。
  const json = headerBuf.slice(8, 8 + headerBuf.readUInt32LE(4)).toString('utf8')
  const entries = []
  const walk = (node, prefix) => {
    for (const [name, meta] of Object.entries(node.files ?? {})) {
      const entryPath = prefix === '' ? name : `${prefix}/${name}`
      if (meta.files !== undefined) walk(meta, entryPath)
      else entries.push({ path: entryPath, size: Number(meta.size), offset: Number(meta.offset), unpacked: meta.unpacked === true })
    }
  }
  walk(JSON.parse(json), '')
  return { fd, entries, base: 8 + headerSize }
}

const { fd, entries, base } = readIndex(archive)

/** 读取一个未 unpacked 条目的完整内容。 */
function readEntry(entry) {
  const buf = Buffer.alloc(entry.size)
  readSync(fd, buf, 0, entry.size, base + entry.offset)
  return buf.toString('utf8')
}

/** 取出唯一匹配的条目；多于一个时取路径最短的。 */
function entry(suffix) {
  const matched = entries.filter((candidate) => candidate.path.endsWith(suffix))
  if (matched.length === 0) return undefined
  return matched.sort((a, b) => a.path.length - b.path.length)[0]
}

// ---- 各子命令 ----

function listAll(filter, outFile) {
  const matched = filter === '' ? entries : entries.filter((candidate) => candidate.path.includes(filter))
  const lines = [`total=${entries.length} matched=${matched.length}`]
  for (const candidate of matched) lines.push(`${candidate.size}\t${candidate.path}`)
  if (outFile !== undefined) writeFileSync(outFile, lines.join('\n'), 'utf8')
  else console.log(lines.join('\n'))
}

function grepAll(pattern, pathFilter) {
  const re = new RegExp(pattern)
  let hits = 0
  for (const candidate of entries) {
    if (candidate.unpacked || candidate.size > 8 * 1024 * 1024) continue
    if (pathFilter !== '' && !candidate.path.includes(pathFilter)) continue
    const lines = readEntry(candidate).split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      if (re.test(lines[index])) {
        console.log(`${candidate.path}:${index + 1}: ${lines[index].trim().slice(0, 200)}`)
        hits += 1
        if (hits >= 80) {
          console.log('... 命中过多，已截断；请收窄正则或路径过滤')
          return
        }
      }
    }
  }
  if (hits === 0) console.log('无命中')
}

function extractAll(outDir, filter) {
  let written = 0
  for (const candidate of entries) {
    if (candidate.unpacked) continue
    if (filter !== '' && !candidate.path.includes(filter)) continue
    const dest = join(outDir, candidate.path)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, readEntry(candidate))
    written += 1
  }
  console.log(`已提取 ${written} 个文件到 ${outDir}`)
}

function versions() {
  const names = [
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-modules',
    '@deepseek-ai/schemastery',
  ]
  for (const name of names) {
    const found = entry(`node_modules/${name}/package.json`)
    if (found === undefined) {
      console.log(`${name}: 未找到`)
      continue
    }
    const manifest = JSON.parse(readEntry(found))
    console.log(`${name}: ${manifest.version}`)
  }
}

/**
 * 逐条核对本插件依赖的引擎契约。
 * 每项声明：名字、要读的包内文件后缀、必须命中的片段（全部命中才算通过）。
 */
function check() {
  const contracts = [
    ['输入框可编辑面 [data-composer-input]', 'dsh-client-ui-conversation/lib/client.js', ['"data-composer-input": true']],
    ['输入框卡片 [data-composer-card]', 'dsh-client-ui-conversation/lib/client.js', ['"data-composer-card": true']],
    ['触发器菜单 [data-trigger-menu]', 'dsh-client-ui-input-trigger/lib/client.js', ['"data-trigger-menu"']],
    ['Enter 的 Shift 分流（换行而非提交）', 'dsh-client-ui-conversation/lib/client.js', ['shiftKey === true) return false']],
    ['configForms: whileServed/getSnapshot/set', 'dsh-client-ui-settings/lib/client.js', ['whileServed(namespaces', 'getSnapshot()', 'set(field, value)']],
    ['hooks 隔舱 -> use<Name> 选择器钩子', 'dsh-client-ui-renderer/lib/client.js', ['standardHookPropName', 'observableHook(']],
    ['schemastery 的 volatile()', '@deepseek-ai/schemastery/lib/index.mjs', ['volatile']],
  ]
  let failed = 0
  for (const [label, suffix, needles] of contracts) {
    const found = entry(suffix)
    if (found === undefined) {
      console.log(`✗ ${label} -- 找不到 ${suffix}`)
      failed += 1
      continue
    }
    const text = readEntry(found)
    const missing = needles.filter((needle) => !text.includes(needle))
    if (missing.length === 0) console.log(`✓ ${label}`)
    else {
      console.log(`✗ ${label} -- ${suffix} 中缺少：${missing.join(' | ')}`)
      failed += 1
    }
  }
  // settings.general.item 槽位由 ui-settings-general 在运行时声明，两个包任一命中即可。
  const slotOwners = ['dsh-client-ui-settings-general/lib/client.js', 'dsh-client-ui-settings/lib/client.js']
  const slotFound = slotOwners.some((suffix) => {
    const found = entry(suffix)
    return found !== undefined && readEntry(found).includes('settings.general.item')
  })
  if (slotFound) console.log('✓ settings.general.item 槽位')
  else {
    console.log('✗ settings.general.item 槽位 -- 两个候选包中都没有该字符串')
    failed += 1
  }

  console.log('')
  versions()
  console.log('')
  if (failed === 0) console.log('全部契约通过；当前 DSH 与 dsh-chat-enter-newline 兼容。')
  else console.log(`${failed} 项契约未通过：先读 AGENTS.md 的「依赖的引擎契约」，再改插件。`)
  process.exitCode = failed === 0 ? 0 : 1
}

switch (mode) {
  case 'list':
    listAll(args[1] ?? '', args[2])
    break
  case 'grep':
    if (args[1] === undefined) throw new Error('grep 需要正则参数')
    grepAll(args[1], args[2] ?? '')
    break
  case 'extract':
    if (args[1] === undefined) throw new Error('extract 需要输出目录')
    extractAll(args[1], args[2] ?? '')
    break
  case 'versions':
    versions()
    break
  case 'check':
    check()
    break
  default:
    throw new Error(`未知子命令：${mode}（可用：check / list / grep / extract / versions）`)
}
