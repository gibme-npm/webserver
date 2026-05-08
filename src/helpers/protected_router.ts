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

import express from 'express';
import AuthenticationGate, { AuthenticationProvider } from '../middleware/protected';
import { route_rewriter } from './route_rewriter';

export type ProtectedRouter = express.Router & {
    /**
     * Sets the authentication provider used to gate every route registered on this router.
     * The provider is consulted on each request, so calling this after routes are already
     * registered updates authentication for all of them.
     *
     * @param provider
     */
    setAuthenticationProvider: (provider?: AuthenticationProvider) => void;
};

/**
 * Creates a mountable Router instance whose routes are all gated by an authentication provider.
 * Behaves like the exported `Router()` factory (including optional route-parameter rewriting),
 * with the addition of `setAuthenticationProvider`.
 */
export function ProtectedRouter (): ProtectedRouter {
    const router = express.Router();
    let provider: AuthenticationProvider | undefined;

    router.use(AuthenticationGate(() => provider));

    return Object.assign(route_rewriter<express.Router>(router), {
        setAuthenticationProvider: (new_provider?: AuthenticationProvider) => {
            provider = new_provider;
        }
    });
}
