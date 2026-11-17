// Contact sheet: renders every component variant with the app's own renderer.
// Open /games/arcane-assembly/preview.html while `npm run dev` is running.
// Query: ?c=<id filter>&s=<scale>&back (render back faces)
import { createRoot } from 'react-dom/client';
import { ComponentView } from '../../src/ComponentView';
import '../../src/styles.css';
import type { Component } from '../../src/domain';

const params = new URLSearchParams(location.search);
const filter = params.get('c') ?? '', scale = Number(params.get('s') ?? 1), back = params.has('back');

async function main() {
  const archive = await (await fetch(`./arcane-assembly.tablecraft.json?t=${Date.now()}`)).json();
  const components: Component[] = archive.projects[0].components;
  const shown = components.filter(c => c.id.includes(filter));
  const view = (c: Component, row: number, key: string) => <div className="cell" key={key} style={{ width: c.width * scale, height: c.height * scale }}>
    <div style={{ transform: `scale(${scale})` }}><ComponentView component={c} components={components} row={row} /></div>
  </div>;
  if (params.has('pairs')) {
    // Each linked action next to a support, as players would slide them together.
    const byId = (id: string) => components.find(c => c.id === id)!;
    createRoot(document.getElementById('root')!).render(<div className="grid">
      {['brass', 'verdant', 'cinder', 'star'].filter(f => f.includes(filter)).flatMap(f => {
        const action = byId(`aa-${f}-actions`), support = byId(`aa-${f}-supports`);
        return action.rows.flatMap((r, i) => r.support === 'yes' ? [<div key={`${f}-${i}`} style={{ display: 'flex' }}>
          {view(action, i, 'a')}{view(support, i % support.rows.length, 's')}
        </div>] : []);
      })}
    </div>);
    return;
  }
  createRoot(document.getElementById('root')!).render(<div className="grid">
    {shown.map(c => <>
      <h2 key={`${c.id}-title`}>{c.name}</h2>
      {(back ? [{}] : c.rows.length ? c.rows : [{}]).map((_, row) => <div className="cell" key={`${c.id}-${row}`} style={{ width: c.width * scale, height: c.height * scale }}>
        <div style={{ transform: `scale(${scale})` }}><ComponentView component={c} components={components} row={row} back={back} /></div>
      </div>)}
    </>)}
  </div>);
}
void main();
