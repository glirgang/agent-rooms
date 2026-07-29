import type { Storage } from './storage.ts'

type IdentityDeps = {
  storage: Storage
  pid: number
  cwd: string
  isAlive: (pid: number) => boolean
  validId: RegExp
}

function createIdentity({ storage, pid, cwd, isAlive, validId }: IdentityDeps) {
  let name: string | null = null
  const subscribed = new Set<string>()

  const register = async (candidate: string): Promise<{ name: string, rooms: string[] }> => {
    if (!validId.test(candidate)) throw new Error(`invalid name: "${candidate}" (use letters, digits, - and _)`)
    const previous = name
    if (previous && previous !== candidate)
      await Promise.all([...subscribed].map(room => storage.deleteMember(room, previous)))
    name = candidate
    subscribed.clear()
    const memberships = await storage.listMemberships(candidate)
    const mine = memberships.filter(m => m.cwd === cwd && (m.pid === pid || !isAlive(m.pid)))
    await Promise.all(mine.map(m => storage.writeMember({ name: candidate, room: m.room, pid, cwd, joinedAt: m.joinedAt })))
    mine.forEach(m => subscribed.add(m.room))
    return { name: candidate, rooms: [...subscribed] }
  }

  const addRoom = async (room: string): Promise<void> => {
    const me = name
    if (!me) throw new Error('Register this session first with register_name.')
    if (subscribed.has(room)) return
    const existing = await storage.readMember(room, me)
    if (existing && existing.pid !== pid && isAlive(existing.pid))
      throw new Error(`name "${me}" is already taken in #${room} by an active session (pid ${existing.pid})`)
    await storage.writeMember({ name: me, room, pid, cwd, joinedAt: new Date().toISOString() })
    subscribed.add(room)
  }

  const removeRoom = async (room: string): Promise<void> => {
    const me = name
    if (me) await storage.deleteMember(room, me)
    subscribed.delete(room)
  }

  const current = (): string | null => name

  return { register, addRoom, removeRoom, current }
}

type Identity = ReturnType<typeof createIdentity>

export { createIdentity }
export type { Identity }
