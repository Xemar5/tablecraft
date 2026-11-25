import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createPortableZip, readPortableZip } from '../src/portable';
import { starterProject } from '../src/templates';

const scripted = () => ({
  ...starterProject(), name: 'Scripted',
  scripts: [{ id: 'script-rules', name: 'Rules / main', source: 'function onLoad() memory.round = 1 end\n' }, { id: 'script-ui', name: 'UI', source: '-- buttons\n' }],
  memory: { round: 3, names: ['Ada'] },
});

describe('scripts and memory in ZIP saves', () => {
  it('are saved as .lua files and memory.json next to project.json, and load back', () => {
    const project = scripted();
    const zip = createPortableZip({ format: 'tablecraft', version: 1, projects: [project] });
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(['memory.json', 'project.json', 'scripts/1-Rules-main.lua', 'scripts/2-UI.lua']);
    expect(strFromU8(files['scripts/1-Rules-main.lua'])).toBe(project.scripts[0].source);
    expect(JSON.parse(strFromU8(files['memory.json']))).toEqual(project.memory);
    const manifest = JSON.parse(strFromU8(files['project.json']));
    expect(manifest.projects[0].scripts[0]).toEqual({ id: 'script-rules', name: 'Rules / main', path: 'scripts/1-Rules-main.lua' });
    expect(manifest.projects[0].memory).toBeUndefined();
    const read = readPortableZip(zip);
    expect(read.kind === 'archive' && read.archive.projects[0]).toMatchObject({ scripts: project.scripts, memory: project.memory });
  });

  it('keep projects apart in a workspace ZIP, and still load saves with scripts inside project.json', () => {
    const zip = createPortableZip({ format: 'tablecraft', version: 1, projects: [scripted(), { ...scripted(), id: 'second' }] });
    expect(Object.keys(unzipSync(zip)).filter(name => name !== 'project.json').sort())
      .toEqual(['1-memory.json', '2-memory.json', 'scripts/1-1-Rules-main.lua', 'scripts/1-2-UI.lua', 'scripts/2-1-Rules-main.lua', 'scripts/2-2-UI.lua']);
    const old = zipSync({ 'project.json': strToU8(JSON.stringify({ format: 'tablecraft', version: 1, projects: [scripted()] })) });
    const read = readPortableZip(old);
    expect(read.kind === 'archive' && read.archive.projects[0].scripts?.[1].source).toBe('-- buttons\n');
    // A missing script file is an error, not a silently empty script.
    const files = unzipSync(createPortableZip({ format: 'tablecraft', version: 1, projects: [scripted()] }));
    delete files['scripts/2-UI.lua'];
    expect(() => readPortableZip(zipSync(files))).toThrow('Missing script UI');
  });
});
