/**
 * Shape of `req.user` after the AuthMiddleware runs. Mirrors the client
 * `AuthUser` from `@codify/auth` so contracts stay in sync.
 *
 * The `userId` is the Prisma `User.id` (uuidv7) — not the Clerk subject.
 * Resolution from Clerk subject → Prisma User happens in the middleware
 * (lazy upsert in stub mode; lookup-or-create in Clerk mode).
 */
export interface ApiUser {
  userId: string;
  clerkId: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'SUPPORT' | 'ADMIN';
  displayName: string;
}

declare module 'express' {
  interface Request {
    user?: ApiUser;
  }
}
