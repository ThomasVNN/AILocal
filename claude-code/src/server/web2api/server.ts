import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'

const DEFAULT_HOST = process.env.CLAUDE_CODE_WEB2API_HOST ?? '127.0.0.1'
const DEFAULT_PORT = Number.parseInt(process.env.CLAUDE_CODE_WEB2API_PORT ?? '3010', 10)
const API_AUTH_TOKEN = process.env.CLAUDE_CODE_WEB2API_AUTH_TOKEN
const CORS_ORIGIN = process.env.CLAUDE_CODE_WEB2API_CORS_ORIGIN ?? '*'
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'

const DEFAULT_SONNET_MODEL = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? 'claude-sonnet-4-6'
const DEFAULT_OPUS_MODEL = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? 'claude-opus-4-6'
const DEFAULT_HAIKU_MODEL = process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001'
const DEFAULT_MAIN_MODEL = DEFAULT_SONNET_MODEL

const PUBLIC_MODEL_IDS = [
	'claude-3-5-haiku-20241022',
	'claude-3-5-sonnet-20241022',
	'claude-3-7-sonnet-20250219',
	'claude-haiku-4-5-20251001',
	'claude-sonnet-4-20250514',
	'claude-sonnet-4-5-20250929',
	'claude-sonnet-4-6',
	'claude-opus-4-20250514',
	'claude-opus-4-1-20250805',
	'claude-opus-4-5-20251101',
	'claude-opus-4-6',
] as const

type JsonRecord = Record<string, unknown>

type NormalizedMessages = {
	messages: Array<{ role: 'user' | 'assistant'; content: string }>
	system: string | undefined
}

function setCorsHeaders(res: ServerResponse): void {
	res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
	res.setHeader(
		'Access-Control-Allow-Headers',
		'Authorization, Content-Type, anthropic-version, x-api-key',
	)
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

function json(res: ServerResponse, status: number, payload: unknown): void {
	setCorsHeaders(res)
	res.statusCode = status
	res.setHeader('Content-Type', 'application/json; charset=utf-8')
	res.end(JSON.stringify(payload))
}

function sendSSE(res: ServerResponse, payload: unknown, eventName?: string): void {
	if (eventName) {
		res.write(`event: ${eventName}\n`)
	}
	const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
	res.write(`data: ${data}\n\n`)
}

function formatError(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}

function beginSSE(res: ServerResponse): void {
	setCorsHeaders(res)
	res.statusCode = 200
	res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
	res.setHeader('Cache-Control', 'no-cache, no-transform')
	res.setHeader('Connection', 'keep-alive')
	res.flushHeaders()
}

function getBearerToken(req: IncomingMessage): string | null {
	const authHeader = req.headers.authorization
	if (!authHeader) return null
	const match = authHeader.match(/^Bearer\s+(.+)$/i)
	return match?.[1]?.trim() ?? null
}

function isAuthorized(req: IncomingMessage): boolean {
	if (!API_AUTH_TOKEN) return true
	const bearer = getBearerToken(req)
	if (bearer === API_AUTH_TOKEN) return true
	const apiKey = req.headers['x-api-key']
	return typeof apiKey === 'string' && apiKey === API_AUTH_TOKEN
}

async function readJsonBody(req: IncomingMessage): Promise<JsonRecord> {
	const chunks: Buffer[] = []
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
	}
	if (chunks.length === 0) {
		return {}
	}
	const raw = Buffer.concat(chunks).toString('utf8').trim()
	if (!raw) return {}
	return JSON.parse(raw) as JsonRecord
}

function getClaudeConfigDir(): string {
	return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
}

function getMacOsCredentialsServiceName(): string {
	const configDir = getClaudeConfigDir()
	const isDefaultDir = !process.env.CLAUDE_CONFIG_DIR
	const dirHash = isDefaultDir
		? ''
		: `-${createHash('sha256').update(configDir).digest('hex').slice(0, 8)}`
	return `Claude Code-credentials${dirHash}`
}

function readOAuthTokenFromCredentialsFile(): string | null {
	try {
		const raw = readFileSync(join(getClaudeConfigDir(), '.credentials.json'), 'utf8')
		const parsed = JSON.parse(raw) as {
			claudeAiOauth?: { accessToken?: string }
		}
		return parsed.claudeAiOauth?.accessToken ?? null
	} catch {
		return null
	}
}

function readOAuthTokenFromKeychain(): string | null {
	if (process.platform !== 'darwin') {
		return null
	}

	try {
		const username = process.env.USER || userInfo().username || 'claude-code-user'
		const raw = execFileSync(
			'security',
			['find-generic-password', '-a', username, '-w', '-s', getMacOsCredentialsServiceName()],
			{ encoding: 'utf8' },
		).trim()
		if (!raw) {
			return null
		}
		const parsed = JSON.parse(raw) as {
			claudeAiOauth?: { accessToken?: string }
		}
		return parsed.claudeAiOauth?.accessToken ?? null
	} catch {
		return null
	}
}

function resolveUpstreamAuth():
	| { mode: 'apiKey'; apiKey: string; source: string }
	| { mode: 'oauth'; authToken: string; source: string } {
	if (process.env.ANTHROPIC_API_KEY) {
		return {
			mode: 'apiKey',
			apiKey: process.env.ANTHROPIC_API_KEY,
			source: 'ANTHROPIC_API_KEY',
		}
	}

	if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
		return {
			mode: 'oauth',
			authToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
			source: 'CLAUDE_CODE_OAUTH_TOKEN',
		}
	}

	if (process.env.ANTHROPIC_AUTH_TOKEN) {
		return {
			mode: 'oauth',
			authToken: process.env.ANTHROPIC_AUTH_TOKEN,
			source: 'ANTHROPIC_AUTH_TOKEN',
		}
	}

	const fileToken = readOAuthTokenFromCredentialsFile()
	if (fileToken) {
		return {
			mode: 'oauth',
			authToken: fileToken,
			source: '.credentials.json',
		}
	}

	const keychainToken = readOAuthTokenFromKeychain()
	if (keychainToken) {
		return {
			mode: 'oauth',
			authToken: keychainToken,
			source: 'macOS keychain',
		}
	}

	throw new Error(
		'No upstream auth found. Set ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or login with Claude Code first.',
	)
}

function createAnthropicClient(): Anthropic {
	const auth = resolveUpstreamAuth()
	if (auth.mode === 'apiKey') {
		return new Anthropic({
			apiKey: auth.apiKey,
			baseURL: ANTHROPIC_BASE_URL,
			maxRetries: 2,
			timeout: 600_000,
		})
	}

	return new Anthropic({
		apiKey: null,
		authToken: auth.authToken,
		baseURL: ANTHROPIC_BASE_URL,
		maxRetries: 2,
		timeout: 600_000,
	})
}

function extractText(content: unknown): string {
	if (typeof content === 'string') {
		return content
	}
	if (!Array.isArray(content)) {
		return ''
	}

	return content
		.map((part) => {
			if (typeof part === 'string') {
				return part
			}
			if (!part || typeof part !== 'object') {
				return ''
			}

			const block = part as Record<string, unknown>
			const blockType = typeof block.type === 'string' ? block.type : ''
			if (
				(blockType === 'text' || blockType === 'input_text' || blockType === 'output_text') &&
				typeof block.text === 'string'
			) {
				return block.text
			}
			if (blockType === 'tool_result') {
				return extractText(block.content)
			}
			if (blockType === 'tool_use') {
				const toolName = typeof block.name === 'string' ? block.name : 'unknown-tool'
				return `[tool_use:${toolName}]`
			}
			if (typeof block.content === 'string') {
				return block.content
			}
			return ''
		})
		.filter(Boolean)
		.join('\n')
}

function normalizeMessages(rawMessages: unknown, explicitSystem?: unknown): NormalizedMessages {
	const systemParts: string[] = []
	const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []

	const explicitSystemText = extractText(explicitSystem)
	if (explicitSystemText) {
		systemParts.push(explicitSystemText)
	}

	if (!Array.isArray(rawMessages)) {
		return {
			messages,
			system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
		}
	}

	for (const rawMessage of rawMessages) {
		if (!rawMessage || typeof rawMessage !== 'object') {
			continue
		}
		const message = rawMessage as Record<string, unknown>
		const role = typeof message.role === 'string' ? message.role : 'user'
		const content = extractText(message.content)
		if (!content) {
			continue
		}

		if (role === 'system' || role === 'developer') {
			systemParts.push(content)
			continue
		}

		if (role === 'assistant') {
			messages.push({ role: 'assistant', content })
			continue
		}

		if (role === 'tool') {
			const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id : ''
			const prefix = toolCallId ? `Tool result (${toolCallId})` : 'Tool result'
			messages.push({ role: 'user', content: `${prefix}\n${content}` })
			continue
		}

		messages.push({ role: 'user', content })
	}

	return {
		messages,
		system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
	}
}

function getRequestedModel(body: JsonRecord): string {
	const requestedModel =
		typeof body.model === 'string' && body.model.trim() ? body.model : DEFAULT_MAIN_MODEL
	const normalized = requestedModel.trim()
	const stripped1M = normalized.replace(/\[1m\]$/i, '').trim()
	switch (stripped1M.toLowerCase()) {
		case 'sonnet':
			return DEFAULT_SONNET_MODEL
		case 'opus':
			return DEFAULT_OPUS_MODEL
		case 'haiku':
			return DEFAULT_HAIKU_MODEL
		case 'best':
			return DEFAULT_OPUS_MODEL
		default:
			return stripped1M
	}
}

function getMaxTokens(body: JsonRecord): number {
	const candidate =
		typeof body.max_tokens === 'number'
			? body.max_tokens
			: typeof body.max_completion_tokens === 'number'
				? body.max_completion_tokens
				: 4096
	return Math.max(1, Math.floor(candidate))
}

function buildAnthropicParams(body: JsonRecord): JsonRecord {
	const { messages, system } = normalizeMessages(body.messages, body.system)
	const params: JsonRecord = {
		model: getRequestedModel(body),
		messages,
		max_tokens: getMaxTokens(body),
	}

	if (system) {
		params.system = system
	}

	for (const key of [
		'metadata',
		'stop_sequences',
		'temperature',
		'thinking',
		'tool_choice',
		'tools',
		'top_k',
		'top_p',
		'betas',
	] as const) {
		if (body[key] !== undefined) {
			params[key] = body[key]
		}
	}

	return params
}

function getErrorStatus(err: unknown): number {
	if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
		return err.status
	}
	return 500
}

function getErrorPayload(err: unknown): JsonRecord {
	return {
		error: {
			type: 'api_error',
			message: formatError(err),
		},
	}
}

function extractAssistantText(response: Record<string, unknown>): string {
	const content = response.content
	if (!Array.isArray(content)) {
		return ''
	}
	return content
		.map((block) => {
			if (!block || typeof block !== 'object') {
				return ''
			}
			const part = block as Record<string, unknown>
			return part.type === 'text' && typeof part.text === 'string' ? part.text : ''
		})
		.filter(Boolean)
		.join('')
}

function mapFinishReason(stopReason: unknown): string | null {
	switch (stopReason) {
		case 'end_turn':
		case 'stop_sequence':
			return 'stop'
		case 'max_tokens':
			return 'length'
		case 'tool_use':
			return 'tool_calls'
		default:
			return null
	}
}

function buildChatCompletionResponse(response: Record<string, unknown>, model: string): JsonRecord {
	const usage =
		response.usage && typeof response.usage === 'object'
			? (response.usage as Record<string, unknown>)
			: {}
	const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0
	const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0

	return {
		id: `chatcmpl_${randomUUID().replace(/-/g, '')}`,
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				message: {
					role: 'assistant',
					content: extractAssistantText(response),
				},
				finish_reason: mapFinishReason(response.stop_reason),
			},
		],
		usage: {
			prompt_tokens: inputTokens,
			completion_tokens: outputTokens,
			total_tokens: inputTokens + outputTokens,
		},
	}
}

async function sendAnthropicResponse(
	req: IncomingMessage,
	res: ServerResponse,
	body: JsonRecord,
): Promise<void> {
	const signal = new AbortController()
	req.on('close', () => signal.abort())

	const params = buildAnthropicParams(body)
	const stream = body.stream === true
	const client = createAnthropicClient()

	if (!stream) {
		const response = (await client.beta.messages.create(params as never, {
			signal: signal.signal,
		})) as Record<string, unknown>
		json(res, 200, response)
		return
	}

	beginSSE(res)
	try {
		const responseStream = (await client.beta.messages.create(
			{
				...(params as never),
				stream: true,
			},
			{ signal: signal.signal },
		)) as AsyncIterable<unknown>

		for await (const event of responseStream) {
			sendSSE(res, event)
		}
		sendSSE(res, '[DONE]')
		res.end()
	} catch (err) {
		sendSSE(res, getErrorPayload(err))
		sendSSE(res, '[DONE]')
		res.end()
	}
}

async function sendChatCompletionsResponse(
	req: IncomingMessage,
	res: ServerResponse,
	body: JsonRecord,
): Promise<void> {
	const signal = new AbortController()
	req.on('close', () => signal.abort())

	const params = buildAnthropicParams(body)
	const model = String(params.model)
	const stream = body.stream === true
	const client = createAnthropicClient()

	if (!stream) {
		const response = (await client.beta.messages.create(params as never, {
			signal: signal.signal,
		})) as Record<string, unknown>
		json(res, 200, buildChatCompletionResponse(response, model))
		return
	}

	const completionId = `chatcmpl_${randomUUID().replace(/-/g, '')}`
	const created = Math.floor(Date.now() / 1000)
	let sentRoleChunk = false
	let finishReason: string | null = null

	beginSSE(res)

	try {
		const responseStream = (await client.beta.messages.create(
			{
				...(params as never),
				stream: true,
			},
			{ signal: signal.signal },
		)) as AsyncIterable<unknown>

		for await (const rawEvent of responseStream) {
			const event =
				rawEvent && typeof rawEvent === 'object' ? (rawEvent as Record<string, unknown>) : null
			if (!event || typeof event.type !== 'string') {
				continue
			}

			if (!sentRoleChunk) {
				sendSSE(res, {
					id: completionId,
					object: 'chat.completion.chunk',
					created,
					model,
					choices: [
						{
							index: 0,
							delta: { role: 'assistant' },
							finish_reason: null,
						},
					],
				})
				sentRoleChunk = true
			}

			if (event.type === 'content_block_delta') {
				const delta =
					event.delta && typeof event.delta === 'object'
						? (event.delta as Record<string, unknown>)
						: null
				if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
					sendSSE(res, {
						id: completionId,
						object: 'chat.completion.chunk',
						created,
						model,
						choices: [
							{
								index: 0,
								delta: { content: delta.text },
								finish_reason: null,
							},
						],
					})
				}
			}

			if (event.type === 'message_delta') {
				const delta =
					event.delta && typeof event.delta === 'object'
						? (event.delta as Record<string, unknown>)
						: null
				finishReason = mapFinishReason(delta?.stop_reason)
			}
		}

		sendSSE(res, {
			id: completionId,
			object: 'chat.completion.chunk',
			created,
			model,
			choices: [
				{
					index: 0,
					delta: {},
					finish_reason: finishReason ?? 'stop',
				},
			],
		})
		sendSSE(res, '[DONE]')
		res.end()
	} catch (err) {
		sendSSE(res, {
			error: {
				type: 'api_error',
				message: formatError(err),
			},
		})
		sendSSE(res, '[DONE]')
		res.end()
	}
}

function getModelList(): JsonRecord {
	const ids = Array.from(
		new Set([
			'sonnet',
			'opus',
			'haiku',
			DEFAULT_MAIN_MODEL,
			DEFAULT_SONNET_MODEL,
			DEFAULT_OPUS_MODEL,
			DEFAULT_HAIKU_MODEL,
			...PUBLIC_MODEL_IDS,
		]),
	)

	return {
		object: 'list',
		data: ids.map((id) => ({
			id,
			object: 'model',
			owned_by: 'claude-code-web2api',
			display_name: id,
		})),
	}
}

export function createWeb2ApiServer() {
	return createServer(async (req, res) => {
		setCorsHeaders(res)

		if (req.method === 'OPTIONS') {
			res.statusCode = 204
			res.end()
			return
		}

		if (!req.url) {
			json(res, 400, { error: 'Missing request URL' })
			return
		}

		const url = new URL(req.url, 'http://localhost')

		if (url.pathname === '/' && req.method === 'GET') {
			json(res, 200, {
				service: 'claude-code-web2api',
				status: 'ok',
				host: DEFAULT_HOST,
				port: DEFAULT_PORT,
				auth_protected: Boolean(API_AUTH_TOKEN),
				upstream_auth: (() => {
					try {
						return resolveUpstreamAuth().source
					} catch {
						return 'not configured'
					}
				})(),
				endpoints: ['/health', '/api/chat', '/v1/messages', '/v1/chat/completions', '/v1/models'],
				notes: [
					'This server reuses Claude Code auth and model resolution.',
					'The bridge/remote-control path is intentionally not exposed as a public API.',
					'Current implementation is text-first; multimodal/tool round-trips are not normalized for OpenAI clients.',
				],
			})
			return
		}

		if (url.pathname === '/health' && req.method === 'GET') {
			json(res, 200, {
				status: 'ok',
				service: 'claude-code-web2api',
				auth_protected: Boolean(API_AUTH_TOKEN),
				default_model: DEFAULT_MAIN_MODEL,
			})
			return
		}

		if (url.pathname !== '/health' && url.pathname !== '/' && !isAuthorized(req)) {
			json(res, 401, {
				error: {
					type: 'authentication_error',
					message: 'Missing or invalid API token',
				},
			})
			return
		}

		try {
			if (url.pathname === '/v1/models' && req.method === 'GET') {
				json(res, 200, getModelList())
				return
			}

			if (
				(url.pathname === '/api/chat' || url.pathname === '/v1/messages') &&
				req.method === 'POST'
			) {
				const body = await readJsonBody(req)
				await sendAnthropicResponse(req, res, body)
				return
			}

			if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
				const body = await readJsonBody(req)
				await sendChatCompletionsResponse(req, res, body)
				return
			}

			json(res, 404, {
				error: {
					type: 'not_found_error',
					message: `Unknown route: ${req.method ?? 'GET'} ${url.pathname}`,
				},
			})
		} catch (err) {
			json(res, getErrorStatus(err), getErrorPayload(err))
		}
	})
}

export const WEB2API_HOST = DEFAULT_HOST
export const WEB2API_PORT = DEFAULT_PORT
