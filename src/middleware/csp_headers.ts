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

export type CSPDirectives = Record<string, string | string[] | undefined>;

/**
 * The default content security policy directives applied when no override is provided.
 */
const DEFAULT_DIRECTIVES: CSPDirectives = {
    'default-src': '\'self\''
};

const build_header = (directives: CSPDirectives): string =>
    Object.entries(directives)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => {
            const joined = Array.isArray(value) ? value.join(' ') : value;

            return joined ? `${key} ${joined}` : key;
        })
        .join('; ');

export default function middleware (directives?: CSPDirectives) {
    const header_value = build_header(directives ?? DEFAULT_DIRECTIVES);

    return (_request: express.Request, response: express.Response, next: express.NextFunction) => {
        response.header('Content-Security-Policy', header_value);

        return next();
    };
}
