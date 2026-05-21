// Copyright (c) 2025, Brandon Lehmann <brandonlehmann@gmail.com>
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

type AuthenticationDecision = boolean | { statusCode: number; message?: any; };

export type AuthenticationProvider = (
    request: express.Request
) => Promise<AuthenticationDecision> | AuthenticationDecision;

export type AuthenticationResult =
    | { ok: true }
    | { ok: false; statusCode: number; message?: any };

/**
 * Invokes an AuthenticationProvider against a request and normalizes the result.
 * Used by the HTTP gate middleware and the WebSocket upgrade path so both consume
 * the same decision semantics.
 *
 * Decision normalization:
 * - `true`  -> { ok: true }
 * - `false` -> { ok: false, statusCode: 401, message: 'Unauthorized' }
 * - `{ statusCode, message? }` passed through.
 */
export async function runAuthenticationProvider (
    provider: AuthenticationProvider,
    request: express.Request
): Promise<AuthenticationResult> {
    const decision = await provider(request);

    if (decision === true) {
        return { ok: true };
    }

    if (decision === false) {
        return { ok: false, statusCode: 401, message: 'Unauthorized' };
    }

    return { ok: false, statusCode: decision.statusCode, message: decision.message };
}

export default function middleware (getProvider: () => AuthenticationProvider | undefined) {
    return async (request: express.Request, response: express.Response, next: express.NextFunction) => {
        const provider = getProvider();

        if (!provider) {
            return next();
        }

        const result = await runAuthenticationProvider(provider, request);

        if (result.ok) {
            return next();
        }

        const { statusCode, message } = result;

        if (typeof message === 'string') {
            response.setHeader('Content-Type', 'text/plain');

            return response.status(statusCode).send(message);
        } else if (message) {
            response.setHeader('Content-Type', 'application/json');

            return response.status(statusCode).json(message);
        } else {
            response.setHeader('Content-Type', 'text/plain');

            return response.status(statusCode).send();
        }
    };
}
