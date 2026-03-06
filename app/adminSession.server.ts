import { createCookieSessionStorage, redirect } from "react-router";

// Fail fast on startup if critical secrets are not configured.
// This prevents running with insecure fallback values in production.
const SESSION_SECRET = process.env.SESSION_SECRET;
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;

if (!SESSION_SECRET) {
    throw new Error("[STARTUP ERROR] SESSION_SECRET environment variable is required but not set.");
}
if (!SUPER_ADMIN_PASSWORD) {
    throw new Error("[STARTUP ERROR] SUPER_ADMIN_PASSWORD environment variable is required but not set.");
}

// We'll use this session specifically for the Super Admin password protection
export const adminSessionStorage = createCookieSessionStorage({
    cookie: {
        name: "ta_super_admin_session",
        secure: true,
        secrets: [SESSION_SECRET],
        sameSite: "none",
        path: "/",
        httpOnly: true,
    },
});

export async function getAdminSession(request: Request) {
    const cookie = request.headers.get("Cookie");
    return adminSessionStorage.getSession(cookie);
}

export async function requireAdminAuth(request: Request) {
    const session = await getAdminSession(request);

    if (!session.has("adminId")) {
        throw redirect("/super-admin/login");
    }

    return session;
}

export { SUPER_ADMIN_PASSWORD };
