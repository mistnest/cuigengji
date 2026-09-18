#!/usr/bin/env node
import { resolve } from 'node:path'
import { commitChapterMemory } from './memory-commit.js'

const argv=process.argv.slice(2); const values=new Map<string,string>(); const handoffs:string[]=[]
for(let i=0;i<argv.length;i+=2){const key=argv[i],value=argv[i+1];if(!key||!value||!key.startsWith('--'))throw new Error('arguments must use --name value pairs');if(key==='--handoff')handoffs.push(resolve(value));else values.set(key.slice(2),value)}
const required=(name:string)=>{const value=values.get(name);if(!value)throw new Error(`--${name} is required`);return value}
try { const receipt=await commitChapterMemory({handoffPaths:handoffs,receiptPath:resolve(required('receipt')),novelId:required('novel-id'),graphRoot:resolve(required('graph-root')),serverPath:resolve(required('server'))}); process.stdout.write(`${JSON.stringify(receipt,null,2)}\n`) }
catch(error){process.stderr.write(`novel-graph-chapter-memory-commit: ${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1}
