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
import WebServer, { WebApplication } from '../src/WebServer';
import fetch from 'cross-fetch';
import assert from 'assert';
import WebSocket from 'ws';

describe('Webserver Server Tests', async () => {
    let app: WebApplication;

    let client: WebSocket.WebSocket;

    before(async () => {
        app = await WebServer.create({
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

        await app.start();

        client = new WebSocket('http://127.0.0.1:12345/wss');
    });

    after(async () => {
        await app.stop();
    });

    it('Simple HTTP Test', async () => {
        const response = await fetch('http://127.0.0.1:12345/');

        assert(response.ok);

        const json: {success: boolean} = await response.json();

        assert(json.success);
    });

    it('Simple WebSocket Test', async () => {
        return new Promise((resolve, reject) => {
            const message = 'test';

            client.once('message', msg => {
                client.close();

                if (msg.toString() === message) {
                    return resolve();
                } else {
                    return reject(new Error('Mismatched payload'));
                }
            });

            client.send(message);
        });
    });
});
