// Copyright (c) 2026, Brandon Lehmann <brandonlehmann@gmail.com>
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
import { sign, unsign } from 'cookie-signature';
import { parse, serialize, SerializeOptions } from 'cookie';
import { randomBytes, timingSafeEqual } from 'crypto';
import type { CipherKey } from 'crypto';
import { ErrorSink, invoke_error_sink } from './error_sink';

declare global {
    namespace Express {
        interface Request {
            /**
             * Returns the CSRF token for this request. Lazily generates a token and
             * sets the cookie on the response if one is not already present. Only
             * available when the CSRF middleware is installed.
             */
            csrfToken?: () => string;
        }
    }
}

export type CSRFSecret = CipherKey | (() => CipherKey);

export type CSRFOptions = {
    /**
     * Secret used to sign the CSRF cookie. Accepts a literal `CipherKey` or a
     * callback (useful when the secret rotates with `cookieSecret`).
     */
    secret: CSRFSecret;
    /**
     * Cookie name carrying the signed token. Defaults to the `__Host-csrf` prefix,
     * which requires `secure: true`, no `Domain`, and `Path=/`. Override the name
     * for HTTP dev environments where the `__Host-` prefix cannot be honored.
     * @default '__Host-csrf'
     */
    cookieName?: string;
    /**
     * Header name read on unsafe requests.
     * @default 'x-csrf-token'
     */
    headerName?: string;
    /**
     * Body field name read on unsafe requests when no header is present.
     * @default '_csrf'
     */
    bodyField?: string;
    /**
     * Set-Cookie attribute overrides. Defaults: `SameSite=Strict`, `Secure`,
     * `HttpOnly=false`, `Path=/`.
     */
    cookieOptions?: SerializeOptions;
    /**
     * HTTP methods exempt from token verification.
     * @default ['GET', 'HEAD', 'OPTIONS']
     */
    ignoreMethods?: string[];
    /** Predicate; when truthy the request bypasses verification. */
    skip?: (request: express.Request) => boolean;
    /** Error sink invoked on verification failures. */
    errorSink?: ErrorSink;
};

const DEFAULT_IGNORE = ['GET', 'HEAD', 'OPTIONS'];
const DEFAULT_COOKIE_NAME = '__Host-csrf';
const DEFAULT_HEADER_NAME = 'x-csrf-token';
const DEFAULT_BODY_FIELD = '_csrf';

const generate_token = (): string => randomBytes(24).toString('base64url');

const safe_equal = (a: string, b: string): boolean => {
    const A = Buffer.from(a);
    const B = Buffer.from(b);

    // timingSafeEqual throws on length mismatch, so guard explicitly.
    if (A.length !== B.length) return false;

    return timingSafeEqual(A, B);
};

const reject = (response: express.Response, reason: string) => {
    response.setHeader('Content-Type', 'text/plain');
    return response.status(403).send(reason);
};

export default function middleware (options: CSRFOptions) {
    if (!options.secret) {
        throw new Error('CSRF: secret is required');
    }

    const cookieName = options.cookieName ?? DEFAULT_COOKIE_NAME;
    const headerName = options.headerName ?? DEFAULT_HEADER_NAME;
    const bodyField = options.bodyField ?? DEFAULT_BODY_FIELD;
    const ignoreMethods = options.ignoreMethods ?? DEFAULT_IGNORE;
    const cookieOptions: SerializeOptions = {
        sameSite: 'strict',
        secure: true,
        httpOnly: false,
        path: '/',
        ...options.cookieOptions
    };
    const get_secret = (): CipherKey => typeof options.secret === 'function' ? options.secret() : options.secret;

    return (request: express.Request, response: express.Response, next: express.NextFunction) => {
        const secret = get_secret();

        // Prefer the value the cookies middleware already parsed (when installed)
        // so we don't reparse the cookie header on every request. Fall back to
        // parsing the raw header directly.
        const upstreamCookies = request.cookies as Record<string, unknown> | undefined;
        const upstreamValue = upstreamCookies?.[cookieName];
        const raw = typeof upstreamValue === 'string'
            ? upstreamValue
            : (request.headers.cookie ? parse(request.headers.cookie)[cookieName] : undefined);

        let currentToken: string | undefined;

        if (raw) {
            const candidate = raw.startsWith('s:') ? raw.slice(2) : raw;
            const result = unsign(candidate, secret);

            if (result !== false) {
                currentToken = result;
            }
        }

        const ensureToken = (): string => {
            if (currentToken) return currentToken;

            currentToken = generate_token();

            const signed = sign(currentToken, secret);

            response.setHeader('Set-Cookie', serialize(cookieName, 's:' + signed, cookieOptions));

            return currentToken;
        };

        request.csrfToken = () => ensureToken();

        if (options.skip && options.skip(request)) {
            return next();
        }

        if (ignoreMethods.includes(request.method)) {
            ensureToken();
            return next();
        }

        if (!currentToken) {
            invoke_error_sink(options.errorSink, new Error('csrf cookie missing'), 'csrf-verify');
            return reject(response, 'CSRF cookie missing');
        }

        const headerToken = request.header(headerName);
        const bodyToken = (request.body && typeof request.body === 'object')
            ? (request.body as Record<string, unknown>)[bodyField]
            : undefined;

        const provided = (typeof headerToken === 'string' && headerToken) ||
            (typeof bodyToken === 'string' && bodyToken) ||
            undefined;

        if (!provided || !safe_equal(provided, currentToken)) {
            invoke_error_sink(options.errorSink, new Error('csrf token mismatch'), 'csrf-verify');
            return reject(response, 'CSRF token mismatch');
        }

        return next();
    };
}
