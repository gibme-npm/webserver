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
import { parse } from 'cookie';
import { unsign } from 'cookie-signature';
import type { CipherKey } from 'crypto';
import { ErrorSink, invoke_error_sink } from './error_sink';

type CookieValue = string | object;
type Cookies = { [key: string]: CookieValue };

declare global {
    namespace Express {
        interface Request {
            secret: string;
        }
    }
}

export type ParsedCookies = {
    cookies: Cookies;
    signedCookies: Cookies;
};

const JSONCookie = (cookie: string, errorSink?: ErrorSink): object | undefined => {
    if (cookie.slice(0, 2) !== 'j:') {
        return undefined;
    }

    try {
        return JSON.parse(cookie.slice(2));
    } catch (error) {
        invoke_error_sink(errorSink, error, 'cookie-json-parse');
        return undefined;
    }
};

const JSONCookies = (cookies: Cookies, errorSink?: ErrorSink): Cookies => {
    Object.keys(cookies).forEach(key => {
        if (typeof cookies[key] !== 'string') {
            return;
        }

        const value = JSONCookie(cookies[key], errorSink);

        if (value) {
            cookies[key] = value;
        }
    });

    return cookies;
};

const signedCookie = (cookie: string, secrets: CipherKey[]): string | false => {
    if (cookie.slice(0, 2) !== 's:') {
        return cookie;
    }

    for (let i = 0; i < secrets.length; i++) {
        const value = unsign(cookie.slice(2), secrets[i]);

        if (value !== false) {
            return value;
        }
    }

    return false;
};

const signedCookies = (
    cookies: Cookies,
    secrets: CipherKey[]
): Cookies => {
    const result: Cookies = Object.create(null);

    Object.keys(cookies).forEach(key => {
        const value = cookies[key];

        if (typeof value !== 'string') {
            return;
        }

        const decoded = signedCookie(value, secrets);

        if (decoded && value !== decoded) {
            cookies[key] = result[key] = decoded;
        }
    });

    return result;
};

/**
 * Pure parser exported so transports beyond the HTTP middleware chain (e.g. the
 * WebSocket upgrade path) can populate `request.cookies` / `request.signedCookies`
 * consistently. Returns empty maps when the cookie header is absent.
 */
export const parse_cookies = (
    cookieHeader: string | undefined,
    secrets: CipherKey[],
    errorSink?: ErrorSink
): ParsedCookies => {
    const result: ParsedCookies = {
        cookies: Object.create(null),
        signedCookies: Object.create(null)
    };

    if (!cookieHeader) return result;

    const parsed = parse(cookieHeader);

    Object.keys(parsed).forEach(key => {
        result.cookies[key] = parsed[key] as string;
    });

    if (secrets.length !== 0) {
        result.signedCookies = signedCookies(result.cookies, secrets);
        result.signedCookies = JSONCookies(result.signedCookies, errorSink);
    }

    result.cookies = JSONCookies(result.cookies, errorSink);

    return result;
};

export default function middleware (secrets: CipherKey | CipherKey[], errorSink?: ErrorSink) {
    const secretsArray = Array.isArray(secrets) ? secrets : [secrets];

    return (request: express.Request, _response: express.Response, next: express.NextFunction) => {
        if (typeof request.cookies !== 'undefined') {
            return next();
        }

        request.secret = secretsArray[0].toString();

        const parsed = parse_cookies(request.headers.cookie, secretsArray, errorSink);

        request.cookies = parsed.cookies;
        request.signedCookies = parsed.signedCookies;

        return next();
    };
}
