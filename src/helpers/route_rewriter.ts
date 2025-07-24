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

import Logger from '@gibme/logger';

export const route_rewriter = <OutType>(instance: any): OutType => {
    // Avoid accidental double processing
    if ((instance as any).__route_rewriter_patched) return instance as any;
    (instance as any).__route_rewriter_patched = true;

    const isStrict = typeof instance.get === 'function' && instance.get('strict routing') === true;

    const cleanRoute = (route: string): string => {
        const raw_clean = route.replace(/:([a-zA-Z0-9_]+)\?(?!\()/g, '');
        return isStrict
            ? raw_clean // leave as-is
            : raw_clean.replace(/\/+$/, '') || '/';
    };

    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'connect', 'trace', 'all']) {
        if (!(instance as any)[method]) continue;

        const original = (instance as any)[method].bind(instance);

        (instance as any)[method] = ((route: any, ...handlers: any[]) => {
            if (typeof route === 'string' && /:([a-zA-Z0-9_]+)\?(?!\()/g.test(route)) {
                const clean_route = cleanRoute(route);
                const full_route = route.replace(/\?/g, '');

                Logger.warn('⚠️ Patching optional route parameter: \'%s - [\':%s\', \'%s\'] (strict=%s)\'',
                    route,
                    clean_route,
                    full_route,
                    isStrict);

                // Register both routes
                original(clean_route, ...handlers);
                return original(full_route, ...handlers);
            }

            return original(route, ...handlers);
        }) as typeof original;
    }

    if ((instance as any).route) {
        const original = (instance as any).route.bind(instance);

        (instance as any).route = ((route: any) => {
            if (typeof route === 'string' && /:([a-zA-Z0-9_]+)\?(?!\()/g.test(route)) {
                const clean_route = cleanRoute(route);
                const full_route = route.replace(/\?/g, '');

                Logger.warn('⚠️ Patching optional route parameter: \'%s - [\':%s\', \'%s\'] (strict=%s)\'',
                    route,
                    clean_route,
                    full_route,
                    isStrict);

                // Register both routes
                original(clean_route);
                return original(full_route);
            }

            return original(route);
        }) as typeof original;
    }

    return instance as any;
};
