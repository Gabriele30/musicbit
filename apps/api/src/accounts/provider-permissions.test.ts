import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
describe('native provider restrictions', () => {
  it('blocks SQLite, process bindings, child processes and account-file reads even outside mocked supervision', () => {
    const program = `const results={};for(const [key,run] of Object.entries({sqlite:()=>require('node:sqlite'),binding:()=>process.binding('sqlite'),child:()=>require('node:child_process').execFileSync(process.execPath,['-e','']),file:()=>require('node:fs').readFileSync('data/musicbit.sqlite')})){try{run();results[key]='ALLOWED';}catch(e){results[key]=e.code;}}console.log(JSON.stringify(results));`;
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--permission',
          '--no-experimental-sqlite',
          '--no-addons',
          '-e',
          program,
        ],
        {
          encoding: 'utf8',
          env: {
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
          },
        },
      ),
    );
    expect(result).toEqual({
      sqlite: 'ERR_UNKNOWN_BUILTIN_MODULE',
      binding: 'ERR_ACCESS_DENIED',
      child: 'ERR_ACCESS_DENIED',
      file: 'ERR_ACCESS_DENIED',
    });
  });
});
