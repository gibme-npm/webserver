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
 * Currently recommended headers to return with responses
 * @ignore
 */
const RecommendedHeaders: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, User-Agent',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE, PATCH',
    'Cache-Control': 'max-age=30, public',
    'Referrer-Policy': 'no-referrer',
    'Feature-Policy': [
        'accelerometer',
        'autoplay',
        'camera',
        'fullscreen',
        'geolocation',
        'gyroscope',
        'magnetometer',
        'microphone',
        'payment',
        'sync-xhr'
    ].map(elem => `${elem} 'none'`)
        .join('; ').trim(),
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
    ].map(elem => {
        if (elem === 'fullscreen') {
            return `${elem}=(self)`;
        }

        return `${elem}=()`;
    }).join(', ').trim()
};

export default function middleware () {
    return (_request: express.Request, response: express.Response, next: express.NextFunction) => {
        Object.entries(RecommendedHeaders)
            .forEach(([key, value]) => response.header(key, value));

        return next();
    };
}
