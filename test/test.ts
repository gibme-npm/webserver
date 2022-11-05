// Copyright (c) 2018-2022, Brandon Lehmann
//
// Please see the included LICENSE file for more information.

import { describe, it, after, before } from 'mocha';
import WebServer, { WebApplication } from '../src/WebServer';
import fetch from 'cross-fetch';
import assert from 'assert';

describe('HTTP Server Tests', async () => {
    let app: WebApplication;

    before(async () => {
        app = await WebServer.create({
            bindPort: 12345
        });

        app.get('/', (request, response) => {
            return response.json({ success: true });
        });

        await app.start();
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
});
