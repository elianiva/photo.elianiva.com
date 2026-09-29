/**
 * The verified admin session. The contract for it is in `@photo/shared`
 * (`GetSession`); the value is the Worker's alone, and it is provided per
 * request from the claims `verifyAdminAccess` just checked.
 */

import { Context } from 'effect'

export interface AdminSessionValue {
  /** The claim's address, or null on the `dev` stand-down. */
  readonly email: string | null
  /** The verified issuer, which is the base the Access logout lives under. */
  readonly teamDomain: string | null
}

export class AdminSession extends Context.Service<AdminSession, AdminSessionValue>()(
  'photo/AdminSession',
) {}
