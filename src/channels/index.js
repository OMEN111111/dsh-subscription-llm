/** Channel table: one module per subscription product. */
import chatgpt from './chatgpt.js'
import claude from './claude.js'
import antigravity from './antigravity.js'

/** Every supported channel, in display order. */
export const CHANNELS = [chatgpt, claude, antigravity]

/** Lookup by channel id (the value the browser sends). */
export const CHANNEL_BY_ID = new Map(CHANNELS.map(channel => [channel.id, channel]))

/** Lookup by LLM provider route (the value a model request selects). */
export const CHANNEL_BY_ROUTE = new Map(CHANNELS.map(channel => [channel.route, channel]))
