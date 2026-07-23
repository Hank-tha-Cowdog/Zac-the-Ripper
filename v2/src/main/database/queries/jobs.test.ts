import { describe, it, expect } from 'vitest'
import { buildJobListWhere } from './jobs'

describe('buildJobListWhere', () => {
  it('returns an empty WHERE clause and no params when no filters are given', () => {
    const result = buildJobListWhere()
    expect(result.where).toBe('')
    expect(result.params).toEqual([])
  })

  it('filters by discId alone', () => {
    const result = buildJobListWhere({ discId: 42 })
    expect(result.where).toBe(' WHERE jobs.disc_id = ?')
    expect(result.params).toEqual([42])
  })

  it('filters by status alone', () => {
    const result = buildJobListWhere({ status: 'failed' })
    expect(result.where).toBe(' WHERE jobs.status = ?')
    expect(result.params).toEqual(['failed'])
  })

  it('combines discId and status with AND', () => {
    const result = buildJobListWhere({ discId: 1, status: 'completed' })
    expect(result.where).toBe(' WHERE jobs.disc_id = ? AND jobs.status = ?')
    expect(result.params).toEqual([1, 'completed'])
  })

  it('search matches against title, disc title, and output path with wildcards on both sides', () => {
    const result = buildJobListWhere({ search: 'batman' })
    expect(result.where).toBe(' WHERE (jobs.movie_title LIKE ? OR discs.title LIKE ? OR jobs.output_path LIKE ?)')
    expect(result.params).toEqual(['%batman%', '%batman%', '%batman%'])
  })

  it('combines all three filter types together', () => {
    const result = buildJobListWhere({ discId: 5, status: 'completed', search: 'show' })
    expect(result.where).toBe(
      ' WHERE jobs.disc_id = ? AND jobs.status = ? AND (jobs.movie_title LIKE ? OR discs.title LIKE ? OR jobs.output_path LIKE ?)'
    )
    expect(result.params).toEqual([5, 'completed', '%show%', '%show%', '%show%'])
  })

  it('ignores an empty-string search rather than matching everything', () => {
    const result = buildJobListWhere({ search: '' })
    expect(result.where).toBe('')
    expect(result.params).toEqual([])
  })

  it('ignores a falsy discId of 0 (no job legitimately has id 0, but guards against accidental undefined-as-0 coercion)', () => {
    const result = buildJobListWhere({ discId: 0 })
    expect(result.where).toBe('')
  })
})
