// Copyright (c) 2018-2024, Brandon Lehmann <brandonlehmann@gmail.com>
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

import { describe, it, after, before } from 'mocha';
import fetch, { CookieJar } from '@gibme/fetch';
import WebServer from '../src/WebServer';
import assert from 'assert';
import WebSocket from 'ws';
import Logger from '@gibme/logger';

describe('Unit Tests', async () => {
    const app = WebServer.create({
        bindPort: 12345,
        sessions: true
    });

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

    app.ws('/wss', (socket) => {
        socket.on('message', msg => {
            socket.send(msg);
        });
    });

    before(async () => {
        await app.start();

        Logger.info('Local URL: %s', app.localUrl);
        Logger.info('URL: %s', app.url);
    });

    after(async () => {
        await app.stop();
    });

    describe('Cloudflared', async () => {
        it('Start Tunnel', async function () {
            try {
                const binary = await app.installCloudflared();

                Logger.warn('Cloudflared: %s', binary);
            } catch {
                this.skip();
            }

            try {
                await app.tunnelStart();

                Logger.info('Tunnel URL: %s', app.tunnelUrl);
                Logger.info('URL: %s', app.url);
            } catch {
                await app.tunnelStop();

                this.skip();
            }
        });

        it('Using Tunnel?', async function () {
            if (!app.tunnelUrl) {
                this.skip();
            }
        });
    });

    describe('HTTP', async () => {
        it('Simple Check', async () => {
            const response = await fetch(app.url, {
                timeout: 5_000
            });

            assert.ok(response.ok);

            const json: {success: boolean} = await response.json();

            assert.ok(json.success);
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
    });
});
