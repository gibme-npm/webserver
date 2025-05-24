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

declare global {
    namespace Express {
        interface Request {
            /**
             * Authorization information decoded from the request headers.
             */
            authorization?: {
                /**
                 * The type of authorization used
                 */
                type: 'Basic' | 'Bearer';
                /**
                 * Basic authorization information
                 */
                basic?: {
                    /**
                     * The username supplied
                     */
                    username: string;
                    /**
                     * The password supplied
                     */
                    password: string;
                };
                /**
                 * Bearer authorization information
                 */
                bearer?: {
                    /**
                     * The token supplied
                     */
                    token: string;
                }
                /**
                 * JWT authorization information
                 */
                jwt?: {
                    /**
                     * The JWT header
                     */
                    header: {
                        alg: string;
                        typ?: string;
                    };
                    /**
                     * The JWT payload
                     */
                    payload: Record<string, any>;
                    /**
                     * The JWT signature
                     */
                    signature: string;
                }
            }
        }
    }
}

export default function middleware () {
    return (request: express.Request, _response: express.Response, next: express.NextFunction) => {
        const authorization = request.header('authorization');

        if (authorization) {
            try {
                const [type, token] = authorization.split(' ', 2);

                if (type.toLowerCase() === 'basic') {
                    const [username, password] = Buffer.from(token, 'base64').toString().split(':');

                    if (username && password) {
                        request.authorization = {
                            type: 'Basic',
                            basic: {
                                username,
                                password
                            }
                        };
                    }
                } else if (type.toLowerCase() === 'bearer') {
                    request.authorization = {
                        type: 'Bearer',
                        bearer: {
                            token
                        }
                    };

                    if (token.includes('.')) {
                        const [header, payload, signature] = token.split('.');

                        if (header && payload && signature) {
                            request.authorization.jwt = {
                                header: JSON.parse(Buffer.from(header, 'base64url').toString()),
                                payload: JSON.parse(Buffer.from(payload, 'base64url').toString()),
                                signature
                            };
                        }
                    }
                }
            } catch {
            }
        }

        return next();
    };
}
