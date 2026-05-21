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

/**
 * Currently recommended response headers. CORS-related headers are intentionally
 * NOT emitted here; those belong to the CORS middleware. The legacy `Feature-Policy`
 * header is omitted because it has been superseded by `Permissions-Policy` in all
 * current browsers.
 *
 * @ignore
 */
const RecommendedHeaders: Record<string, string> = {
    'Cache-Control': 'max-age=30, public',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': [
        'geolocation',
        'midi',
        'sync-xhr',
        'microphone',
        'camera',
        'magnetometer',
        'gyroscope',
        'fullscreen',
        'payment'
    ].map(elem => elem === 'fullscreen' ? `${elem}=(self)` : `${elem}=()`)
        .join(', ').trim(),
    'X-Content-Type-Options': 'nosniff'
};

export default function middleware () {
    return (_request: express.Request, response: express.Response, next: express.NextFunction) => {
        Object.entries(RecommendedHeaders)
            .forEach(([key, value]) => response.header(key, value));

        return next();
    };
}
