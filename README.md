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
- WebSocket support via `.ws()` routes
- Session support with an in-memory store
- Cookie parsing and signing
- Protected routes with pluggable authentication
- Request ID injection (`X-Request-ID`)
- Response time tracking (`X-Response-Time`)
- Client IP resolution through proxies and Cloudflare
- Compression, Helmet, CORS, and CSP middleware
- Optional route parameters (`:id?`)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) integration for development
- Static file serving

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
    corsOrigin: '*',
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
    autoContentSecurityPolicyHeaders: false,
    autoStartCloudflared: false,
    suppressProcessErrors: true,
    xml: {},                             // parser and validator options
    wsOptions: {}                        // ws.ServerOptions
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

Restrict access to routes with a pluggable authentication provider:

```typescript
app.protected.setAuthenticationProvider(async (request) => {
    return request.authorization?.bearer?.token === 'secret';
    // return true to allow, false to deny (401)
    // or return { statusCode: 403, message: 'Forbidden' }
});

app.protected.get('/admin', (_request, response) => {
    return response.json({ admin: true });
});
```

All HTTP methods are available on `app.protected` (get, post, put, patch, delete, head, options, etc.).

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
import WebServer, { Logger, Router, multer } from '@gibme/webserver';
import type { Request, Response } from '@gibme/webserver';
```

## Documentation

[https://gibme-npm.github.io/webserver/](https://gibme-npm.github.io/webserver/)

## License

MIT
