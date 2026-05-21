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

export type CorsOrigin =
    | string
    | string[]
    | RegExp
    | ((request: express.Request) => string | false);

export type CorsOptions = {
    origin?: CorsOrigin;
    methods?: string[];
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    credentials?: boolean;
    maxAge?: number;
    preflightContinue?: boolean;
    optionsSuccessStatus?: number;
};

const DEFAULT_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'];

const resolve_origin = (
    origin: CorsOrigin | undefined,
    request: express.Request
): string | undefined => {
    if (origin === undefined || origin === null || origin === '') {
        return undefined;
    }

    const requestOrigin = request.header('origin');

    if (typeof origin === 'string') {
        return origin;
    }

    if (Array.isArray(origin)) {
        return requestOrigin ? origin.find(allowed => allowed === requestOrigin) : undefined;
    }

    if (origin instanceof RegExp) {
        if (!requestOrigin) {
            return undefined;
        }

        const match = origin.exec(requestOrigin);
        return match && match[0] === requestOrigin ? match[0] : undefined;
    }

    if (typeof origin === 'function') {
        const resolved = origin(request);
        return resolved === false ? undefined : resolved;
    }

    return undefined;
};

const append_vary = (response: express.Response, value: string) => {
    const existing = response.getHeader('Vary');

    if (!existing) {
        response.setHeader('Vary', value);
        return;
    }

    const current = Array.isArray(existing) ? existing.join(', ') : String(existing);

    if (current.split(',').map(s => s.trim().toLowerCase()).includes(value.toLowerCase())) {
        return;
    }

    response.setHeader('Vary', `${current}, ${value}`);
};

export default function middleware (corsOrigin: string | CorsOptions) {
    const options: CorsOptions = typeof corsOrigin === 'string'
        ? { origin: corsOrigin.trim() || undefined }
        : { ...corsOrigin };

    if (typeof options.origin === 'string') {
        options.origin = options.origin.trim() || undefined;
    }

    if (options.origin === '*' && options.credentials) {
        throw new Error(
            'CORS: origin "*" cannot be used with credentials=true. ' +
            'The CORS specification forbids the wildcard origin for credentialed requests. ' +
            'Supply an explicit origin (string, string[], RegExp, or function) instead.'
        );
    }

    if (options.origin instanceof RegExp) {
        // Pre-anchor for whole-string match and strip stateful/multiline flags.
        // Strips g/y (stateful exec via lastIndex would produce non-deterministic
        // allow decisions across requests on a shared RegExp) and m (single-line
        // anchor semantics; HTTP Origin headers cannot contain newlines).
        const flags = options.origin.flags.replace(/[gym]/g, '');
        options.origin = new RegExp(`^(?:${options.origin.source})$`, flags);
    }

    return (request: express.Request, response: express.Response, next: express.NextFunction) => {
        if (options.origin === undefined || options.origin === '') {
            return next();
        }

        const resolvedOrigin = resolve_origin(options.origin, request);

        if (resolvedOrigin) {
            response.header('Access-Control-Allow-Origin', resolvedOrigin);

            if (resolvedOrigin !== '*') {
                append_vary(response, 'Origin');
            }
        }

        if (options.credentials) {
            response.header('Access-Control-Allow-Credentials', 'true');
        }

        if (options.exposedHeaders && options.exposedHeaders.length > 0) {
            response.header('Access-Control-Expose-Headers', options.exposedHeaders.join(', '));
        }

        const isPreflight = request.method === 'OPTIONS' && !!request.header('access-control-request-method');

        if (!isPreflight) {
            return next();
        }

        const methods = options.methods && options.methods.length > 0
            ? options.methods
            : DEFAULT_METHODS;

        response.header('Access-Control-Allow-Methods', methods.join(', '));

        let allowedHeaders = options.allowedHeaders;

        if (!allowedHeaders) {
            const requested = request.header('access-control-request-headers');

            if (requested) {
                allowedHeaders = requested.split(',').map(h => h.trim()).filter(Boolean);
            }
        }

        if (allowedHeaders && allowedHeaders.length > 0) {
            response.header('Access-Control-Allow-Headers', allowedHeaders.join(', '));
            append_vary(response, 'Access-Control-Request-Headers');
        }

        if (typeof options.maxAge === 'number') {
            response.header('Access-Control-Max-Age', String(options.maxAge));
        }

        if (options.preflightContinue) {
            return next();
        }

        const status = options.optionsSuccessStatus ?? 204;
        response.status(status).setHeader('Content-Length', '0');
        return response.end();
    };
}
