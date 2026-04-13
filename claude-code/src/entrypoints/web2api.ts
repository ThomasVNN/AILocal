import { WEB2API_HOST, WEB2API_PORT, createWeb2ApiServer } from '../server/web2api/server.js'

async function main(): Promise<void> {
	const server = createWeb2ApiServer()
	server.listen(WEB2API_PORT, WEB2API_HOST, () => {
		console.log(`[claude-code-web2api] listening on http://${WEB2API_HOST}:${WEB2API_PORT}`)
	})

	const shutdown = () => {
		server.close(() => {
			process.exit(0)
		})
	}

	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
}

void main().catch((error) => {
	console.error('[claude-code-web2api] fatal error:', error)
	process.exit(1)
})
