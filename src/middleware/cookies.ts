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

type CookieValue = string | object;
type Cookies = { [key: string]: CookieValue };

declare global {
    namespace Express {
        interface Request {
            secret: string;
        }
    }
}

export default function middleware (secrets: CipherKey | CipherKey[]) {
    secrets = Array.isArray(secrets) ? secrets : [secrets];

    const JSONCookie = (cookie: string): object | undefined => {
        if (cookie.slice(0, 2) !== 'j:') {
            return undefined;
        }

        try {
            return JSON.parse(cookie.slice(2));
        } catch {
            return undefined;
        }
    };

    const JSONCookies = (cookies: Cookies): Cookies => {
        Object.keys(cookies).forEach(key => {
            if (typeof cookies[key] !== 'string') {
                return;
            }

            const value = JSONCookie(cookies[key]);

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

    return (request: express.Request, _response: express.Response, next: express.NextFunction) => {
        if (typeof request.cookies !== 'undefined') {
            return next();
        }

        request.secret = secrets[0].toString();
        request.cookies = Object.create(null);
        request.signedCookies = Object.create(null);

        const { cookie } = request.headers;

        if (!cookie) {
            return next();
        }

        const cookies = parse(cookie);

        Object.keys(cookies).forEach(key => {
            request.cookies[key] = cookies[key];
        });

        if (secrets.length !== 0) {
            request.signedCookies = signedCookies(request.cookies, secrets);
            request.signedCookies = JSONCookies(request.signedCookies);
        }

        request.cookies = JSONCookies(request.cookies);

        return next();
    };
}
