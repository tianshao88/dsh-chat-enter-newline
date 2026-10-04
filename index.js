// dsh-send-or-newline -- 宿主半边。
//
// 为什么需要宿主半边：在 DSH 0.2.0-rc.2 里，可持久化的插件偏好由 profile 的
// Cordis 补丁层承载，客户端通过 ctx.configForms.get(<条目 id>) 读写。命名空间的内容
// 来自这条 Loader 条目的 Config，所以偏好字段必须在这里声明，并标成 volatile ——
// 只有 volatile 字段才会进入设置表单投影、被浏览器端服务到。
//
// 本文件不注册任何服务、路由监听或定时器：唯一的动作是告诉设置服务「本插件自带
// 界面，不要为我自动生成页面」，界面由 client.js 注册进 设置 -> 通用。
import z from '@deepseek-ai/schemastery'

/** Loader 条目 id，也是 ctx.configForms 的命名空间。与 cordis.patch.yml 保持一致。 */
export const name = 'send-or-newline'

/** 每个手势可以取的两个动作。 */
const ACTIONS = ['send', 'newline']

/**
 * 默认值与引擎自己的键位表逐字一致，因此未改动偏好时本插件完全不干预输入：
 *   Enter           发送消息
 *   Shift+Enter     换行
 *   Ctrl/Cmd+Enter  发送消息
 * 客户端持有同一份默认值，用于校验线路上的值与判断「是否需要改写手势」。
 */
export const DEFAULTS = { enter: 'send', shiftEnter: 'newline', ctrlEnter: 'send' }

/** 三个手势的可编辑偏好；volatile 是进入设置表单投影的必要条件。 */
export const Config = z.object({
  enter: z.union([...ACTIONS]).default(DEFAULTS.enter).volatile(),
  shiftEnter: z.union([...ACTIONS]).default(DEFAULTS.shiftEnter).volatile(),
  ctrlEnter: z.union([...ACTIONS]).default(DEFAULTS.ctrlEnter).volatile(),
})

/**
 * 挂载宿主半边。
 * @param ctx - 宿主插件上下文。
 */
export function apply(ctx) {
  // 可选依赖：settings 服务缺席时本插件仍然加载，只是偏好没有持久化位置。
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
