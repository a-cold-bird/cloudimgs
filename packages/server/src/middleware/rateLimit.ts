import { config } from '../config.js';

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

// In-memory rate limit store (for production, use Redis)
const ipLimitStore = new Map<string, RateLimitEntry>();
let globalRequestCount = 0;
let globalResetAt = Date.now() + config.rateLimit.windowMs;

// Clean up old entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of ipLimitStore.entries()) {
        if (entry.resetAt <= now) {
            ipLimitStore.delete(ip);
        }
    }
    // Reset global counter
    if (globalResetAt <= now) {
        globalRequestCount = 0;
        globalResetAt = now + config.rateLimit.windowMs;
    }
}, 60000); // Clean up every minute

/**
 * Get client IP from request
 */
function getClientIp(c: any): string {
    return (
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
        c.req.header('x-real-ip') ||
        c.req.header('cf-connecting-ip') ||
        'unknown'
    );
}

/**
 * Rate limiting middleware
 * @param customLimit - Optional custom limit (overrides default)
 */
export function rateLimit(customLimit?: number) {
    return async (c: any, next: any) => {
        // Skip if rate limiting is disabled
        if (!config.rateLimit.enabled) {
            return next();
        }

        const now = Date.now();
        const ip = getClientIp(c);
        const maxRequests = customLimit || config.rateLimit.maxRequests;

        // Check global limit first
        if (globalResetAt <= now) {
            globalRequestCount = 0;
            globalResetAt = now + config.rateLimit.windowMs;
        }

        if (globalRequestCount >= config.rateLimit.globalMaxRequests) {
            return c.json({
                error: '服务器请求过多，请稍后再试',
                retryAfter: Math.ceil((globalResetAt - now) / 1000),
            }, 429);
        }

        // Check per-IP limit
        let entry = ipLimitStore.get(ip);

        if (!entry || entry.resetAt <= now) {
            entry = {
                count: 0,
                resetAt: now + config.rateLimit.windowMs,
            };
            ipLimitStore.set(ip, entry);
        }

        if (entry.count >= maxRequests) {
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
            c.header('X-RateLimit-Limit', String(maxRequests));
            c.header('X-RateLimit-Remaining', '0');
            c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
            c.header('Retry-After', String(retryAfter));

            return c.json({
                error: '请求过于频繁，请稍后再试',
                retryAfter,
                limit: maxRequests,
            }, 429);
        }

        // Increment counters
        entry.count++;
        globalRequestCount++;

        // Set rate limit headers
        c.header('X-RateLimit-Limit', String(maxRequests));
        c.header('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));
        c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

        await next();
    };
}

/**
 * Get current rate limit stats (for admin dashboard)
 */
export function getRateLimitStats() {
    return {
        totalTrackedIPs: ipLimitStore.size,
        globalRequestCount,
        globalResetAt: new Date(globalResetAt).toISOString(),
        config: {
            windowMs: config.rateLimit.windowMs,
            maxRequests: config.rateLimit.maxRequests,
            globalMaxRequests: config.rateLimit.globalMaxRequests,
            enabled: config.rateLimit.enabled,
        },
    };
}
