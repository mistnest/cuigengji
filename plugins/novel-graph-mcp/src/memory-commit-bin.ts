#!/usr/bin/env node
/** Command-line entry point for committing one scene handoff through MCP. */

import { resolve } from 'node:path'

import { commitSceneMemory } from './memory-commit.js'

function argumentsMap(argv: string[]): Map<string, string> {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === undefined || value === undefined || !key.startsWith('--')) {
      throw new Error('arguments must use --name value pairs')
    }
    values.set(key.slice(2), value)
  }
  return values
}

try {
  const values = argumentsMap(process.argv.slice(2))
  const required = (name: string): string => {
    const value = values.get(name)
    if (!value) throw new Error(`--${name} is required`)
    return value
  }
  const receipt = await commitSceneMemory({
    handoffPath: resolve(required('handoff')),
    receiptPath: resolve(required('receipt')),
    novelId: required('novel-id'),
    graphRoot: resolve(required('graph-root')),
    serverPath: resolve(required('server')),
  })
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`novel-graph-memory-commit: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
