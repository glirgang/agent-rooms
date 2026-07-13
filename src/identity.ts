import type { Storage } from './storage.ts'

type IdentityDeps = {
  storage: Storage
  pid: number
  isAlive: (pid: number) => boolean
  validId: RegExp
}

function createIdentity({ storage, pid, isAlive, validId }: IdentityDeps) {
  let name: string | null = null
  const subscribed = new Set<string>()

  const persist = (): Promise<void> =>
    name
      ? storage.writeAgent({ name, pid, rooms: [...subscribed], registeredAt: new Date().toISOString() })
      : Promise.resolve()

  const register = async (candidate: string): Promise<{ name: string, rooms: string[] }> => {
    if (!validId.test(candidate)) throw new Error(`invalid name: "${candidate}" (use letters, digits, - and _)`)
    const existing = await storage.readAgent(candidate)
    if (existing && existing.pid !== pid && isAlive(existing.pid))
      throw new Error(`name "${candidate}" is in use by an active session (pid ${existing.pid})`)
    name = candidate
    subscribed.clear()
    const saved = existing?.rooms ?? []
    saved.forEach(r => subscribed.add(r))
    await persist()
    return { name, rooms: [...subscribed] }
  }

  const addRoom = async (room: string): Promise<void> => {
    subscribed.add(room)
    await persist()
  }

  const removeRoom = async (room: string): Promise<void> => {
    subscribed.delete(room)
    await persist()
  }

  const current = (): string | null => name

  return { register, addRoom, removeRoom, current }
}

type Identity = ReturnType<typeof createIdentity>

export { createIdentity }
export type { Identity }
