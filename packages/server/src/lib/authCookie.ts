import crypto from 'crypto';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { config } from '../config.js';

export const AUTH_COOKIE_NAME = 'cloudimgs_auth';

function getExpectedAuthCookieValue(): string {
    const password = config.auth.password || '';
    return crypto.createHash('sha256').update(`cloudimgs-auth:${password}`).digest('hex');
}

function getFirstQueryValue(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
}

export function hasValidPasswordAccess(c: any): boolean {
    if (!config.auth.enabled) return true;

    const expectedPassword = config.auth.password || '';
    const fromHeader = c.req.header('x-access-password');
    const fromQuery = getFirstQueryValue(c.req.query('password'));
    if ((fromHeader && fromHeader === expectedPassword) || (fromQuery && fromQuery === expectedPassword)) {
        return true;
    }

    const cookieValue = getCookie(c, AUTH_COOKIE_NAME);
    if (!cookieValue) return false;
    return cookieValue === getExpectedAuthCookieValue();
}

export function setPasswordAuthCookie(c: any) {
    const secure = c.req.header('x-forwarded-proto') === 'https' || c.req.url.startsWith('https://');
    setCookie(c, AUTH_COOKIE_NAME, getExpectedAuthCookieValue(), {
        httpOnly: true,
        sameSite: 'Lax',
        secure,
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
    });
}

export function clearPasswordAuthCookie(c: any) {
    deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
}
