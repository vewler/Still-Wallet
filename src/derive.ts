import type { Session } from './vault'

type Job = { vault: string; mnemonic: string; account: number; root: string; slot: number }
class Unavailable extends Error {}

let worker: Worker | null | undefined
let ids = 0
const jobs = new Map<number, { done: (session: Session) => void; fail: (problem: Error) => void }>()

function failAll(problem: Error) {
  for (const job of jobs.values()) job.fail(problem)
  jobs.clear()
}

function open() {
  if (worker !== undefined) return worker
  try {
    const next = new Worker(new URL('./derive.worker.ts', import.meta.url), { type: 'module' })
    next.onmessage = ({ data }: MessageEvent<{ id: number; session?: Session; error?: string }>) => {
      const job = jobs.get(data.id)
      if (!job) return
      jobs.delete(data.id)
      if (data.session) job.done(data.session)
      else job.fail(new Error(data.error))
    }
    // Browsers without module workers make the keys on the page instead.
    next.onerror = () => { next.terminate(); if (worker === next) worker = null; failAll(new Unavailable()) }
    worker = next
  } catch { worker = null }
  return worker
}

/** A wallet's session, made in a worker so the page stays smooth. */
export async function deriveSession(job: Job): Promise<Session> {
  const target = open()
  if (target) {
    try {
      return await new Promise<Session>((done, fail) => {
        const id = ++ids
        jobs.set(id, { done, fail })
        target.postMessage({ id, ...job })
      })
    } catch (problem) {
      if (!(problem instanceof Unavailable)) throw problem
    }
  }
  return (await import('./vault')).sessionFor(job.vault, job.mnemonic, job.account, job.root, job.slot)
}

/** On lock the worker goes, with any phrases it held. */
export function stopDeriving() {
  worker?.terminate()
  worker = undefined
  failAll(new Error('Locked.'))
}
