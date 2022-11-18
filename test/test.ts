// Copyright (c) 2018-2022, Brandon Lehmann
//
// Please see the included LICENSE file for more information.

import { describe, it, after, before } from 'mocha';
import WebServer, { WebApplication } from '../src/WebServer';
import fetch from 'cross-fetch';
import assert from 'assert';
import WebSocket from 'ws';

describe('HTTP Server Tests', async () => {
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

    it('Simple Test', async () => {
        const response = await fetch('http://127.0.0.1:12345/');

        assert(response.ok);

        const json: {success: boolean} = await response.json();

        assert(json.success);
    });

    it('WebSocket Test', async () => {
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
