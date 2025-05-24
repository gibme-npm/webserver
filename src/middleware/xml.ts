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

import express from 'express';
import XML from '@gibme/xml';

declare global {
    namespace Express {
        interface Request {
            _body?: string;
        }
    }
}

export type XMLParserOptions = XML.ParserOptions;

export type XMLValidatorOptions = XML.ValidatorOptions;

/**
 * Attempts to parse the request body as XML if the Content-Type header indicates that the request is
 * indeed XML.
 *
 * Note: This requires the use of the express.text() middleware to preload the request body as text
 *
 * @param parserOptions
 * @param validatorOptions
 */
export default function middleware (
    parserOptions: Partial<XMLParserOptions> = {},
    validatorOptions: Partial<XMLValidatorOptions> = {}
) {
    return async (request: express.Request, response: express.Response, next: express.NextFunction) => {
        const contentType = request.header('content-type') || '';

        if (/^(application|text)\/(xml|.*\+xml)/i.test(contentType)) {
            try {
                if (typeof request.body !== 'string') {
                    return response.status(400).send('Invalid XML: Request body is not of string type');
                }

                request._body = request.body.trim();

                if (request._body) {
                    request.body = await XML.parseXML(request._body, parserOptions, validatorOptions);
                } else {
                    request.body = {};
                }
            } catch (error: any) {
                request.body = request._body;
                delete request._body;

                return response.status(400).send(`Invalid XML: ${error.toString()}`);
            }
        }

        return next();
    };
}
