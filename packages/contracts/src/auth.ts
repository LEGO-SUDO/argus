// Auth REST DTOs — request and response shapes for /auth/{signup,login,logout}.
//
// The session cookie carries opaque value. Bodies never include the cookie —
// it's set as Set-Cookie on the response. The DTOs here are the body shapes
// the controller accepts and the JSON envelope it returns.
import { z } from 'zod';

export const SignupRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthResponseSchema = z.object({
  userId: z.string().uuid(),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// GET /auth/session — server-side session hydration.
//
// Returned only when the session cookie validates AND the user row still
// exists. If the user has been deleted while the session cookie is still
// valid, the endpoint returns 401 (and clears the cookie) rather than a
// partial response — both fields here are guaranteed present.
export const SessionResponseSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
