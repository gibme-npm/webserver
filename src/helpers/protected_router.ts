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

/**
 * Brand symbol stamped on every router produced by `ProtectedRouter()`.
 * Used by other helpers (e.g. the WebSocket `applyTo` integration) to detect a
 * ProtectedRouter without coupling to its concrete type.
 */
export const ProtectedRouterBrand: unique symbol = Symbol.for('@gibme/webserver/protected-router');

const STANDARD_VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all', 'connect', 'trace'] as const;
const ROUTE_VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'] as const;

export type ProtectedRouter = express.Router & {
    /**
     * Sets the authentication provider used to gate every route registered on this router.
     * The provider is consulted on each request, so calling this after routes are already
     * registered updates authentication for all of them.
     *
     * @param provider
     */
    setAuthenticationProvider: (provider?: AuthenticationProvider) => void;
    /**
     * Internal accessor returning the currently-configured authentication provider.
     * Used by transports outside the HTTP middleware chain (e.g. the WebSocket
     * upgrade path) so they can inherit the router's auth without snapshotting it.
     *
     * @internal
     */
    _protectedRouterProvider: () => AuthenticationProvider | undefined;
    /**
     * Brand marker used by other helpers to detect a ProtectedRouter without coupling
     * to its concrete type. Always `true` on ProtectedRouter instances.
     */
    readonly [ProtectedRouterBrand]: true;
};

/**
 * Creates a mountable Router instance whose routes registered via verb methods
 * (`get`/`post`/`put`/`patch`/`delete`/`head`/`options`/`all`/`connect`/`trace`)
 * or `route()` are all gated by an authentication provider. Middleware registered
 * via `router.use(...)` is intentionally NOT auto-gated; the gate is route-scoped
 * to keep mount-order behavior predictable for downstream callers.
 *
 * Behaves like the exported `Router()` factory (including optional route-parameter
 * rewriting), with the addition of `setAuthenticationProvider`.
 */
export function ProtectedRouter (): ProtectedRouter {
    const router = express.Router();
    let provider: AuthenticationProvider | undefined;
    const gate = AuthenticationGate(() => provider);

    // Apply optional-route-parameter rewriting first so our gate-prepending patch
    // below wraps the rewriter's verb methods (and thus registers the gate for
    // both expanded routes when an optional parameter is in play).
    const rewritten = route_rewriter<express.Router>(router);

    type ProtectMode = 'router' | 'route';

    const protectVerb = (instance: any, method: string, mode: ProtectMode = 'router') => {
        if (typeof instance[method] !== 'function') return;
        if (instance.__protected_verb_methods?.has?.(method)) return;

        const original = instance[method].bind(instance);

        instance[method] = (...args: any[]) => {
            if (mode === 'route') {
                // IRoute verb methods take handlers only (no path argument).
                return original(gate, ...args);
            }

            // Router verb methods take (path, ...handlers). Defensive: if the
            // caller passed a function as the first arg (middleware-style),
            // forward as-is rather than synthesizing a route.
            if (typeof args[0] === 'function') {
                return original(...args);
            }

            const [route, ...handlers] = args;

            return original(route, gate, ...handlers);
        };

        instance.__protected_verb_methods ??= new Set<string>();
        instance.__protected_verb_methods.add(method);
    };

    for (const verb of STANDARD_VERBS) {
        protectVerb(rewritten, verb, 'router');
    }

    if (typeof (rewritten as any).route === 'function') {
        const originalRoute = (rewritten as any).route.bind(rewritten);

        (rewritten as any).route = (path: any) => {
            const irRoute = originalRoute(path);

            for (const verb of ROUTE_VERBS) {
                protectVerb(irRoute, verb, 'route');
            }

            return irRoute;
        };
    }

    Object.defineProperty(rewritten, ProtectedRouterBrand, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false
    });

    return Object.assign(rewritten, {
        setAuthenticationProvider: (new_provider?: AuthenticationProvider) => {
            provider = new_provider;
        },
        _protectedRouterProvider: () => provider
    }) as ProtectedRouter;
}
