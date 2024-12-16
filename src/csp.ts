/**
export type KeywordValues = '\'none\'' | '\'self\'' | '\'strict-dynamic\''
    | '\'report-sample\'' | '\'inline-speculation-rules\'';

export type UnsafeKeywordValues = '\'unsafe-inline\'' | '\'unsafe-eval\''
    | '\'unsafe-hashes\'' | '\'wasm-unsafe-eval\'';

export type Values = KeywordValues | UnsafeKeywordValues | string;
export interface CSPOptions {
    'child-src': Values[];
    'connect-src': Values[];
    'default-src': Values[];
    'font-src': Values[];
    'frame-src': Values[];
    'img-src': Values[];
    'manifest-src': Values[];
    'media-src': Values[];
    'object-src': Values[];
    'prefetch-src': Values[];
    'script-src': Values[];
    'script-src-elem': Values[];
    'script-src-attr': Values[];
    'style-src': Values[];
    'style-src-elem': Values[];
    'style-src-attr': Values[];
    'worker-src': Values[];
    'report-to': string;

    [key: string]: string | Values[];
}

const options: Partial<CSPOptions> = {
    'default-src': ['\'self\'']
};
**/
