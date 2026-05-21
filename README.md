# @gibme/webserver

A batteries-included [Express.js v5](https://expressjs.com/) wrapper that provides an opinionated HTTP/HTTPS server with WebSocket support, session management, authorization parsing, and more.

## Requirements

- Node.js >= 22

## Installation

```bash
yarn add @gibme/webserver
# or
npm install @gibme/webserver
```

## Quick Start

```typescript
import WebServer, { Logger } from '@gibme/webserver';

const app = WebServer({ port: 8080 });

app.get('/', (_request, response) => {
    return response.json({ success: true });
});

app.ws('/wss', (socket) => {
    socket.on('message', msg => socket.send(msg));
});

await app.start();

Logger.info('Listening on: %s', app.url);
```

## Features

- Automatic request body parsing (JSON, URL-encoded, raw, text, XML)
- Authorization header decoding (Basic, Bearer, JWT)
- WebSocket support via `.ws()` routes, with optional per-route and app-level authentication
- Session support with an in-memory store
- Cookie parsing and signing
- Protected routes with pluggable authentication (route-scoped, predictable mount-order behavior)
- Request ID injection (`X-Request-ID`)
- Response time tracking (`X-Response-Time`)
- Client IP resolution through proxies and Cloudflare
- Compression, Helmet, CORS (with full preflight handling), and CSP middleware
- Rate limiting and CSRF middleware
- Optional route parameters (`:id?`)
- Optional `errorSink` to surface internal swallowed errors for observability
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) integration for development
- Static file serving
- Mountable [Model Context Protocol](https://modelcontextprotocol.io/) server (tools, resources, prompts) over Streamable HTTP, with optional per-session idle/max-age cleanup

## Configuration

All options are optional with sensible defaults:

```typescript
const app = WebServer({
    host: '0.0.0.0',
    port: 8080,
    ssl: false,                          // or { certificate, privateKey }
    backlog: 511,
    bodyLimit: 2,                        // MB
    compression: true,
    corsOrigin: '*',                     // or full CorsOptions object
    helmet: false,                       // or HelmetOptions
    sessions: false,                     // or true or SessionOptions
    logging: false,                      // or true, 'full', or callback
    cookieSecret: ['insecure'],
    autoHandle404: true,
    autoHandleOptions: true,
    autoParseJSON: true,
    autoParseURLEncoded: true,
    autoParseRaw: true,
    autoParseText: true,
    autoParseXML: true,
    autoRecommendedHeaders: false,
    autoContentSecurityPolicyHeaders: false,  // or true, or a CSPDirectives object
    autoStartCloudflared: false,
    suppressProcessErrors: true,
    xml: {},                             // parser and validator options
    wsOptions: {},                       // ws.ServerOptions
    wsAuth: undefined,                   // optional AuthenticationProvider applied to every WS route
    errorSink: undefined                 // optional (error, context) => void for internal swallowed errors
});
```

## Authorization Parsing

The `Authorization` header is automatically parsed and available on every request:

```typescript
// Basic Auth: Authorization: Basic base64(user:pass)
request.authorization?.basic?.username
request.authorization?.basic?.password

// Bearer Token: Authorization: Bearer <token>
request.authorization?.bearer?.token

// JWT: If the bearer token is a valid JWT structure
request.authorization?.jwt?.header   // { alg, typ }
request.authorization?.jwt?.payload  // decoded claims
request.authorization?.jwt?.signature
```

## Protected Routes

Use `ProtectedRouter()` to build a mountable Express Router whose every route is gated by a pluggable authentication provider. The provider is consulted on each request, so calling `setAuthenticationProvider` after registering routes updates auth for all of them:

```typescript
import WebServer, { ProtectedRouter } from '@gibme/webserver';

const app = WebServer();
const adminRouter = ProtectedRouter();

adminRouter.setAuthenticationProvider(async (request) => {
    return request.authorization?.bearer?.token === 'secret';
    // return true to allow, false to deny (401)
    // or return { statusCode: 403, message: 'Forbidden' }
});

adminRouter.get('/admin', (_request, response) => {
    return response.json({ admin: true });
});

app.use(adminRouter);            // mount at root
// or: app.use('/api', adminRouter);  // mount at a prefix
```

Because `ProtectedRouter()` returns a real `express.Router`, all router methods are available (`get`, `post`, `put`, `patch`, `delete`, `head`, `options`, `route`, `use`, etc.) and instances can be nested or reused across apps.

The gate is **route-scoped**: it fires only on routes registered via verb methods (`get`/`post`/`put`/`patch`/`delete`/`head`/`options`/`all`/`connect`/`trace`) or `route()`. Middleware registered via `router.use(...)` is intentionally NOT auto-gated, so a root-mounted ProtectedRouter does not interfere with routes mounted after it:

```typescript
const app = WebServer();
const protectedRouter = ProtectedRouter();
protectedRouter.setAuthenticationProvider(async () => false);  // deny everything
protectedRouter.get('/private', (_req, res) => res.send('never reached'));

app.use(protectedRouter);

// /public is NOT gated even though it is mounted AFTER the ProtectedRouter
app.get('/public', (_req, res) => res.send('ok'));
```

Unregistered paths return 404 (handled by `autoHandle404`), not 401. Callers who want middleware to participate in the gate should compose it inside a verb-registered handler or attach the gate themselves.

## MCP Server

Mount a [Model Context Protocol](https://modelcontextprotocol.io/) server on any path. `MCP.Router(config)` returns a `ProtectedRouter` that hosts the Streamable HTTP transport, with one `McpServer` instance per client session keyed by the `mcp-session-id` header.

```typescript
import WebServer, { MCP, zod } from '@gibme/webserver';

const app = WebServer();

app.use('/mcp', MCP.Router({
    implementation: { name: 'my-server', version: '1.0.0' },
    tools: [{
        name: 'add',
        title: 'Add',
        description: 'Adds two numbers',
        inputSchema: { a: zod.number(), b: zod.number() },
        outputSchema: { sum: zod.number() },
        callback: async ({ a, b }) => ({
            structuredContent: { sum: a + b },
            content: [{ type: 'text', text: String(a + b) }]
        })
    }],
    resources: [{
        name: 'app-config',
        uri: 'config://app',
        metadata: { title: 'App Config', mimeType: 'application/json' },
        readCallback: async (uri) => ({
            contents: [{ uri: uri.href, text: JSON.stringify({ env: 'prod' }) }]
        })
    }, {
        kind: 'template',
        name: 'user-profile',
        template: new MCP.ResourceTemplate('users://{userId}/profile', { list: undefined }),
        readCallback: async (uri, variables) => ({
            contents: [{ uri: uri.href, text: JSON.stringify({ userId: variables.userId }) }]
        })
    }],
    prompts: [{
        name: 'greet',
        title: 'Greet',
        description: 'Greets a person by name',
        argsSchema: { name: zod.string() },
        callback: async ({ name }) => ({
            messages: [{ role: 'user', content: { type: 'text', text: `Hello, ${name}!` } }]
        })
    }]
}));
```

Tool, resource, and prompt schemas use raw Zod shapes. The `inputSchema`/`outputSchema`/`argsSchema` types flow into each `callback`, so the compiler catches argument and return-value mismatches at the call site.

`MCP.Router` also accepts a `() => McpServer` factory for cases where the per-session server needs state captured in a closure (DB connections, session-scoped caches):

```typescript
app.use('/mcp', MCP.Router(() => {
    const sessionState = openSessionState();
    return MCP.createServer({
        implementation: { name: 'my-server', version: '1.0.0' },
        tools: [{ /* tools that close over sessionState */ }]
    });
}));
```

Because `MCP.Router` returns a `ProtectedRouter`, calling `setAuthenticationProvider` on it gates every MCP request:

```typescript
const mcp = MCP.Router({ /* ... */ });
mcp.setAuthenticationProvider(async (request) =>
    request.authorization?.bearer?.token === process.env.MCP_TOKEN);
app.use('/mcp', mcp);
```

### Per-session lifecycle

Long-running services that accept many short-lived MCP sessions without an explicit DELETE can leak transports. `MCP.Router` accepts an optional `MCP.SessionOptions` argument to bound the per-session transport map:

```typescript
app.use('/mcp', MCP.Router({
    implementation: { name: 'my-server', version: '1.0.0' },
    tools: [ /* ... */ ]
}, {
    idleTimeoutMs: 5 * 60_000,    // close sessions idle for 5 minutes
    maxAgeMs: 60 * 60_000,        // close sessions older than 1 hour
    maxSessions: 1000             // evict oldest when the cap is reached
}));
```

The sweep timer is started lazily on the first initialized session and stopped when the session map empties. All three controls are optional; setting none preserves the previous always-keep behavior.

## WebSocket Routes

Register WebSocket handlers with Express-style routing:

```typescript
app.ws('/chat', (socket, request, next) => {
    socket.on('message', msg => socket.send(msg));
});

// With route parameters
app.ws('/room/:id', (socket, request) => {
    const { id } = request.params;
    socket.send(`Joined room ${id}`);
});
```

WebSocket support can also be added to routers:

```typescript
import WebServer, { Router } from '@gibme/webserver';

const router = Router();
app.wsApplyTo(router, '/api');

router.ws('/events', (socket) => { /* ... */ });
app.use('/api', router);
```

### Authentication

WebSocket upgrade requests are decorated with `request.authorization`, `request.cookies`, and `request.signedCookies` (parsed from the upgrade headers using the same secrets as the HTTP path), so handlers can read them like any HTTP request:

```typescript
app.ws('/echo', (socket, request) => {
    console.log(request.authorization?.bearer?.token);
    console.log(request.cookies?.sessionId);
});
```

Three layers of authentication are supported:

**Per-route**: pass an `AuthenticationProvider` between the route and handler.

```typescript
app.ws('/secure',
    async (request) => request.authorization?.bearer?.token === process.env.WS_TOKEN,
    (socket) => socket.send('hello, authenticated client'));
```

**`ProtectedRouter` inheritance**: a `ProtectedRouter` passed through `app.wsApplyTo(...)` automatically threads its provider to every `ws()` route registered on it. Calling `setAuthenticationProvider` updates both HTTP and WS authentication uniformly:

```typescript
const protectedRouter = ProtectedRouter();
protectedRouter.setAuthenticationProvider(async (request) =>
    request.authorization?.bearer?.token === process.env.API_TOKEN);

const wsProtected = app.wsApplyTo(protectedRouter, '/api');
wsProtected.ws('/stream', (socket) => { /* ... */ });
app.use(wsProtected);
```

**App-level fallback**: the `wsAuth` option on `WebServer()` gates every WS route that does not specify its own provider. Per-route auth overrides the fallback:

```typescript
const app = WebServer({
    wsAuth: async (request) => request.authorization?.bearer?.token === process.env.WS_TOKEN
});
```

On deny, the upgrade is rejected with a raw HTTP response (default `401 Unauthorized`, or the `{ statusCode, message }` returned by the provider) and the socket is destroyed without completing the upgrade handshake.

## Sessions

Enable in-memory sessions backed by [node-cache](https://www.npmjs.com/package/node-cache):

```typescript
const app = WebServer({ sessions: true });

app.post('/login', (request, response) => {
    request.session.user = request.body;
    return response.status(200).send();
});

app.get('/profile', (request, response) => {
    return response.json(request.session.user ?? {});
});
```

Pass `express-session` options for fine-grained control:

```typescript
const app = WebServer({
    sessions: {
        secret: 'your-secret',
        cookie: { secure: true, maxAge: 86400000 }
    }
});
```

## CORS

The `corsOrigin` option accepts either a string (single allowed origin, the legacy form) or a full options bag for fine-grained control:

```typescript
const app = WebServer({
    corsOrigin: {
        origin: 'https://app.example.com',     // string | string[] | RegExp | (req) => string | false
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'X-Custom'],
        exposedHeaders: ['X-Request-ID'],
        credentials: true,
        maxAge: 600,
        preflightContinue: false
    }
});
```

Preflight `OPTIONS` requests are answered directly with `204 No Content` and the negotiated headers (set `preflightContinue: true` to forward them to the route handler). The wildcard origin `*` cannot be combined with `credentials: true`; the CORS specification forbids that pairing, and constructing the middleware with both will throw. To allow credentialed cross-origin requests, supply an explicit origin via string, string array, RegExp, or function. Regex origins must match the entire `Origin` value; partial matches are rejected.

## Content Security Policy

`autoContentSecurityPolicyHeaders` accepts `true` to apply the default `default-src 'self'`, or an object of directives to fully override:

```typescript
const app = WebServer({
    autoContentSecurityPolicyHeaders: {
        'default-src': "'self'",
        'img-src': ['*', 'data:'],
        'upgrade-insecure-requests': ''
    }
});
```

## Rate Limiting

Lightweight in-memory rate limiter built on `node-cache`. Plug in your own store for distributed deployments.

```typescript
import WebServer, { RateLimit } from '@gibme/webserver';

const app = WebServer();

app.use(RateLimit({
    windowMs: 60_000,
    max: 100,
    standardHeaders: true,        // emit RateLimit-* per draft-ietf-httpapi-ratelimit-headers
    legacyHeaders: false          // emit X-RateLimit-* (default off)
}));
```

Override the default key (`request.remoteIp`) with `keyGenerator`, exempt specific requests with `skip`, or supply a custom `handler` for the deny response. Provide `store` (an object exposing `get`, `set`, `clear`) to back the limiter with Redis or another shared cache.

## CSRF

Double-submit cookie pattern, OWASP-recommended. No session storage required.

```typescript
import WebServer, { CSRF } from '@gibme/webserver';

const app = WebServer({ cookieSecret: process.env.COOKIE_SECRET });

app.use(CSRF({ secret: process.env.COOKIE_SECRET }));

app.get('/form', (request, response) => {
    return response.send(`<form method="POST" action="/submit">
        <input type="hidden" name="_csrf" value="${request.csrfToken!()}">
        <button>Submit</button>
    </form>`);
});

app.post('/submit', (_request, response) => response.json({ ok: true }));
```

Safe methods (`GET`, `HEAD`, `OPTIONS`) seed the signed cookie and expose `request.csrfToken()` for templates to embed. Unsafe methods read the token from the `x-csrf-token` header or the `_csrf` body field and compare against the signed cookie using a constant-time comparison; a mismatch returns `403`.

The default cookie name uses the `__Host-` prefix, which requires `Secure`, no `Domain`, and `Path=/`. Override `cookieName` and `cookieOptions` for HTTP dev environments where the prefix cannot be honored.

## Error Sink

Several middleware paths intentionally swallow non-fatal internal errors (a malformed `Authorization` header, an unparseable JSON cookie, a throwing logging callback). Set `errorSink` to surface them for observability without changing request behavior:

```typescript
const app = WebServer({
    errorSink: (error, context) => Logger.warn('[%s] %s', context, error)
});
```

Context values are stable strings: `'authorization-decode'`, `'cookie-json-parse'`, `'logging-callback'`, `'rate-limit-store'`, `'csrf-verify'`, `'websocket-auth'`, `'websocket-write'`. Sink calls that throw are caught and discarded so a misbehaving sink cannot disrupt request handling.

## Optional Route Parameters

Routes with optional parameters (`:id?`) are automatically expanded into two registered routes:

```typescript
app.get('/users/:id?', handler);
// Registers both /users and /users/:id
```

This works on all routing methods and on `Router()` instances.

## Cloudflare Tunnel

Spin up a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for development and testing:

```typescript
const app = WebServer({ autoStartCloudflared: true });
await app.start();
Logger.info('Public URL: %s', app.tunnel.url);
```

Or manage the tunnel manually:

```typescript
await app.tunnel.install();
await app.tunnel.start();
console.log(app.tunnel.url);       // https://xxxxx.trycloudflare.com
console.log(app.tunnel.connections);
await app.tunnel.stop();
```

## Static File Serving

```typescript
app.static('/assets', './public');
```

## Logging

```typescript
// Basic request logging
const app = WebServer({ logging: true });

// Full logging (includes headers and body)
const app = WebServer({ logging: 'full' });

// Custom callback
const app = WebServer({
    logging: async (entry) => {
        await saveToDatabase(entry);
    }
});
```

## Request Extensions

Every request is automatically augmented with:

| Property | Type | Description |
|----------|------|-------------|
| `request.id` | string | Unique request UUID |
| `request.remoteIp` | string | Client IP (resolved through proxies/Cloudflare) |
| `request.time_elapsed` | number | Response time in milliseconds |
| `request.authorization` | object | Parsed authorization header |
| `request.cookies` | object | Parsed cookies |
| `request.signedCookies` | object | Verified signed cookies |

## SSL/TLS

```typescript
const app = WebServer({
    ssl: {
        certificate: '/path/to/cert.pem',
        privateKey: '/path/to/key.pem'
    }
});
```

Both file paths (strings) and Buffers are accepted.

## Exports

```typescript
import WebServer, {
    Logger,
    Router,
    ProtectedRouter,
    multer,
    zod,
    MCP,
    Proxy,
    RateLimit,
    CSRF,
    createInMemoryRateLimitStore
} from '@gibme/webserver';
import type {
    Request,
    Response,
    AuthenticationProvider,
    AuthenticationResult,
    CorsOptions,
    CorsOrigin,
    CSPDirectives,
    ErrorSink,
    ErrorSinkContext,
    LogEntry,
    RateLimitOptions,
    RateLimitStore,
    RateLimitBucket,
    RateLimitInfo,
    CSRFOptions,
    CSRFSecret,
    XMLParserOptions,
    XMLValidatorOptions
} from '@gibme/webserver';
```

## Documentation

[https://gibme-npm.github.io/webserver/](https://gibme-npm.github.io/webserver/)

## License

MIT
