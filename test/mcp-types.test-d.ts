// Copyright (c) 2026, Brandon Lehmann <brandonlehmann@gmail.com>
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
 * Compile-only regression suite for the MCP tool/prompt typing surface. This file is never
 * executed; it is type-checked by `tsconfig.test.json` as part of `yarn test:typecheck`.
 *
 * The guarantees locked in here:
 * 1. Inline tool literals inside `MCP.Router({ tools: [...] })` / `MCP.createServer({...})`
 *    get per-element callback `args` typed from `inputSchema` and a `structuredContent`
 *    return checked against `outputSchema` (fixed-arity signatures, up to 12 tools).
 * 2. A tool without `inputSchema` degrades only itself (`args` becomes `{}`, not `any`) and
 *    does not poison sibling elements.
 * 3. Arrays beyond the fixed arities fall back to a reverse-mapped signature that keeps
 *    `args` typed per element.
 * 4. `MCP.Tools([...])` / `MCP.Prompts([...])` give standalone arrays the same treatment,
 *    and `MCP.Tool({...})` remains the strictest per-element form (output mismatches are
 *    compile errors anchored at the element).
 * 5. Prompt `argsSchema` types flow into prompt callbacks everywhere.
 * 6. Legacy patterns (annotated `MCP.Tool[]` arrays, the `() => McpServer` factory) still
 *    compile unchanged.
 */

import { MCP, zod } from '../src';

// value-level sinks; structural checks that survive mapped-type aliasing
const expect_number = (value: number): number => value;
const expect_string = (value: string): string => value;
const expect_boolean = (value: boolean): boolean => value;
const sink = (value: unknown): unknown => value;

// ---------------------------------------------------------------------------
// 1. Inline tools + prompts in MCP.Router: per-element inference, multi-element
// ---------------------------------------------------------------------------

MCP.Router({
    implementation: { name: 'types-test', version: '0.0.0' },
    tools: [{
        name: 'add',
        title: 'Add',
        description: 'adds two numbers',
        inputSchema: { a: zod.number(), b: zod.number() },
        outputSchema: { sum: zod.number() },
        callback: async (args) => {
            expect_number(args.a);
            expect_number(args.b);
            // @ts-expect-error args.a is a number, not a string
            expect_string(args.a);
            return {
                structuredContent: { sum: args.a + args.b },
                content: [{ type: 'text', text: String(args.a + args.b) }]
            };
        }
    }, {
        name: 'greet',
        title: 'Greet',
        description: 'second element must infer independently of the first',
        inputSchema: { who: zod.string() },
        callback: async (args) => {
            expect_string(args.who);
            // @ts-expect-error args.who is a string, not a number
            expect_number(args.who);
            // @ts-expect-error the first element's keys must not bleed into this element
            sink(args.a);
            return { content: [{ type: 'text', text: args.who }] };
        }
    }, {
        name: 'noschema',
        title: 'NoSchema',
        description: 'a tool without inputSchema gets empty args, not any',
        callback: async (args) => {
            // @ts-expect-error args is {}; property access must fail rather than be any
            sink(args.anything);
            return { content: [{ type: 'text', text: 'ok' }] };
        }
    }],
    prompts: [{
        name: 'hello',
        title: 'Hello',
        description: 'prompt argsSchema flows into the callback',
        argsSchema: { name: zod.string() },
        callback: async (args) => {
            expect_string(args.name);
            // @ts-expect-error args.name is a string, not a number
            expect_number(args.name);
            return {
                messages: [{
                    role: 'user' as const,
                    content: { type: 'text' as const, text: `Hello, ${args.name}!` }
                }]
            };
        }
    }]
});

// ---------------------------------------------------------------------------
// 2. Same guarantees through MCP.createServer
// ---------------------------------------------------------------------------

MCP.createServer({
    implementation: { name: 'types-test', version: '0.0.0' },
    tools: [{
        name: 'add',
        title: 'Add',
        description: 'adds two numbers',
        inputSchema: { a: zod.number(), b: zod.number() },
        outputSchema: { sum: zod.number() },
        callback: async (args) => {
            expect_number(args.a);
            // @ts-expect-error args.b is a number, not a string
            expect_string(args.b);
            return {
                structuredContent: { sum: args.a + args.b },
                content: [{ type: 'text', text: '' }]
            };
        }
    }]
});

// ---------------------------------------------------------------------------
// 3. MCP.Tools: standalone arrays without per-element wrappers (Brandon's repro shape)
// ---------------------------------------------------------------------------

const ticket_info_schema = zod.object({
    opened_at: zod.string().nullable(),
    resolved_at: zod.string().nullable()
});

const Database = {
    fetch_ticket: async (ticket_number: number): Promise<{
        opened_at: string | null;
        resolved_at: string | null;
    } | undefined> => {
        sink(ticket_number);
        return undefined;
    }
};

const standalone_tools = MCP.Tools([{
    name: 'fetch_ticket',
    title: 'Fetch VSelect Ticket',
    description: 'Fetch a VSelect ticket and all of its entries by parent ticket number.',
    inputSchema: {
        ticket_number: zod.number().int().positive()
            .describe('The parent ticket number whose ticket entries should be fetched')
    },
    outputSchema: {
        found: zod.boolean(),
        ticket: ticket_info_schema.optional()
    },
    annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
    },
    callback: async (args) => {
        expect_number(args.ticket_number);
        // @ts-expect-error ticket_number is a number, not a string
        expect_string(args.ticket_number);

        const ticket = await Database.fetch_ticket(args.ticket_number);

        if (!ticket) {
            return {
                structuredContent: { found: false, ticket: undefined },
                content: [{ type: 'text', text: `No ticket found for ticket_number ${args.ticket_number}` }]
            };
        }

        return {
            structuredContent: { found: true, ticket },
            content: [{ type: 'text', text: JSON.stringify(ticket) }]
        };
    }
}, {
    name: 'second',
    title: 'Second',
    description: 'independent element in a standalone array',
    inputSchema: { who: zod.string() },
    callback: async (args) => {
        expect_string(args.who);
        return { content: [{ type: 'text', text: args.who }] };
    }
}]);

// the precise standalone tuple feeds straight into the router config
MCP.Router({
    implementation: { name: 'types-test', version: '0.0.0' },
    tools: standalone_tools
});

// ---------------------------------------------------------------------------
// 4. MCP.Tool: strictest per-element form; output mismatches are compile errors
// ---------------------------------------------------------------------------

MCP.Tool({
    name: 'typed',
    title: 'Typed',
    description: 'output mismatches are rejected at the element',
    inputSchema: { a: zod.number() },
    outputSchema: { sum: zod.number() },
    // @ts-expect-error structuredContent.sum must be a number, not a string
    callback: async (args) => ({
        structuredContent: { sum: String(args.a) },
        content: [{ type: 'text' as const, text: '' }]
    })
});

// ---------------------------------------------------------------------------
// 5. MCP.Prompts: standalone prompt arrays
// ---------------------------------------------------------------------------

const standalone_prompts = MCP.Prompts([{
    name: 'greet',
    title: 'Greet',
    description: 'greets a person by name',
    argsSchema: { name: zod.string() },
    callback: async (args) => {
        expect_string(args.name);
        // @ts-expect-error name is a string, not a number
        expect_number(args.name);
        return {
            messages: [{
                role: 'user' as const,
                content: { type: 'text' as const, text: `Hello, ${args.name}!` }
            }]
        };
    }
}, {
    name: 'count',
    title: 'Count',
    description: 'independent prompt element',
    argsSchema: { upTo: zod.number() },
    callback: async (args) => {
        expect_number(args.upTo);
        return {
            messages: [{
                role: 'user' as const,
                content: { type: 'text' as const, text: `Count to ${args.upTo}` }
            }]
        };
    }
}]);

MCP.Router({
    implementation: { name: 'types-test', version: '0.0.0' },
    prompts: standalone_prompts
});

// ---------------------------------------------------------------------------
// 6. Beyond the fixed arities (13 tools): fallback keeps args typed per element
// ---------------------------------------------------------------------------

MCP.Router({
    implementation: { name: 'types-test', version: '0.0.0' },
    tools: [
        {
            name: 't1',
            title: 'T1',
            description: 'first of thirteen',
            inputSchema: { a: zod.number() },
            callback: async (args) => {
                expect_number(args.a);
                // @ts-expect-error fallback must still type args per element
                expect_string(args.a);
                return { content: [{ type: 'text', text: '' }] };
            }
        },
        {
            name: 't2',
            title: 'T2',
            description: 'different schema, still independent',
            inputSchema: { b: zod.string() },
            callback: async (args) => {
                expect_string(args.b);
                return { content: [{ type: 'text', text: args.b }] };
            }
        },
        {
            name: 't3',
            title: 'T3',
            description: 'filler',
            inputSchema: { c: zod.boolean() },
            callback: async (args) => {
                expect_boolean(args.c);
                return { content: [{ type: 'text', text: '' }] };
            }
        },
        {
            name: 't4',
            title: 'T4',
            description: 'filler',
            inputSchema: { v: zod.number() },
            callback: async () => ({ content: [{ type: 'text' as const, text: '' }] })
        },
        {
            name: 't5',
            title: 'T5',
            description: 'filler',
            inputSchema: { v: zod.number() },
            callback: async () => ({ content: [{ type: 'text' as const, text: '' }] })
        },
        {
            name: 't6',
            title: 'T6',
            description: 'filler',
            inputSchema: { v: zod.number() },
            callback: async () => ({ content: [{ type: 'text' as const, text: '' }] })
        },
        {
            name: 't7',
            title: 'T7',
            description: 'filler',
            inputSchema: { v: zod.number() },
            callback: async () => ({ content: [{ type: 'text' as const, text: '' }] })
        },
        {
            name: 't8',
            title: 'T8',
            description: 'filler',
            inputSchema: { v: zod.number() },
            callback: async () => ({ content: [{ type: 'text' as const, text: '' }] })
        },
        {
            name: 't9',
            title: 'T9',
            description: 'filler',
            inputSchema: { v: zod.number() },
            callback: async () => ({ content: [{ type: 'text' as const, text: '' }] })
        },
        {
            name: 't10',
            title: 'T10',
            description: 'filler',
            inputSchema: { v: zod.number() },
            callback: async () => ({ content: [{ type: 'text' as const, text: '' }] })
        },
        {
            name: 't11',
            title: 'T11',
            description: 'filler',
            inputSchema: { v: zod.number() },
            callback: async () => ({ content: [{ type: 'text' as const, text: '' }] })
        },
        {
            name: 't12',
            title: 'T12',
            description: 'filler',
            inputSchema: { v: zod.number() },
            callback: async () => ({ content: [{ type: 'text' as const, text: '' }] })
        },
        {
            name: 't13',
            title: 'T13',
            description: 'thirteenth element exceeds the fixed arities',
            inputSchema: { final: zod.string() },
            callback: async (args) => {
                expect_string(args.final);
                return { content: [{ type: 'text', text: args.final }] };
            }
        }
    ]
});

// ---------------------------------------------------------------------------
// 7. Legacy patterns still compile (annotated arrays stay loosely typed by design)
// ---------------------------------------------------------------------------

const legacy_tools: MCP.Tool[] = [{
    name: 'legacy',
    title: 'Legacy',
    description: 'annotated arrays erase inference but must keep compiling',
    callback: async () => ({ content: [{ type: 'text', text: 'x' }] })
}];

MCP.Router({
    implementation: { name: 'types-test', version: '0.0.0' },
    tools: legacy_tools
});

MCP.Router(() => MCP.createServer({
    implementation: { name: 'types-test', version: '0.0.0' },
    tools: [MCP.Tool({
        name: 'wrapped',
        title: 'Wrapped',
        description: 'per-element wrapper keeps working',
        inputSchema: { q: zod.string() },
        callback: async (args) => {
            expect_string(args.q);
            return { content: [{ type: 'text', text: args.q }] };
        }
    })]
}));
