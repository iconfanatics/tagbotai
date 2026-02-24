import { createCookieSessionStorage, redirect } from "react-router";

// We'll use this session specifically for the Super Admin password protection
export const adminSessionStorage = createCookieSessionStorage({
    cookie: {
        name: "ta_super_admin_session",
        secure: process.env.NODE_ENV === "production",
        secrets: [process.env.SESSION_SECRET || "fallback_admin_secret"],
        sameSite: "lax",
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
