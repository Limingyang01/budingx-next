// Session ownership for host entries (SP008 design §3, AC SO-01/SO-03/SH-05).
//
// Exactly one process may drive a session. The session store's writer.lock is
// the source of truth; the host only interprets it and exposes an explicit
// owner/observer role. Observers may read history but never write.
import type { HostErrorCode, HostRole } from './protocol.js'
import {
  SessionWriterLock,
  type WriterLockInfo
} from '../storage/session-store.js'

export type OwnershipObserverReason = 'active_owner' | 'stale_lock' | 'lost_lock'

export type OwnershipClaim =
  | { role: 'owner'; lock: SessionWriterLock }
  | {
      role: 'observer'
      reason: OwnershipObserverReason
      lock: SessionWriterLock
      info: WriterLockInfo
    }

export class HostOwnershipError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'HostOwnershipError'
  }
}

export type ClaimOwnershipOptions = {
  sessionId: string
  home?: string
  /**
   * Remove a stale lock from a crashed process and take it. A live owner is
   * still rejected: force never steals a running session.
   */
  force?: boolean
}

/** Claim the session for this process, or observe it read-only. */
export function claimSessionOwnership(options: ClaimOwnershipOptions): OwnershipClaim {
  const lock = new SessionWriterLock(options.sessionId, options.home)
  const acquired = lock.acquire(options.force ? { force: true } : {})
  if (acquired.acquired) return { role: 'owner', lock }
  const info = lock.inspect()
  return {
    role: 'observer',
    reason: info.active ? 'active_owner' : 'stale_lock',
    lock,
    info
  }
}

/**
 * Role holder for one host connection set. `refresh()` re-checks the lock
 * before every management request so a lost lock degrades to observer instead
 * of writing without ownership.
 */
export class SessionOwnershipRole {
  private current: HostRole
  private observerReason: OwnershipObserverReason
  private readonly lock: SessionWriterLock

  constructor(claim: OwnershipClaim) {
    this.current = claim.role
    this.observerReason = claim.role === 'observer' ? claim.reason : 'lost_lock'
    this.lock = claim.lock
  }

  get role(): HostRole {
    return this.current
  }

  get lockPath(): string {
    return this.lock.path
  }

  get reason(): OwnershipObserverReason | undefined {
    return this.current === 'observer' ? this.observerReason : undefined
  }

  canWrite(): boolean {
    return this.current === 'owner'
  }

  assertCanWrite(): void {
    if (!this.canWrite()) {
      throw new HostOwnershipError(
        'HOST_SESSION_003',
        'session is owned by another writer; this connection is read-only'
      )
    }
  }

  /**
   * Re-check ownership from disk. Returns the (possibly downgraded) role so
   * the server can broadcast role_changed when it flips.
   */
  refresh(): HostRole {
    if (this.current === 'observer') return this.current
    const info = this.lock.inspect()
    if (info.active && info.pid === process.pid) return 'owner'
    this.current = 'observer'
    this.observerReason = info.pid === undefined ? 'lost_lock' : info.active ? 'active_owner' : 'stale_lock'
    return this.current
  }

  /**
   * Explicit takeover. A stale lock is replaced; a live owner is refused with
   * HOST_SESSION_003 and keeps its lock untouched.
   */
  takeover(): 'owner' {
    if (this.current === 'owner') return 'owner'
    const acquired = this.lock.acquire({ force: true })
    if (!acquired.acquired) {
      throw new HostOwnershipError(
        'HOST_SESSION_003',
        'session is owned by another running process; stop it before taking over'
      )
    }
    this.current = 'owner'
    return 'owner'
  }

  release(): void {
    this.current = 'observer'
    this.observerReason = 'lost_lock'
    this.lock.release()
  }
}
