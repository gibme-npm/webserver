// Copyright (c) 2018-2022, Brandon Lehmann <brandonlehmann@gmail.com>
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
import fetch from '@gibme/fetch';
import WebServer from '../src/WebServer';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import WebSocket from 'ws';

describe('Unit Tests', async () => {
    const app = WebServer.create({
        bindPort: 12345
    });

    app.get('/', (request, response) => {
        return response.json({ success: true });
    });

    app.ws('/wss', (socket) => {
        socket.on('message', msg => {
            socket.send(msg);
        });
    });

    before(async () => {
        await app.start();
    });

    after(async () => {
        await app.stop();
    });

    describe('Cloudflared', async () => {
        it('Start Tunnel', async function () {
            try {
                await app.tunnelStart();
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

            assert(response.ok);

            const json: {success: boolean} = await response.json();

            assert(json.success);
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
