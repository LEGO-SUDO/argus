// Root page — redirects to /chat if authenticated, /login otherwise.
//
// This keeps the bare `/` URL useful and avoids the placeholder scaffold
// banner once Phase A is wired.

import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/server-session';

export default async function HomePage() {
  const user = await getSessionUser();
  redirect(user ? '/chat' : '/login');
}
