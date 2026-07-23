import { describe, it, expect } from 'vitest'
import { Semaphore } from './semaphore'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('Semaphore', () => {
  it('never exceeds the configured concurrency limit', async () => {
    const sem = new Semaphore(2)
    let concurrent = 0
    let maxConcurrent = 0

    const task = async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await delay(20)
      concurrent--
    }

    await Promise.all(Array.from({ length: 6 }, () => sem.run(task)))

    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })

  it('runs all queued tasks to completion', async () => {
    const sem = new Semaphore(1)
    const completed: number[] = []

    await Promise.all(
      [1, 2, 3, 4].map(n => sem.run(async () => {
        await delay(5)
        completed.push(n)
      }))
    )

    expect(completed.sort()).toEqual([1, 2, 3, 4])
  })

  it('releases the slot even when a task throws', async () => {
    const sem = new Semaphore(1)

    await expect(sem.run(async () => {
      throw new Error('task failed')
    })).rejects.toThrow('task failed')

    // If the failed task's slot wasn't released, this would hang.
    let ran = false
    await sem.run(async () => { ran = true })
    expect(ran).toBe(true)
  })

  it('processes waiters in FIFO order', async () => {
    const sem = new Semaphore(1)
    const order: number[] = []

    // Hold the only slot immediately so the next three calls all queue up.
    const releaseFirst = await sem.acquire()

    const p2 = sem.run(async () => { order.push(2) })
    const p3 = sem.run(async () => { order.push(3) })
    const p4 = sem.run(async () => { order.push(4) })

    order.push(1)
    releaseFirst()

    await Promise.all([p2, p3, p4])
    expect(order).toEqual([1, 2, 3, 4])
  })
})
