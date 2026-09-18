import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { GraphStoreError } from './store.js'

export function resultsRoot(): string {
  return process.env.WRITING_PIPELINE_RESULTS_ROOT ?? resolve(process.env.WRITING_ROOT ?? process.cwd(), 'evals/results/proxy-pipeline')
}

/** One catalog pointer, never recursively follow aliases. */
export async function physicalNovelId(novelId: string, root = resultsRoot()): Promise<string> {
  const valid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
  const routedNovelId = valid.test(novelId)
    ? novelId
    : `project-${createHash('sha256').update(novelId).digest('hex').slice(0, 56)}`
  try {
    const catalog = JSON.parse(await readFile(join(root, '.novels', novelId, 'catalog.json'), 'utf8'))
    const target = catalog.graph_novel_id ?? routedNovelId
    if (typeof target !== 'string' || !valid.test(target)) throw new GraphStoreError('corrupt_store', 'invalid graph catalog pointer')
    return target
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return routedNovelId
    throw error
  }
}
