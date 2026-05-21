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

import WebServer, { Logger, MCP, ProtectedRouter, zod } from '../src';
import fetch, { CookieJar } from '@gibme/fetch';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import assert from 'assert';
import { v7 as uuid } from 'uuid';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

describe('Unit Tests', async () => {
    const app = WebServer.create({
        port: 12345,
        sessions: true
    });

    const token = uuid();

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

    app.use(protectedRouter);

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
