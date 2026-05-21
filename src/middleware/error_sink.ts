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

/**
 * Stable error-context identifiers used when surfacing internally-swallowed
 * errors to a caller-supplied `ErrorSink`.
 */
export type ErrorSinkContext =
    | 'authorization-decode'
    | 'cookie-json-parse'
    | 'logging-callback'
    | 'rate-limit-store'
    | 'csrf-verify'
    | 'websocket-auth'
    | 'websocket-write';

/**
 * Optional sink for internal errors that would otherwise be silently swallowed.
 * Implementations should be cheap and non-throwing; thrown sink errors are caught
 * and ignored to avoid recursive failure paths.
 */
export type ErrorSink = (error: unknown, context: ErrorSinkContext) => void;

/**
 * Safely invokes an `ErrorSink`. Catches and discards any error the sink throws
 * so a misbehaving sink cannot disrupt request handling.
 */
export const invoke_error_sink = (sink: ErrorSink | undefined, error: unknown, context: ErrorSinkContext) => {
    if (!sink) return;

    try {
        sink(error, context);
    } catch {
        // intentionally swallow - never let a sink turn into a crash vector
    }
};
