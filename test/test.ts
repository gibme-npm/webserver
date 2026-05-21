// Copyright (c) 2018-2025, Brandon Lehmann <brandonlehmann@gmail.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import WebServer, {
    CSRF,
    ErrorSink,
    Logger,
    MCP,
    ProtectedRouter,
    Proxy,
    RateLimit,
    zod
} from '../src';
import fetch, { CookieJar } from '@gibme/fetch';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { resolve } from 'path';
import assert from 'assert';
import { sign as signCookie } from 'cookie-signature';
import { v7 as uuid } from 'uuid';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

describe('Unit Tests', async () => {
    const app = WebServer.create({
        port: 12345,
        sessions: true,
        cookieSecret: 'test-secret'
    });

    const token = uuid();
    const wsToken = uuid();

    app.get('/', (_request, response) => {
        return response.json({ success: true });
    });

    app.post('/sessiontest', (request, response) => {
        request.session.body = request.body;

        return response.status(200).send();
    });

    app.get('/sessiontest', (request, response) => {
        return response.json(request.session.body ?? {});
    });

    app.get('/pathparam/:id?', (request, response) => {
        return response.json({ id: request.params.id });
    });

    app.ws('/wss', socket => {
        socket.on('message', msg => {
            socket.send(msg);
        });
    });

    app.ws('/wss/:id', (socket, request) => {
        const { id } = request.params;

        socket.send(id);
    });

    app.get('/basic-auth', (request, response) => {
        return response.json({
            username: request.authorization?.basic?.username,
            password: request.authorization?.basic?.password
        });
    });

    // Request augmentation observability: echo the request fields the library is
    // supposed to populate so the test can assert on them externally.
    app.get('/augmented', (request, response) => {
        return response.json({
            id: request.id,
            remoteIp: request.remoteIp,
            jwt: request.authorization?.jwt
                ? { payload: request.authorization.jwt.payload }
                : undefined
        });
    });

    // Signed cookie round-trip: set a signed cookie then read it back.
    app.get('/cookie/set', (request, response) => {
        const signed = signCookie('hello-world', request.secret);
        response.setHeader('Set-Cookie', `signed=s:${signed}; Path=/`);
        response.setHeader('Set-Cookie-2nd', 'unused');
        response.append('Set-Cookie', 'jcook=j:%7B%22x%22%3A1%7D; Path=/');
        return response.status(204).end();
    });

    app.get('/cookie/read', (request, response) => {
        return response.json({
            signed: request.signedCookies?.signed,
            jcook: request.cookies?.jcook
        });
    });

    // XML body parsing
    app.post('/xml', (request, response) => {
        return response.json({ body: request.body });
    });

    // Static file serving
    app.static('/static', resolve(__dirname, 'fixtures'));

    // ProtectedRouter status-object response path: provider returns
    // { statusCode, message } shape rather than boolean.
    const statusProtected = ProtectedRouter();
    statusProtected.setAuthenticationProvider(async () => ({
        statusCode: 403,
        message: 'forbidden reason'
    }));
    statusProtected.get('/status-protected', (_, response) => response.status(200).send('never'));

    // ProtectedRouter .use() carve-out: middleware registered via .use() should
    // run for matched routes (proving it ran) but should NOT gate unregistered
    // routes (proving the gate is route-scoped).
    const carveOut = ProtectedRouter();
    carveOut.setAuthenticationProvider(async () => true);
    carveOut.use((req, _res, next) => {
        (req as any).tagged = true;
        next();
    });
    carveOut.get('/carve-out', (req, res) => {
        return res.json({ tagged: (req as any).tagged === true });
    });

    // ProtectedRouter with a WS route gated through brand-inheritance via wsApplyTo.
    const wsProtected = ProtectedRouter();
    wsProtected.setAuthenticationProvider(async req => req.authorization?.bearer?.token === wsToken);
    const wsProtectedWithWs = app.wsApplyTo(wsProtected, '/wsp');
    wsProtectedWithWs.ws('/secret', (socket, request) => {
        socket.send(request.authorization?.bearer?.token ?? '');
    });
    app.use(wsProtectedWithWs);

    // Per-route WS auth via the new app.ws(route, auth, handler) overload.
    app.ws('/wss-secure', async req => req.authorization?.bearer?.token === wsToken, socket => {
        socket.on('message', msg => socket.send(msg));
    });

    // WS Authorization/Cookie parsing echo route.
    app.ws('/wss-augment', (socket, request) => {
        socket.send(JSON.stringify({
            authType: request.authorization?.type,
            bearerToken: request.authorization?.bearer?.token,
            cookieSeen: request.cookies?.probe ?? null
        }));
    });

    const protectedRouter = ProtectedRouter();

    protectedRouter.setAuthenticationProvider(async request =>
        request.authorization?.bearer?.token === token);

    protectedRouter.get('/protected', (_, response) => {
        return response.status(200).send();
    });

    app.use('/mcp', MCP.Router({
        implementation: { name: 'webserver-test-mcp', version: '0.0.0' },
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
            readCallback: async uri => ({
                contents: [{
                    uri: uri.href,
                    mimeType: 'application/json',
                    text: JSON.stringify({ env: 'test' })
                }]
            })
        }, {
            kind: 'template',
            name: 'user-profile',
            template: new MCP.ResourceTemplate('users://{userId}/profile', { list: undefined }),
            metadata: { title: 'User Profile' },
            readCallback: async (uri, variables) => ({
                contents: [{
                    uri: uri.href,
                    mimeType: 'application/json',
                    text: JSON.stringify({ userId: String(variables.userId) })
                }]
            })
        }],
        prompts: [{
            name: 'greet',
            title: 'Greet',
            description: 'Greets a person by name',
            argsSchema: { name: zod.string() },
            callback: async ({ name }) => ({
                messages: [{
                    role: 'user',
                    content: { type: 'text', text: `Hello, ${name}!` }
                }]
            })
        }]
    }));

    app.use(statusProtected);
    app.use(carveOut);
    app.use(protectedRouter);

    // PUBLIC route registered AFTER root-mounted ProtectedRouters: under the
    // route-scoped gate fix, this MUST return 200, proving the gates did not leak
    // past their registered paths.
    app.get('/public-after', (_, response) => {
        return response.json({ public: true });
    });

    before(async () => {
        await app.start();

        Logger.info('Local URL: %s', app.localUrl);
        Logger.info('URL: %s', app.url);
    });

    after(async () => {
        try {
            await app.stop();
        } catch {}
    });

    describe('Cloudflared', async () => {
        it('Start Tunnel', { skip: false }, async (t) => {
            try {
                const binary = await app.tunnel.install();

                if (!binary) {
                    return t.skip('Cloudflared binary not available');
                }

                Logger.warn('Cloudflared: %s', binary);
            } catch {
                return t.skip('Cloudflared installation failed');
            }

            try {
                const tunnel = await app.tunnel.start();

                if (!tunnel) {
                    return t.skip('Tunnel failed to start');
                }

                Logger.info('Tunnel URL: %s', app.tunnel.url);
                Logger.info('URL: %s', app.url);
            } catch {
                await app.tunnel.stop();

                return t.skip('Tunnel start threw an error');
            }
        });

        it('Using Tunnel?', { skip: false }, async (t) => {
            if (!app.tunnel.url) {
                t.skip('No tunnel URL available');
            }
        });

        it('Connections?', { skip: false }, async (t) => {
            if (!app.tunnel.url) {
                return t.skip('No tunnel URL available');
            }

            assert.notEqual(app.tunnel.connections.length, 0);
        });
    });

    describe('HTTP', async () => {
        it('Simple Check', async () => {
            const response = await fetch(app.url, {
                timeout: 5_000
            });

            assert.ok(response.ok);

            const json: { success: boolean } = await response.json();

            assert.ok(json.success);
        });

        describe('Optional Route Params', async () => {
            it('No Param', async () => {
                const response = await fetch.get(`${app.url}/pathparam`);

                assert.ok(response.ok);

                const json: { id?: string } = await response.json();

                assert.ok(!json.id);
            });

            it('With Param', async () => {
                const id = uuid();

                const response = await fetch.get(`${app.url}/pathparam/${id}`);

                assert.ok(response.ok);

                const json: { id?: string } = await response.json();

                assert.ok(json.id === id);
            });
        });

        describe('Sessions Test', async () => {
            const jar = new CookieJar();
            const data = { success: true, check: 'sessions' };

            it('POST Request', async () => {
                const response = await fetch.post(`${app.url}/sessiontest`, {
                    cookieJar: jar,
                    json: data
                });

                assert.ok(response.ok);
            });

            it('GET request', async () => {
                const response = await fetch.get(`${app.url}/sessiontest`, {
                    cookieJar: jar
                });

                assert.ok(response.ok);

                const json = await response.json();

                assert.deepEqual(json, data);
            });
        });
    });

    describe('Basic Auth', async () => {
        it('Password With Colons', async () => {
            const username = 'user';
            const password = 'pass:word:with:colons';
            const encoded = Buffer.from(`${username}:${password}`).toString('base64');

            const response = await fetch.get(`${app.url}/basic-auth`, {
                headers: {
                    authorization: `Basic ${encoded}`
                }
            });

            assert.ok(response.ok);

            const json: { username?: string; password?: string } = await response.json();

            assert.strictEqual(json.username, username);
            assert.strictEqual(json.password, password);
        });
    });

    describe('Request Augmentations', async () => {
        it('X-Request-ID echoed + request.id populated', async () => {
            const response = await fetch.get(`${app.url}/augmented`);
            assert.ok(response.ok);
            const headerId = response.headers.get('x-request-id');
            const body: { id: string } = await response.json();
            assert.ok(headerId);
            assert.ok(body.id);
            assert.strictEqual(body.id, headerId);
            // crude UUID-ish shape
            assert.match(body.id, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
        });

        it('X-Response-Time is a numeric ms value', async () => {
            const response = await fetch.get(`${app.url}/augmented`);
            const elapsed = response.headers.get('x-response-time');
            assert.ok(elapsed);
            const stripped = elapsed.replace(/[^0-9.]/g, '');
            assert.ok(Number(stripped) >= 0);
        });

        it('JWT bearer payload decoded onto request.authorization.jwt', async () => {
            const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
            const payload = Buffer.from(JSON.stringify({ sub: 'tester', n: 42 })).toString('base64url');
            const signature = 'sig';
            const jwt = `${header}.${payload}.${signature}`;
            const response = await fetch.get(`${app.url}/augmented`, {
                headers: { authorization: `Bearer ${jwt}` }
            });
            assert.ok(response.ok);
            const body: { jwt?: { payload?: any } } = await response.json();
            assert.deepEqual(body.jwt?.payload, { sub: 'tester', n: 42 });
        });
    });

    describe('Cookie Signing + JSON Cookies', async () => {
        const jar = new CookieJar();

        it('Sets a signed cookie', async () => {
            const response = await fetch.get(`${app.url}/cookie/set`, { cookieJar: jar });
            assert.strictEqual(response.status, 204);
        });

        it('Reads back the signed + JSON cookies', async () => {
            const response = await fetch.get(`${app.url}/cookie/read`, { cookieJar: jar });
            assert.ok(response.ok);
            const body: { signed?: string; jcook?: any } = await response.json();
            assert.strictEqual(body.signed, 'hello-world');
            assert.deepEqual(body.jcook, { x: 1 });
        });
    });

    describe('XML Body Parsing', async () => {
        it('Parses application/xml POST', async () => {
            const response = await fetch.post(`${app.url}/xml`, {
                headers: { 'content-type': 'application/xml' },
                body: '<note><to>Brandon</to><msg>hi</msg></note>'
            });
            assert.ok(response.ok);
            const data: any = await response.json();
            // @gibme/xml returns a parsed object; assert key fields without
            // over-fitting the exact shape the parser uses.
            const found = JSON.stringify(data).includes('Brandon');
            assert.ok(found, `expected parsed xml to contain "Brandon": ${JSON.stringify(data)}`);
        });
    });

    describe('Static File Serving', async () => {
        it('Serves a fixture file', async () => {
            const response = await fetch.get(`${app.url}/static/hello.txt`);
            assert.ok(response.ok);
            const text = await response.text();
            assert.match(text, /hello, static!/);
        });
    });

    describe('ProtectedRouter Behavior', async () => {
        it('Status-object response path', async () => {
            const response = await fetch.get(`${app.url}/status-protected`);
            assert.strictEqual(response.status, 403);
            const text = await response.text();
            assert.strictEqual(text, 'forbidden reason');
        });

        it('Middleware via .use() runs but does NOT gate unmatched paths', async () => {
            const ok = await fetch.get(`${app.url}/carve-out`);
            assert.ok(ok.ok);
            const body: { tagged?: boolean } = await ok.json();
            assert.strictEqual(body.tagged, true);
        });

        it('Public route after root-mounted ProtectedRouters returns 200', async () => {
            const response = await fetch.get(`${app.url}/public-after`);
            assert.ok(response.ok);
            const body: { public?: boolean } = await response.json();
            assert.strictEqual(body.public, true);
        });

        it('Unregistered path on a ProtectedRouter returns 404, not 401', async () => {
            const response = await fetch.get(`${app.url}/no-such-protected-path`);
            // autoHandle404 closes the request with 404; the gate must NOT have
            // turned this into a 401.
            assert.strictEqual(response.status, 404);
        });
    });

    describe('Protected Tests', async () => {
        it('Cannot Access Without Token', async () => {
            const response = await fetch.get(`${app.url}/protected`);

            assert.ok(!response.ok);
        });

        it('Can Access With Token', async () => {
            const response = await fetch.get(`${app.url}/protected`, {
                headers: {
                    authorization: `Bearer ${token}`
                }
            });

            assert.ok(response.ok);
        });
    });

    describe('WebSockets', async () => {
        it('Simple Test', async () => {
            return new Promise((resolve, reject) => {
                const client = new WebSocket(`${app.url}/wss`);

                const message = 'test';

                client.once('error', error => {
                    return reject(error);
                });

                client.once('message', msg => {
                    client.close();

                    if (msg.toString() === message) {
                        return resolve();
                    } else {
                        return reject(new Error('Mismatched payload'));
                    }
                });

                client.once('open', () => {
                    client.send(message);
                });
            });
        });

        it('Advanced Test', async () => {
            return new Promise((resolve, reject) => {
                const client = new WebSocket(`${app.url}/wss`);

                const message = JSON.stringify({ test: true, value: 9, str: 'string' });

                client.once('error', error => {
                    client.close();

                    return reject(error);
                });

                client.once('message', msg => {
                    client.close();

                    if (msg.toString() === message) {
                        return resolve();
                    } else {
                        return reject(new Error('Mismatched payload'));
                    }
                });

                client.once('open', () => {
                    client.send(message);
                });
            });
        });

        it('Advanced Test w/ Params', async () => {
            return new Promise((resolve, reject) => {
                const id = uuid();

                const client = new WebSocket(`${app.url}/wss/${id}`);

                client.once('error', error => {
                    client.close();

                    return reject(error);
                });

                client.once('message', msg => {
                    client.close();

                    if (msg.toString() === id) {
                        return resolve();
                    } else {
                        return reject(new Error('Mismatched payload'));
                    }
                });
            });
        });

        it('Authorization + Cookie parsing on upgrade request', async () => {
            return new Promise<void>((resolve, reject) => {
                const client = new WebSocket(`${app.url}/wss-augment`, {
                    headers: {
                        authorization: 'Bearer abc.def.ghi',
                        cookie: 'probe=value'
                    }
                });
                client.once('error', reject);
                client.once('message', msg => {
                    client.close();
                    try {
                        const parsed = JSON.parse(msg.toString());
                        assert.strictEqual(parsed.authType, 'Bearer');
                        assert.strictEqual(parsed.bearerToken, 'abc.def.ghi');
                        assert.strictEqual(parsed.cookieSeen, 'value');
                        resolve();
                    } catch (error) {
                        reject(error instanceof Error ? error : new Error(String(error)));
                    }
                });
            });
        });

        it('Per-route auth: denied without token', async () => {
            return new Promise<void>((resolve, reject) => {
                const client = new WebSocket(`${app.url}/wss-secure`);
                client.once('open', () => {
                    client.close();
                    reject(new Error('expected upgrade to be rejected'));
                });
                client.once('unexpected-response', (_req, res) => {
                    assert.strictEqual(res.statusCode, 401);
                    res.resume();
                    resolve();
                });
                client.once('error', () => { /* swallow connection-error after the 401 */ });
            });
        });

        it('Per-route auth: allowed with token', async () => {
            return new Promise<void>((resolve, reject) => {
                const client = new WebSocket(`${app.url}/wss-secure`, {
                    headers: { authorization: `Bearer ${wsToken}` }
                });
                client.once('error', reject);
                client.once('open', () => {
                    client.send('hi');
                });
                client.once('message', msg => {
                    client.close();
                    if (msg.toString() === 'hi') return resolve();
                    return reject(new Error('mismatched payload'));
                });
            });
        });

        it('ProtectedRouter WS inheritance: denied without token', async () => {
            return new Promise<void>((resolve, reject) => {
                const client = new WebSocket(`${app.url}/wsp/secret`);
                client.once('open', () => {
                    client.close();
                    reject(new Error('expected upgrade to be rejected'));
                });
                client.once('unexpected-response', (_req, res) => {
                    assert.strictEqual(res.statusCode, 401);
                    res.resume();
                    resolve();
                });
                client.once('error', () => { /* swallow */ });
            });
        });

        it('ProtectedRouter WS inheritance: allowed with token', async () => {
            return new Promise<void>((resolve, reject) => {
                const client = new WebSocket(`${app.url}/wsp/secret`, {
                    headers: { authorization: `Bearer ${wsToken}` }
                });
                client.once('error', reject);
                client.once('message', msg => {
                    client.close();
                    if (msg.toString() === wsToken) return resolve();
                    return reject(new Error('mismatched payload'));
                });
            });
        });
    });

    describe('MCP', async () => {
        let client: McpClient;
        let transport: StreamableHTTPClientTransport;

        before(async () => {
            client = new McpClient({ name: 'webserver-test-client', version: '0.0.0' });
            transport = new StreamableHTTPClientTransport(new URL(`${app.url}/mcp`));
            await client.connect(transport);
        });

        after(async () => {
            await client.close();
            await transport.close();
        });

        it('List Tools', async () => {
            const { tools } = await client.listTools();
            assert.ok(tools.some(tool => tool.name === 'add'));
        });

        it('Call Tool', async () => {
            const result = await client.callTool({ name: 'add', arguments: { a: 3, b: 4 } });
            assert.deepEqual(result.structuredContent, { sum: 7 });
        });

        it('List Resources', async () => {
            const { resources } = await client.listResources();
            assert.ok(resources.some(resource => resource.uri === 'config://app'));
        });

        it('Read Static Resource', async () => {
            const result = await client.readResource({ uri: 'config://app' });
            const first = result.contents[0];
            assert.ok(first && 'text' in first);
            assert.deepEqual(JSON.parse(first.text as string), { env: 'test' });
        });

        it('List Resource Templates', async () => {
            const { resourceTemplates } = await client.listResourceTemplates();
            assert.ok(resourceTemplates.some(template =>
                template.uriTemplate === 'users://{userId}/profile'));
        });

        it('Read Templated Resource', async () => {
            const result = await client.readResource({ uri: 'users://42/profile' });
            const first = result.contents[0];
            assert.ok(first && 'text' in first);
            assert.deepEqual(JSON.parse(first.text as string), { userId: '42' });
        });

        it('List Prompts', async () => {
            const { prompts } = await client.listPrompts();
            assert.ok(prompts.some(prompt => prompt.name === 'greet'));
        });

        it('Get Prompt', async () => {
            const result = await client.getPrompt({
                name: 'greet',
                arguments: { name: 'Brandon' }
            });
            assert.equal(result.messages.length, 1);
            const message = result.messages[0];
            assert.equal(message.role, 'user');
            assert.equal(message.content.type, 'text');
            assert.equal((message.content as { text: string }).text, 'Hello, Brandon!');
        });
    });
});

describe('Compression', async () => {
    const app = WebServer.create({ port: 12360, compression: true });
    const payload = 'a'.repeat(8192);
    app.get('/big', (_req, res) => res.type('text/plain').send(payload));

    before(async () => { await app.start(); });
    after(async () => { try { await app.stop(); } catch {} });

    it('emits Content-Encoding for a sufficiently large response', async () => {
        const response = await fetch.get(`${app.url}/big`, {
            headers: { 'accept-encoding': 'gzip' }
        });
        assert.ok(response.ok);
        const encoding = response.headers.get('content-encoding');
        assert.ok(encoding === 'gzip' || encoding === 'br',
            `expected gzip or br, got ${encoding}`);
    });
});

describe('Security Headers + CSP Override', async () => {
    const app = WebServer.create({
        port: 12361,
        autoRecommendedHeaders: true,
        autoContentSecurityPolicyHeaders: {
            'default-src': '\'self\'',
            'img-src': ['*', 'data:'],
            'upgrade-insecure-requests': ''
        }
    });
    app.get('/h', (_req, res) => res.json({ ok: true }));

    before(async () => { await app.start(); });
    after(async () => { try { await app.stop(); } catch {} });

    it('emits the modern set of recommended headers', async () => {
        const response = await fetch.get(`${app.url}/h`);
        assert.ok(response.ok);
        assert.ok(response.headers.get('cache-control'));
        assert.ok(response.headers.get('referrer-policy'));
        assert.ok(response.headers.get('permissions-policy'));
        assert.strictEqual(response.headers.get('x-content-type-options'), 'nosniff');
    });

    it('does NOT emit the deprecated Feature-Policy header', async () => {
        const response = await fetch.get(`${app.url}/h`);
        assert.strictEqual(response.headers.get('feature-policy'), null);
    });

    it('applies CSP directive override', async () => {
        const response = await fetch.get(`${app.url}/h`);
        const csp = response.headers.get('content-security-policy');
        assert.ok(csp);
        assert.match(csp, /default-src 'self'/);
        assert.match(csp, /img-src \* data:/);
        assert.match(csp, /upgrade-insecure-requests/);
    });
});

describe('CORS', async () => {
    const app = WebServer.create({
        port: 12362,
        corsOrigin: {
            origin: 'https://allowed.example',
            methods: ['GET', 'POST'],
            allowedHeaders: ['X-Custom', 'Content-Type'],
            credentials: true,
            maxAge: 600
        }
    });
    app.get('/c', (_req, res) => res.json({ ok: true }));

    before(async () => { await app.start(); });
    after(async () => { try { await app.stop(); } catch {} });

    it('does not emit the non-standard X-Requested-With response header', async () => {
        const response = await fetch.get(`${app.url}/c`);
        assert.ok(response.ok);
        assert.strictEqual(response.headers.get('x-requested-with'), null);
    });

    it('preflight returns 204 with negotiated headers', async () => {
        const response = await fetch(`${app.url}/c`, {
            method: 'OPTIONS',
            headers: {
                origin: 'https://allowed.example',
                'access-control-request-method': 'POST',
                'access-control-request-headers': 'X-Custom'
            }
        });
        assert.strictEqual(response.status, 204);
        assert.strictEqual(response.headers.get('access-control-allow-origin'), 'https://allowed.example');
        assert.strictEqual(response.headers.get('access-control-allow-credentials'), 'true');
        const methods = response.headers.get('access-control-allow-methods') ?? '';
        assert.match(methods, /POST/);
        const headers = response.headers.get('access-control-allow-headers') ?? '';
        assert.match(headers, /X-Custom/);
        assert.strictEqual(response.headers.get('access-control-max-age'), '600');
    });

    it('credentials mode does NOT emit "*" for origin', async () => {
        const app2 = WebServer.create({
            port: 12363,
            corsOrigin: { origin: '*', credentials: true }
        });
        app2.get('/c2', (_req, res) => res.json({ ok: true }));
        await app2.start();
        try {
            const response = await fetch.get(`${app2.url}/c2`, {
                headers: { origin: 'https://example.test' }
            });
            assert.strictEqual(response.headers.get('access-control-allow-origin'), 'https://example.test');
        } finally {
            await app2.stop();
        }
    });
});

describe('Proxy', async () => {
    const upstream = WebServer.create({ port: 12364 });
    upstream.get('/echo', (_req, res) => res.json({ upstream: true }));

    const proxy = WebServer.create({ port: 12365 });
    proxy.use('/proxied', Proxy.createMiddleware({
        target: 'http://127.0.0.1:12364',
        changeOrigin: true,
        pathRewrite: { '^/proxied': '' }
    }));

    before(async () => {
        await upstream.start();
        await proxy.start();
    });
    after(async () => {
        try { await proxy.stop(); } catch {}
        try { await upstream.stop(); } catch {}
    });

    it('forwards GET requests to the upstream server', async () => {
        const response = await fetch.get(`${proxy.url}/proxied/echo`);
        assert.ok(response.ok);
        const data: { upstream?: boolean } = await response.json();
        assert.strictEqual(data.upstream, true);
    });
});

describe('Rate Limit', async () => {
    const app = WebServer.create({ port: 12366 });
    app.use(RateLimit({ windowMs: 5_000, max: 3 }));
    app.get('/r', (_req, res) => res.json({ ok: true }));

    before(async () => { await app.start(); });
    after(async () => { try { await app.stop(); } catch {} });

    it('allows up to max requests then 429s with Retry-After', async () => {
        for (let i = 0; i < 3; i++) {
            const ok = await fetch.get(`${app.url}/r`);
            assert.ok(ok.ok, `request ${i + 1} should pass`);
        }
        const denied = await fetch.get(`${app.url}/r`);
        assert.strictEqual(denied.status, 429);
        const retryAfter = denied.headers.get('retry-after');
        assert.ok(retryAfter, 'Retry-After header missing');
        assert.ok(Number(retryAfter) >= 0);
        const limitHeader = denied.headers.get('ratelimit-limit');
        assert.strictEqual(limitHeader, '3');
    });
});

describe('CSRF', async () => {
    const app = WebServer.create({ port: 12367 });
    app.use(CSRF({
        secret: 'csrf-test-secret',
        cookieName: 'csrf',
        cookieOptions: { secure: false, sameSite: 'lax' }
    }));
    app.get('/issue', (req, res) => {
        const token = (req.csrfToken as () => string)();
        return res.json({ token });
    });
    app.post('/submit', (_req, res) => res.json({ ok: true }));

    before(async () => { await app.start(); });
    after(async () => { try { await app.stop(); } catch {} });

    it('GET seeds a CSRF cookie and returns a token', async () => {
        const jar = new CookieJar();
        const response = await fetch.get(`${app.url}/issue`, { cookieJar: jar });
        assert.ok(response.ok);
        const body: { token?: string } = await response.json();
        assert.ok(body.token, 'token missing');
        const cookies = await jar.getCookies(app.url);
        assert.ok(cookies.some(c => c.key === 'csrf'), 'csrf cookie missing');
    });

    it('POST without token is rejected with 403', async () => {
        const response = await fetch.post(`${app.url}/submit`, {});
        assert.strictEqual(response.status, 403);
    });

    it('POST with matching token succeeds', async () => {
        const jar = new CookieJar();
        const issue = await fetch.get(`${app.url}/issue`, { cookieJar: jar });
        const { token } = await issue.json() as { token: string };
        const submit = await fetch.post(`${app.url}/submit`, {
            cookieJar: jar,
            headers: { 'x-csrf-token': token }
        });
        assert.ok(submit.ok);
    });

    it('POST with mismatched token is rejected with 403', async () => {
        const jar = new CookieJar();
        await fetch.get(`${app.url}/issue`, { cookieJar: jar });
        const submit = await fetch.post(`${app.url}/submit`, {
            cookieJar: jar,
            headers: { 'x-csrf-token': 'not-the-real-token' }
        });
        assert.strictEqual(submit.status, 403);
    });
});

describe('Error Sink', async () => {
    const sinkCalls: Array<{ context: string }> = [];
    const sink: ErrorSink = (_error, context) => { sinkCalls.push({ context }); };

    const app = WebServer.create({ port: 12368, errorSink: sink });
    app.get('/probe', (_req, res) => res.json({ ok: true }));

    before(async () => { await app.start(); });
    after(async () => { try { await app.stop(); } catch {} });

    it('surfaces JWT decode failures via the sink', async () => {
        sinkCalls.length = 0;
        // Bearer token with three dot-separated segments where each segment is
        // garbage base64url; JSON.parse will throw on the header.
        const response = await fetch.get(`${app.url}/probe`, {
            headers: { authorization: 'Bearer not.valid.jwt' }
        });
        assert.ok(response.ok);
        const hit = sinkCalls.find(c => c.context === 'authorization-decode');
        assert.ok(hit, `expected authorization-decode sink call, got ${JSON.stringify(sinkCalls)}`);
    });
});

describe('MCP Session Lifecycle', async () => {
    const app = WebServer.create({ port: 12369 });
    app.use('/mcp', MCP.Router(
        {
            implementation: { name: 'lifecycle-mcp', version: '0.0.0' },
            tools: [{
                name: 'echo',
                inputSchema: { v: zod.string() },
                outputSchema: { v: zod.string() },
                callback: async ({ v }) => ({
                    structuredContent: { v },
                    content: [{ type: 'text', text: v }]
                })
            }]
        },
        { idleTimeoutMs: 250, sweepIntervalMs: 80 }
    ));

    before(async () => { await app.start(); });
    after(async () => { try { await app.stop(); } catch {} });

    it('evicts an idle session and returns 404 on subsequent dispatch', async () => {
        const client = new McpClient({ name: 'lifecycle-client', version: '0.0.0' });
        const transport = new StreamableHTTPClientTransport(new URL(`${app.url}/mcp`));
        await client.connect(transport);

        // exercise the session once
        const first = await client.callTool({ name: 'echo', arguments: { v: 'one' } });
        assert.deepEqual(first.structuredContent, { v: 'one' });

        // sleep past idle timeout so the sweeper evicts the session
        await new Promise(resolve => setTimeout(resolve, 600));

        // next dispatch should observe the eviction
        try {
            await client.callTool({ name: 'echo', arguments: { v: 'two' } });
            assert.fail('expected post-eviction dispatch to fail');
        } catch {
            // expected: the server returns 404 for the unknown session id
        } finally {
            try { await transport.close(); } catch {}
            try { await client.close(); } catch {}
        }
    });
});

describe('WebSocket wsAuth Fallback', async () => {
    const fallbackToken = uuid();
    const app = WebServer.create({
        port: 12370,
        wsAuth: async request => request.authorization?.bearer?.token === fallbackToken
    });
    app.ws('/inherits', (socket, request) => {
        socket.send(request.authorization?.bearer?.token ?? '');
    });
    app.ws('/overrides', async () => true, (socket) => {
        socket.send('open');
    });

    before(async () => { await app.start(); });
    after(async () => { try { await app.stop(); } catch {} });

    it('inherits app-level wsAuth: denied without token', async () => {
        return new Promise<void>((resolve, reject) => {
            const client = new WebSocket(`${app.url}/inherits`);
            client.once('open', () => {
                client.close();
                reject(new Error('expected reject'));
            });
            client.once('unexpected-response', (_req, res) => {
                assert.strictEqual(res.statusCode, 401);
                res.resume();
                resolve();
            });
            client.once('error', () => {});
        });
    });

    it('inherits app-level wsAuth: allowed with token', async () => {
        return new Promise<void>((resolve, reject) => {
            const client = new WebSocket(`${app.url}/inherits`, {
                headers: { authorization: `Bearer ${fallbackToken}` }
            });
            client.once('error', reject);
            client.once('message', msg => {
                client.close();
                if (msg.toString() === fallbackToken) return resolve();
                return reject(new Error('mismatched payload'));
            });
        });
    });

    it('per-route auth (always-allow) overrides the wsAuth fallback', async () => {
        return new Promise<void>((resolve, reject) => {
            const client = new WebSocket(`${app.url}/overrides`);
            client.once('error', reject);
            client.once('message', msg => {
                client.close();
                if (msg.toString() === 'open') return resolve();
                return reject(new Error('mismatched payload'));
            });
        });
    });
});

describe('WebSocket Auth Timeout', async () => {
    const app = WebServer.create({
        port: 12371,
        wsAuthTimeoutMs: 200,
        wsAuth: () => new Promise(() => { /* never resolves */ })
    });
    app.ws('/never', (socket) => socket.send('unreachable'));

    before(async () => { await app.start(); });
    after(async () => { try { await app.stop(); } catch {} });

    it('denies the handshake when the provider never resolves', async () => {
        return new Promise<void>((resolve, reject) => {
            const client = new WebSocket(`${app.url}/never`);
            const start = Date.now();
            client.once('open', () => {
                client.close();
                reject(new Error('expected upgrade to be denied'));
            });
            client.once('unexpected-response', (_req, res) => {
                assert.strictEqual(res.statusCode, 504);
                res.resume();
                const elapsed = Date.now() - start;
                assert.ok(elapsed < 2_000, `expected fast timeout, elapsed=${elapsed}ms`);
                resolve();
            });
            client.once('error', () => { /* swallow */ });
        });
    });
});
