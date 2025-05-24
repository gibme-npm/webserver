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

import type express from 'express';
import Logger from '@gibme/logger';
import type { IncomingHttpHeaders } from 'http';

export type LogEntry<BodyType = any> = {
    timestamp: number;
    id: string;
    ip: string;
    remoteIp: string;
    method: string;
    url: string;
    headers?: IncomingHttpHeaders;
    body?: BodyType;
    time_elapsed?: number;
    statusCode?: number;
    contentLength: number;
}

export const now = () =>
    Math.floor((new Date()).getTime() / 1000);

export default function middleware (logging: boolean | 'full' | ((entry: LogEntry) => Promise<void> | void)) {
    return (request: express.Request, response: express.Response, next: express.NextFunction) => {
        const isCallback = typeof logging === 'function';

        const { id, ip, method, url, remoteIp } = request;

        const entry: LogEntry = {
            timestamp: now(),
            id: id ?? '',
            ip: ip ?? '',
            remoteIp: remoteIp ?? '',
            contentLength: parseInt(request.header('Content-Length') ?? '0') || 0,
            method,
            url
        };

        response.on('finish', async () => {
            if (logging === 'full' || isCallback) {
                entry.headers = request.headers;

                switch (method) {
                    case 'POST':
                    case 'PATCH':
                    case 'PUT':
                        entry.body = request.body;
                        break;
                    default:
                        break;
                }
            }

            entry.statusCode = response.statusCode;
            entry.time_elapsed = request.time_elapsed;

            if (isCallback) {
                try {
                    await logging(entry);
                } catch {}
            } else if (logging) {
                Logger.debug(JSON.stringify(entry));
            }
        });

        return next();
    };
}
