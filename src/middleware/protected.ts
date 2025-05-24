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

type AuthenticationResult = boolean | { statusCode: number; message?: any; };

export type AuthenticationProvider = (request: express.Request) => Promise<AuthenticationResult> | AuthenticationResult;

export default function middleware (provider?: AuthenticationProvider) {
    return async (request: express.Request, response: express.Response, next: express.NextFunction) => {
        if (!provider) {
            return next();
        }

        const authentication_result = await provider(request);

        if (typeof authentication_result !== 'boolean') {
            const { statusCode, message } = authentication_result;

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
        }

        if (!authentication_result) {
            response.setHeader('Content-Type', 'text/plain');

            return response.status(401).send('Unauthorized');
        }

        return next();
    };
}
