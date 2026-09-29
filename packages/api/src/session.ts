/**
 * The verified admin session. The contract for it is in `@photo/shared`
 * (`GetSession`); the value is the Worker's alone, and it is provided per
 * request from the email `verifyAdminAccess` just checked.
 */

import { Context } from 'effect'

export class AdminSession extends Context.Service<
  AdminSession,
  { readonly email: string | null }
>()('photo/AdminSession') {}
