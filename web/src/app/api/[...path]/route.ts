import { NextRequest, NextResponse } from 'next/server';

// Same-origin proxy to the TECHHUB API. The session token lives in an httpOnly cookie,
// so browser JavaScript (and any XSS) can never read it.
const API = (process.env.API_URL || 'http://localhost:4000').replace(/\/$/, '');
const COOKIE = 'th_token';

async function handler(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${API}/api/${path.join('/')}${req.nextUrl.search}`;
  const headers = new Headers();
  const ct = req.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  const ua = req.headers.get('user-agent');
  if (ua) headers.set('user-agent', ua);
  const xff = req.headers.get('x-forwarded-for');
  if (xff) headers.set('x-forwarded-for', xff);
  const token = req.cookies.get(COOKIE)?.value;
  if (token) headers.set('authorization', `Bearer ${token}`);
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: req.method, headers, body, redirect: 'manual', cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: 'Cannot reach the TECHHUB server. Please check your internet connection and try again.', code: 'offline' }, { status: 503 });
  }

  const isAuthCall = path[0] === 'auth' && (path[1] === 'login' || path[1] === 'register');
  if (isAuthCall && upstream.ok) {
    const data = await upstream.json();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, data.token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 12 });
    return res;
  }
  const res = new NextResponse(upstream.body, { status: upstream.status });
  for (const h of ['content-type', 'content-disposition', 'cache-control']) {
    const v = upstream.headers.get(h);
    if (v) res.headers.set(h, v);
  }
  if ((path[0] === 'auth' && path[1] === 'logout') || upstream.status === 401) res.cookies.delete(COOKIE);
  return res;
}
export { handler as GET, handler as POST, handler as PUT, handler as DELETE, handler as PATCH };
export const dynamic = 'force-dynamic';
