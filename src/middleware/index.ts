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

import Logging from './logging';
import RequestId from './request_id';
import RemoteIp from './remote_ip';
import Authorization from './authorization';
import Cors from './cors';
import RecommendedHeaders from './recommended_headers';
import ContentSecurityPolicy from './csp_headers';
import ProtectedRouter from './protected';
import ResponseTime from './response_time';
import XMLParser from './xml';
export { LogEntry } from './logging';
export { AuthenticationProvider } from './protected';
export { XMLParserOptions, XMLValidatorOptions } from './xml';

export default {
    Logging,
    RequestId,
    RemoteIp,
    Authorization,
    Cors,
    RecommendedHeaders,
    ContentSecurityPolicy,
    ProtectedRouter,
    ResponseTime,
    XMLParser
};
