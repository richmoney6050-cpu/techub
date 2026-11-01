import { NextRequest, NextResponse } from 'next/server';

// Redirect signed-out visitors to /login. (The API still enforces everything; this is only for navigation.)
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const open = pathname.startsWith('/login') || pathname.startsWith('/register');
  const has = !!req.cookies.get('th_token');
  if (!has && !open) return NextResponse.redirect(new URL('/login', req.url));
  if (has && open) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api|_next|favicon.ico).*)'] };
