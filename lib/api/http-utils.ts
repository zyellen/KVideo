/**
 * HTTP Utilities for API calls
 * Handles timeouts and retries
 */

// Disable SSL verification for video sources with invalid certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const REQUEST_TIMEOUT = 15000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 200;

/**
 * 可选：为 Node 服务端 fetch 配置全局 HTTP/HTTPS 代理。
 * 仅在设置了 HTTP_PROXY / HTTPS_PROXY 环境变量时生效（见 docker-compose / .env.local）。
 * Edge runtime 不支持 setGlobalDispatcher，捕获异常静默跳过，不影响原逻辑。
 */
(function setupProxyDispatcher() {
    try {
        const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy ||
            process.env.HTTP_PROXY || process.env.http_proxy;
        if (!proxyUrl) return;
        // 动态引入 Node 内置 undici，避免在非 Node 环境下报错
        // @ts-ignore - 用 eval('require') 逃逸 webpack 静态分析（node: scheme 无法被打包）
        const { ProxyAgent, setGlobalDispatcher } = eval('require')('node:undici');
        setGlobalDispatcher(new ProxyAgent(proxyUrl));
        console.log(`[HTTP] 已启用代理: ${proxyUrl}`);
    } catch (err) {
        // Edge runtime 或不支持的环境下忽略，继续使用直连
        console.warn('[HTTP] 代理初始化跳过:', (err as Error)?.message);
    }
})();

/**
 * Fetch with timeout support
 * Accepts an optional external AbortSignal for cancellation cascade.
 */
export async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeout: number = REQUEST_TIMEOUT
): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // If an external signal is provided, propagate its abort
    const externalSignal = options.signal;
    let onAbort: (() => void) | undefined;
    if (externalSignal) {
        if (externalSignal.aborted) {
            controller.abort();
        } else {
            onAbort = () => controller.abort();
            externalSignal.addEventListener('abort', onAbort, { once: true });
        }
    }

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        return response;
    } finally {
        clearTimeout(timeoutId);
        if (externalSignal && onAbort) {
            externalSignal.removeEventListener('abort', onAbort);
        }
    }
}

/**
 * Retry logic wrapper
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    retries: number = MAX_RETRIES
): Promise<T> {
    let lastError: Error | null = null;

    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;

            if (lastError?.name === 'AbortError') {
                throw lastError;
            }

            if (i < retries) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
            }
        }
    }

    throw lastError;
}
