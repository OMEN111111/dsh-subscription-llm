/**
 * Provider-neutral conversion helpers shared by the three channel wirings.
 *
 * The harness speaks one message vocabulary to every adapter; each channel
 * projects that vocabulary onto its own wire format with these helpers.
 */

/**
 * The instruction text a request carries: the call-level system prompt plus the
 * leading system messages of the history.
 * @param options - harness request.
 * @returns the joined instruction text, possibly empty.
 */
export function instructionText(options) {
  const parts = []
  if (typeof options.system === 'string' && options.system.length > 0) parts.push(options.system)
  for (const message of options.messages) {
    if (message.role !== 'system') continue
    const text = blockText(message.content)
    if (text.length > 0) parts.push(text)
  }
  return parts.join('\n\n')
}

/**
 * Every history message except the leading system snapshot, which travels as
 * instruction text instead of a turn.
 * @param options - harness request.
 * @returns the conversation turns in order.
 */
export function conversation(options) {
  return options.messages.filter(message => message.role !== 'system')
}

/**
 * Concatenate the text blocks of one message content array.
 * @param blocks - harness content blocks.
 * @returns the joined text, ignoring non-text blocks.
 */
export function blockText(blocks) {
  if (typeof blocks === 'string') return blocks
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter(block => block !== null && typeof block === 'object' && block.type === 'text')
    .map(block => String(block.text ?? ''))
    .join('')
}

/**
 * The tool-call blocks of one assistant message.
 * @param blocks - harness content blocks.
 * @returns tool-call blocks in order.
 */
export function toolCalls(blocks) {
  if (!Array.isArray(blocks)) return []
  return blocks.filter(block => block !== null && typeof block === 'object' && block.type === 'tool-call')
}

/**
 * Parse durable tool arguments, tolerating a truncated history value.
 * @param raw - JSON text.
 * @returns a plain object, or an empty object when the value is not one.
 */
export function toolArguments(raw) {
  try {
    const value = JSON.parse(raw)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch (_invalidToolJson) {
    return {}
  }
}

/**
 * Tools a request declares, minus deferred ones the harness hides until asked.
 * @param options - harness request.
 * @returns plain `{name, description, parameters}` records.
 */
export function declaredTools(options) {
  const tools = options.tools
  if (!Array.isArray(tools)) return []
  return tools
    .filter(tool => tool.deferLoading !== true)
    .map(tool => ({ name: tool.name, description: tool.description ?? '', parameters: tool.parameters ?? { type: 'object', properties: {} } }))
}

/**
 * Convert one JSON schema into the protobuf-flavoured shape Gemini expects:
 * upper-case `type`, `items` on arrays, and none of the keywords it rejects.
 * @param schema - JSON schema fragment.
 * @returns a converted fragment.
 */
export function geminiSchema(schema) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'STRING' }
  }
  const converted = {}
  const type = typeof schema.type === 'string' ? schema.type.toUpperCase() : Array.isArray(schema.type) ? String(schema.type[0] ?? 'string').toUpperCase() : undefined
  if (type !== undefined && type !== 'NULL') converted.type = type === 'OBJECT' ? 'OBJECT' : type === 'ARRAY' ? 'ARRAY' : type
  if (typeof schema.description === 'string') converted.description = schema.description
  if (Array.isArray(schema.enum)) converted.enum = schema.enum.map(String)
  if (schema.properties !== null && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
    converted.properties = {}
    for (const [key, value] of Object.entries(schema.properties)) converted.properties[key] = geminiSchema(value)
    if (Array.isArray(schema.required) && schema.required.length > 0) converted.required = schema.required.map(String)
  }
  if (schema.items !== undefined) converted.items = geminiSchema(schema.items)
  if (converted.type === 'ARRAY' && converted.items === undefined) converted.items = { type: 'STRING' }
  if (converted.type === 'OBJECT' && converted.properties === undefined) converted.properties = {}
  return converted
}

/**
 * Whether a model id looks like a Gemini model (upper-case schema dialect) or an
 * Anthropic one served through the same envelope.
 * @param model - model id.
 * @returns true for Gemini ids.
 */
export function isGeminiModel(model) {
  return /^gemini/u.test(model)
}
