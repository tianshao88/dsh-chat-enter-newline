// dsh-send-or-newline -- 纯逻辑单测。
//
// client.js 是浏览器模块（window.__ModuleLoader__ + 工厂函数），不能直接 import。
// 这里用一个假的 window 接住工厂，再用最小 require 桩调用它，取出 __test 面做断言。
// 覆盖范围刻意只包括决策逻辑：手势识别、改写决策、输入法/Alt/菜单放行，以及修饰键写回。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 极小的 React 桩：工厂只在内部保存引用，测试不渲染组件。 */
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}

/** 承接工厂的 __ModuleLoader__.load 桩。 */
let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded = definition
    },
  },
}

const source = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
// 在当前的 globalThis 上求值，让 window.__ModuleLoader__.load 收到定义。
new Function(source)()

if (loaded === null) throw new Error('client.js 没有调用 window.__ModuleLoader__.load')
if (loaded.id !== 'dsh-send-or-newline') throw new Error(`bundle id 必须等于包名，实际是 ${loaded.id}`)

const face = loaded.factory((name) => {
  if (name === 'react') return reactStub
  throw new Error(`client.js 请求了基座之外的模块：${name}`)
})
const T = face.__test
if (!T) throw new Error('client.js 没有导出 __test 面')

/**
 * 模拟 KeyboardEvent：修饰键是原型上的只读 getter（真实事件就是这样），
 * applyRewrite 必须在实例上定义一个自有属性去遮蔽它们。
 */
class FakeKeyEvent {
  constructor({ key = 'Enter', shiftKey = false, ctrlKey = false, metaKey = false, altKey = false, isComposing = false, keyCode = 13, defaultPrevented = false } = {}) {
    this._values = { key, shiftKey, ctrlKey, metaKey, altKey, isComposing, keyCode, defaultPrevented }
  }
  get key() { return this._values.key }
  get shiftKey() { return this._values.shiftKey }
  get ctrlKey() { return this._values.ctrlKey }
  get metaKey() { return this._values.metaKey }
  get altKey() { return this._values.altKey }
  get isComposing() { return this._values.isComposing }
  get keyCode() { return this._values.keyCode }
  get defaultPrevented() { return this._values.defaultPrevented }
}

let passed = 0
const failures = []

/**
 * 断言。
 * @param label - 用例名。
 * @param actual - 实际值。
 * @param expected - 期望值（深比较用 JSON）。
 */
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) passed += 1
  else failures.push(`${label}: 期望 ${b}，实际 ${a}`)
}

const { planRewrite, applyRewrite, gestureOf, ENGINE_DEFAULT } = T

// 1. 默认偏好：三种手势一次都不改写（零干预是本插件的核心性质）。
check('默认 Enter 放行', planRewrite(new FakeKeyEvent(), ENGINE_DEFAULT), null)
check('默认 Shift+Enter 放行', planRewrite(new FakeKeyEvent({ shiftKey: true }), ENGINE_DEFAULT), null)
check('默认 Ctrl+Enter 放行', planRewrite(new FakeKeyEvent({ ctrlKey: true }), ENGINE_DEFAULT), null)
check('默认 Cmd+Enter 放行', planRewrite(new FakeKeyEvent({ metaKey: true }), ENGINE_DEFAULT), null)

// 2. Enter 改成换行 -> 伪装 Shift+Enter，并清掉 Ctrl/Meta。
check('Enter 改换行', planRewrite(new FakeKeyEvent(), { ...ENGINE_DEFAULT, enter: 'newline' }), { shiftKey: true, ctrlKey: false, metaKey: false })

// 3. Shift+Enter 改成发送 -> 摘掉 Shift。
check('Shift+Enter 改发送', planRewrite(new FakeKeyEvent({ shiftKey: true }), { ...ENGINE_DEFAULT, shiftEnter: 'send' }), { shiftKey: false, ctrlKey: false, metaKey: false })

// 4. Ctrl+Enter 改成换行 -> 必须先清 Ctrl+Meta，否则引擎的 Shift+Ctrl 分支会让按键完全失效。
check('Ctrl+Enter 改换行', planRewrite(new FakeKeyEvent({ ctrlKey: true }), { ...ENGINE_DEFAULT, ctrlEnter: 'newline' }), { shiftKey: true, ctrlKey: false, metaKey: false })

// 5. Ctrl+Shift+Enter 归入 Shift 手势，跟随 shiftEnter 的设置。
check('Ctrl+Shift 跟随 Shift 默认', planRewrite(new FakeKeyEvent({ shiftKey: true, ctrlKey: true }), ENGINE_DEFAULT), null)
check('Ctrl+Shift 跟随 Shift 改发送', planRewrite(new FakeKeyEvent({ shiftKey: true, ctrlKey: true }), { ...ENGINE_DEFAULT, shiftEnter: 'send' }), { shiftKey: false, ctrlKey: false, metaKey: false })

// 6. 输入法：isComposing 与 keyCode 229 都要放行。
check('输入法 isComposing 放行', planRewrite(new FakeKeyEvent({ isComposing: true }), { ...ENGINE_DEFAULT, enter: 'newline' }), null)
check('输入法 keyCode 229 放行', planRewrite(new FakeKeyEvent({ keyCode: 229 }), { ...ENGINE_DEFAULT, enter: 'newline' }), null)

// 7. Alt 组合属于引擎自己的加速手势，一律放行。
check('Alt+Enter 放行', planRewrite(new FakeKeyEvent({ altKey: true }), { ...ENGINE_DEFAULT, enter: 'newline' }), null)

// 8. 非 Enter 键、已消费事件、畸形偏好都要放行。
check('非 Enter 放行', planRewrite(new FakeKeyEvent({ key: 'a' }), { ...ENGINE_DEFAULT, enter: 'newline' }), null)
check('已 preventDefault 放行', planRewrite(new FakeKeyEvent({ defaultPrevented: true }), { ...ENGINE_DEFAULT, enter: 'newline' }), null)
check('非法偏好值放行', planRewrite(new FakeKeyEvent(), { ...ENGINE_DEFAULT, enter: 'bogus' }), null)
check('偏好缺失放行', planRewrite(new FakeKeyEvent(), {}), null)
check('偏好为 null 放行', planRewrite(new FakeKeyEvent(), null), null)

// 9. gestureOf 的直接覆盖。
check('gestureOf Enter', gestureOf(new FakeKeyEvent()), 'enter')
check('gestureOf Shift', gestureOf(new FakeKeyEvent({ shiftKey: true })), 'shiftEnter')
check('gestureOf Cmd', gestureOf(new FakeKeyEvent({ metaKey: true })), 'ctrlEnter')
check('gestureOf Alt 为 null', gestureOf(new FakeKeyEvent({ altKey: true })), null)

// 10. 写回：原型 getter 可被实例属性遮蔽，且写回后能从事件上读回新值。
const event = new FakeKeyEvent()
const ok = applyRewrite(event, { shiftKey: true, ctrlKey: false, metaKey: false })
check('写回返回 true', ok, true)
check('写回后 shiftKey 为 true', event.shiftKey, true)
check('写回后引擎看到换行手势', gestureOf(event), 'shiftEnter')

// 11. 写回后再次决策不再改写（避免在同一事件上反复改写）。
check('写回后二次决策为 null', planRewrite(event, { ...ENGINE_DEFAULT, enter: 'newline' }), null)

// 12. 快照投影：默认值与线路值合并，缺失字段回落默认。
check('投影合并默认', T.projectForm({ status: 'ready', writable: true, value: { enter: 'newline' } }), { status: 'ready', writable: true, value: { enter: 'newline', shiftEnter: 'newline', ctrlEnter: 'send' } })
check('投影处理空值', T.projectForm({ status: 'loading', writable: false, value: undefined }).value, ENGINE_DEFAULT)

console.log(`dsh-send-or-newline: ${passed} 项通过，${failures.length} 项失败`)
for (const failure of failures) console.error(`  ✗ ${failure}`)
if (failures.length > 0) process.exitCode = 1
