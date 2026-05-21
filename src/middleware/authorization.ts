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
import { ErrorSink, invoke_error_sink } from './error_sink';

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

export type AuthorizationData = NonNullable<express.Request['authorization']>;

/**
 * Pure parser exported so transports beyond the HTTP middleware chain (e.g. the
 * WebSocket upgrade path) can populate `request.authorization` consistently. Returns
 * undefined when no recognizable Basic or Bearer value can be extracted.
 */
export const parse_authorization_header = (
    headerValue: string | undefined,
    errorSink?: ErrorSink
): AuthorizationData | undefined => {
    if (!headerValue) return undefined;

    try {
        const [type, token] = headerValue.split(' ', 2);

        if (!type || !token) return undefined;

        if (type.toLowerCase() === 'basic') {
            const decoded = Buffer.from(token, 'base64').toString();
            const idx = decoded.indexOf(':');

            if (idx === -1) return undefined;

            return {
                type: 'Basic',
                basic: {
                    username: decoded.substring(0, idx),
                    password: decoded.substring(idx + 1)
                }
            };
        }

        if (type.toLowerCase() === 'bearer') {
            const data: AuthorizationData = {
                type: 'Bearer',
                bearer: { token }
            };

            if (token.includes('.')) {
                try {
                    const [header, payload, signature] = token.split('.');

                    if (header && payload && signature) {
                        data.jwt = {
                            header: JSON.parse(Buffer.from(header, 'base64url').toString()),
                            payload: JSON.parse(Buffer.from(payload, 'base64url').toString()),
                            signature
                        };
                    }
                } catch (error) {
                    invoke_error_sink(errorSink, error, 'authorization-decode');
                    // bearer token is still valid even if it isn't a JWT;
                    // surface the decode failure but keep the bearer data.
                }
            }

            return data;
        }

        return undefined;
    } catch (error) {
        invoke_error_sink(errorSink, error, 'authorization-decode');
        return undefined;
    }
};

export default function middleware (errorSink?: ErrorSink) {
    return (request: express.Request, _response: express.Response, next: express.NextFunction) => {
        const authorization = parse_authorization_header(request.header('authorization'), errorSink);

        if (authorization) {
            request.authorization = authorization;
        }

        return next();
    };
}
