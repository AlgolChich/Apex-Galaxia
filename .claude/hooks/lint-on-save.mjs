#!/usr/bin/env node
// PostToolUse hook: lint a chapter when Claude Code writes or edits one.
// Reads the hook JSON from stdin, runs the tier-one linter through the built CLI, and returns
// the hits as additional context. Never blocks (the tool already ran); exit 0 always.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    const file = payload?.tool_input?.file_path;
    if (typeof file !== 'string' || !/[\\/]chapters[\\/][^\\/]+\.md$/.test(file)) {
      process.exit(0);
    }
    const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const cli = path.join(projectDir, 'packages', 'cli', 'dist', 'bin.js');
    if (!existsSync(cli)) {
      process.exit(0);
    }
    // The story project is the folder that holds chapters/.
    const storyRoot = path.dirname(path.dirname(file));
    const result = spawnSync(process.execPath, [cli, 'lint', file, '--project', storyRoot], {
      encoding: 'utf8',
      env: { ...process.env, APEX_GALAXIA_RESOURCES: projectDir },
    });
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (text.length > 0) {
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: `Apex Galaxia lint for ${path.basename(file)}:\n${text}`,
          },
        }),
      );
    }
  } catch {
    // never fail the hook
  }
  process.exit(0);
});
