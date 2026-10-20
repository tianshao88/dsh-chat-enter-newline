// dsh-chat-enter-newline -- 浏览器半边。
//
// 两件事：
//   1. 按用户偏好重新解释输入框里的 Enter 手势；
//   2. 在 设置 -> 通用 增加一行「输入快捷键」。
//
// 重映射方式：在 document 捕获阶段改写原事件上的 shiftKey / ctrlKey / metaKey，
// 让引擎自己读到另一种手势。事件保持可信、不 preventDefault、不阻断传播，引擎仍然
// 握有「发送」和「换行」的语义。依据是引擎 composer 的 Enter 判定
// （dsh-client-ui-conversation/lib/client.js）：shiftKey 为真直接走换行，否则走提交，
// 而 Ctrl/Meta+Enter 走同一条提交路径。
//
// 偏好等于引擎默认时不做任何改写，因此未配置时干预次数为 0。
//
// 只依赖 react（浏览器模块表的基座模块）。刻意不 require 任何引擎客户端包：官方
// practices 明确禁止，且它们的导出会随版本变化。
window.__ModuleLoader__.load({
  id: 'dsh-chat-enter-newline',
  factory: (require) => {
    const React = require('react')

    /** 本插件的 locale 命名空间。 */
    const NS = 'chat-enter-newline'
    /** Loader 条目 id，也是 ctx.configForms 的命名空间；与 cordis.patch.yml 一致。 */
    const ENTRY_ID = 'chat-enter-newline'
    /** 引擎的输入框可编辑面。 */
    const COMPOSER_SELECTOR = '[data-composer-input="true"]'
    /** 拥有输入框与其 overlay 席位的卡片。 */
    const CARD_SELECTOR = '[data-composer-card]'
    /** '/' 与 '@' 菜单，展开期间渲染在卡片的 overlay 席位里。 */
    const TRIGGER_MENU_SELECTOR = '[data-trigger-menu]'

    /** 每个手势可以取的两个动作。 */
    const ACTIONS = ['send', 'newline']
    /** 引擎自己的键位表，也是本插件 Config 的默认值。 */
    const ENGINE_DEFAULT = { enter: 'send', shiftEnter: 'newline', ctrlEnter: 'send' }
    /** 设置行的控件顺序。 */
    const GESTURES = [
      { key: 'enter', labelKey: 'gestureEnter' },
      { key: 'shiftEnter', labelKey: 'gestureShiftEnter' },
      { key: 'ctrlEnter', labelKey: 'gestureCtrlEnter' },
    ]

    // ---- 纯逻辑：手势识别与改写决策（test.mjs 直接覆盖这一段） ----

    /**
     * 事件是否属于输入法组合，属于则绝不触碰。
     * @param event - keydown 事件。
     * @returns 是否处于输入法组合。
     */
    function isComposing(event) {
      return event.isComposing === true || event.keyCode === 229
    }

    /**
     * 事件代表三个可配置手势中的哪一个。
     * Alt 组合不是我们的：那是引擎自己的加速手势，原样放行。
     * Shift 优先于 Ctrl，与引擎键位表一致（Ctrl+Shift+Enter 因此归入 Shift 手势）。
     * @param event - keydown 事件。
     * @returns 手势键，或 null 表示不是我们的。
     */
    function gestureOf(event) {
      if (event.key !== 'Enter') return null
      if (event.altKey) return null
      if (event.shiftKey) return 'shiftEnter'
      if (event.ctrlKey || event.metaKey) return 'ctrlEnter'
      return 'enter'
    }

    /**
     * 让引擎执行 `action` 所需的修饰键状态。
     * 发送一律化为不带修饰键的普通 Enter；换行一律化为 Shift+Enter（清掉 Ctrl/Meta，
     * 否则引擎键位表里 Shift+Ctrl 那条会先命中而什么都不做）。
     * @param action - send 或 newline。
     * @returns 需要写回事件的修饰键。
     */
    function rewriteFor(action) {
      return action === 'newline'
        ? { shiftKey: true, ctrlKey: false, metaKey: false }
        : { shiftKey: false, ctrlKey: false, metaKey: false }
    }

    /**
     * 判断一次 keydown 是否需要改写。
     * @param event - keydown 事件。
     * @param prefs - 当前偏好。
     * @returns null 表示放行，否则给出要写回的修饰键。
     */
    function planRewrite(event, prefs) {
      if (event === null || typeof event !== 'object') return null
      if (event.defaultPrevented === true) return null
      if (isComposing(event)) return null
      const gesture = gestureOf(event)
      if (gesture === null) return null
      const wanted = prefs === null || prefs === undefined ? undefined : prefs[gesture]
      if (!ACTIONS.includes(wanted)) return null
      // 引擎本来就这么做：不做任何改写，保持零干预。
      if (wanted === ENGINE_DEFAULT[gesture]) return null
      return rewriteFor(wanted)
    }

    /**
     * 把修饰键写回原事件。失败时返回 false，调用方放行原事件。
     * @param event - keydown 事件。
     * @param modifiers - planRewrite 给出的修饰键。
     * @returns 是否确认写回生效。
     */
    function applyRewrite(event, modifiers) {
      try {
        for (const name of Object.keys(modifiers)) {
          Object.defineProperty(event, name, { value: modifiers[name], configurable: true })
        }
        return (
          event.shiftKey === modifiers.shiftKey &&
          event.ctrlKey === modifiers.ctrlKey &&
          event.metaKey === modifiers.metaKey
        )
      } catch {
        return false
      }
    }

    /**
     * '/' 与 '@' 菜单是否正在展开：展开时 Enter 属于菜单选择，必须放行。
     * @param target - keydown 的事件目标。
     * @returns 菜单是否可见。
     */
    function menuOpen(target) {
      const card = target.closest(CARD_SELECTOR)
      const scope = card === null ? document : card
      const menu = scope.querySelector(TRIGGER_MENU_SELECTOR)
      return menu instanceof Element && menu.getClientRects().length > 0
    }

    // ---- 极简可观测量：getSnapshot 引用稳定，供 hooks 隔舱转成 useKeys ----

    /**
     * 建立一个不可变快照存储。
     * @param initial - 初始快照。
     * @returns getSnapshot / subscribe / set。
     */
    function createStore(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set(next) {
          snapshot = next
          for (const listener of [...listeners]) listener()
        },
      }
    }

    /** 把设置表单快照折叠成设置行需要的那几个字段。 */
    function projectForm(snapshot) {
      const section = snapshot.value === undefined || snapshot.value === null ? {} : snapshot.value
      return {
        status: snapshot.status,
        writable: snapshot.writable === true,
        value: { ...ENGINE_DEFAULT, ...section },
      }
    }

    /** 判断两次投影是否等价，避免无意义的重渲染。 */
    function sameProjection(a, b) {
      return (
        a.status === b.status &&
        a.writable === b.writable &&
        a.value.enter === b.value.enter &&
        a.value.shiftEnter === b.value.shiftEnter &&
        a.value.ctrlEnter === b.value.ctrlEnter
      )
    }

    const zh = {
      __lang: 'zh-CN',
      title: '输入快捷键',
      desc: '设置 Enter / Shift+Enter / Ctrl+Enter 是发送消息还是换行（macOS 上 Ctrl 为 ⌘）',
      gestureEnter: 'Enter',
      gestureShiftEnter: 'Shift + Enter',
      gestureCtrlEnter: 'Ctrl + Enter',
      actionSend: '发送消息',
      actionNewline: '换行',
      unavailable: '设置服务未连接，暂时无法修改',
      saveFailed: '保存失败，已保留原值',
    }

    const en = {
      __lang: 'en-US',
      title: 'Composer keys',
      desc: 'Choose whether Enter / Shift+Enter / Ctrl+Enter sends the message or inserts a line break (⌘ on macOS)',
      gestureEnter: 'Enter',
      gestureShiftEnter: 'Shift + Enter',
      gestureCtrlEnter: 'Ctrl + Enter',
      actionSend: 'Send message',
      actionNewline: 'Line break',
      unavailable: 'Settings are not connected, so this cannot be changed right now',
      saveFailed: 'Could not save -- the previous value was kept',
    }

    /** 行样式：只用 Inspect 列出的主题 token，浅色深色自动跟随。 */
    const ROW_CSS = [
      '.dsh-cen-row{display:flex;align-items:flex-start;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.dsh-cen-text{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0;padding-right:48px}',
      '.dsh-cen-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}',
      '.dsh-cen-desc{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400;line-height:18px}',
      '.dsh-cen-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}',
      '.dsh-cen-controls{display:flex;flex-direction:column;gap:8px;flex:none}',
      '.dsh-cen-line{display:flex;align-items:center;gap:12px;justify-content:flex-end}',
      '.dsh-cen-key{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap}',
      '.dsh-cen-seg{display:inline-flex;gap:2px;padding:2px;border-radius:18px;background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-cen-seg button{height:32px;padding:0 12px;border:none;border-radius:16px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}',
      '.dsh-cen-seg button:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '.dsh-cen-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 .5px var(--dsw-alias-border-l1)}',
      '.dsh-cen-seg button:disabled{opacity:.6;cursor:default}',
      '.dsh-cen-seg button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
    ].join('')

    /**
     * 一个手势的控件：两段式选择，不引入弹层与定位逻辑。
     * @returns 行内的一组控件。
     */
    function GestureControl(props) {
      const { gesture, value, disabled, onPick, t } = props
      return React.createElement(
        'div',
        { className: 'dsh-cen-line' },
        React.createElement('span', { className: 'dsh-cen-key' }, t(gesture.labelKey)),
        React.createElement(
          'span',
          { className: 'dsh-cen-seg', role: 'group', 'aria-label': `${t('title')} ${t(gesture.labelKey)}` },
          ACTIONS.map((action) =>
            React.createElement(
              'button',
              {
                key: action,
                type: 'button',
                'aria-pressed': value === action,
                disabled,
                onClick: () => onPick(action),
              },
              t(action === 'send' ? 'actionSend' : 'actionNewline'),
            ),
          ),
        ),
      )
    }

    /**
     * 设置 -> 通用 的一行。
     * @param props - useKeys 选择器钩子、setKey 写入函数，以及 locale 提供的 t。
     * @returns 行内容。
     */
    function EnterKeysRow(props) {
      const { useKeys, setKey, t } = props
      const state = useKeys((snapshot) => snapshot)
      const [failed, setFailed] = React.useState(false)
      const disabled = state.status !== 'ready' || state.writable !== true

      const onPick = (key) => (action) => {
        void setKey(key, action).then((ok) => setFailed(ok !== true))
      }

      return React.createElement(
        'div',
        { className: 'dsh-cen-row' },
        React.createElement('style', { dangerouslySetInnerHTML: { __html: ROW_CSS } }),
        React.createElement(
          'div',
          { className: 'dsh-cen-text' },
          React.createElement('div', { className: 'dsh-cen-title' }, t('title')),
          React.createElement(
            'div',
            { className: 'dsh-cen-desc' },
            disabled && state.status === 'unavailable' ? t('unavailable') : t('desc'),
          ),
          failed ? React.createElement('div', { className: 'dsh-cen-error' }, t('saveFailed')) : null,
        ),
        React.createElement(
          'div',
          { className: 'dsh-cen-controls' },
          GESTURES.map((gesture) =>
            React.createElement(GestureControl, {
              key: gesture.key,
              gesture,
              value: state.value[gesture.key],
              disabled,
              onPick: onPick(gesture.key),
              t,
            }),
          ),
        ),
      )
    }

    /** 必需服务。 */
    const inject = ['slots', 'locale', 'configForms']

    /**
     * 挂载浏览器半边。
     * @param ctx - 浏览器插件上下文。
     */
    function apply(ctx) {
      const store = createStore({
        status: 'loading',
        writable: false,
        value: { ...ENGINE_DEFAULT },
      })
      let form = null

      /** 把设置表单的最新快照折进 store。 */
      const adopt = () => {
        if (form === null) return
        const next = projectForm(form.getSnapshot())
        if (sameProjection(store.getSnapshot(), next)) return
        store.set(next)
      }

      // 表单在首次 render 前就绑好，设置行的 hooks 隔舱需要一个稳定的可观测量。
      form = ctx.configForms.get(ENTRY_ID)
      adopt()
      ctx.effect(() => {
        const unsubscribe = form.subscribe(adopt)
        return () => {
          unsubscribe()
          void form.dispose()
        }
      }, 'chat-enter-newline: form subscription')

      /** 写一个手势的偏好；Host 拒绝时返回 false。 */
      const setKey = (key, action) => {
        if (form === null) return Promise.resolve(false)
        return form.set(key, action).then(
          (ok) => ok === true,
          () => false,
        )
      }

      // 键盘重映射。不依赖设置服务：命名空间未服务时快照停在默认值，干预次数为 0。
      ctx.effect(() => {
        const onKeyDown = (event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          if (target.closest(COMPOSER_SELECTOR) === null) return
          const plan = planRewrite(event, store.getSnapshot().value)
          if (plan === null) return
          // 菜单展开时 Enter 归菜单，放行。
          if (menuOpen(target)) return
          applyRewrite(event, plan)
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, 'chat-enter-newline: key remap')

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'chat-enter-newline: dictionaries')

      // 命名空间被 Host 服务后才注册设置行：没有设置服务的部署看不到任何痕迹。
      ctx.effect(
        () =>
          ctx.configForms.whileServed([ENTRY_ID], () =>
            ctx.slots.inject('settings.general.item', () =>
              ctx.slots.register(
                {
                  name: 'settings.general.item',
                  id: ENTRY_ID,
                  // 引擎自己的输入行为行在 20，紧跟其后。
                  order: 21,
                  locale: NS,
                  inject: () => ({ hooks: { keys: store }, setKey }),
                },
                EnterKeysRow,
              ),
            ),
          ),
        'chat-enter-newline: settings row',
      )
    }

    const name = ENTRY_ID

    return {
      name,
      inject,
      apply,
      // test.mjs 用；运行时不读取这些字段。
      __test: { ACTIONS, ENGINE_DEFAULT, GESTURES, NS, ENTRY_ID, COMPOSER_SELECTOR, TRIGGER_MENU_SELECTOR, gestureOf, planRewrite, rewriteFor, applyRewrite, isComposing, createStore, projectForm, sameProjection },
    }
  },
})
