import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import { ComponentView } from './ComponentView';
import type { Component, Project } from './domain';
import { DEFAULT_PRINT_OPTIONS, MM_PER_PX, PAPER_SIZES, printLayout, type PaperSize, type PrintOptions, type PrintPage } from './printLayout';
import { Field, Modal, NumberField, Toggle } from './ui';
import './print.css';

/**
 * Prints every copy of a project's pieces (see printLayout) through the browser's print dialog, where "Save as PDF"
 * turns the pages into a PDF. The pages are only rendered while printing.
 */
export function PrintDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [options, setOptions] = useState<PrintOptions>(DEFAULT_PRINT_OPTIONS);
  const [cutLines, setCutLines] = useState(true);
  const [printing, setPrinting] = useState(false);
  const set = (patch: Partial<PrintOptions>) => setOptions(current => ({ ...current, ...patch }));
  const pages = useMemo(() => printLayout(project, options), [project, options]);
  const fronts = pages.filter(page => page.side === 'front');
  const copies = fronts.reduce((total, page) => total + page.items.length, 0);
  const shrunk = fronts.some(page => page.items.some(item => item.shrunk));
  return <>
    <Modal title="Print to PDF" subtitle="Every piece in this project, at print size: table pieces, stacks, hands, book pages and dice faces." onClose={onClose}>
      <div className="print-dialog">
        <div className="field-grid">
          <Field label="Paper"><select value={options.paper} onChange={event => set({ paper: event.target.value as PaperSize })}>
            {Object.entries(PAPER_SIZES).map(([id, paper]) => <option key={id} value={id}>{paper.name} ({paper.width} × {paper.height} mm)</option>)}
          </select></Field>
          <NumberField label="Scale (%)" hint="At 100%, 96 px of a component print one inch (25.4 mm) wide." value={Math.round(options.scale * 100)} min={10} max={400}
            onChange={scale => set({ scale: scale / 100 })} />
          <NumberField label="Gap (mm)" value={options.gap} min={0} max={20} step={.5} onChange={gap => set({ gap })} />
          <NumberField label="Page margin (mm)" value={options.margin} min={0} max={40} onChange={margin => set({ margin })} />
        </div>
        <Toggle label="Cut lines" description="A light dashed outline around every piece" checked={cutLines} onChange={setCutLines} />
        <Toggle label="Double-sided backs" description="Each page of fronts is followed by the backs of its flippable pieces, mirrored to line up when printed on both sides (flip on the long edge)"
          checked={options.backs} onChange={backs => set({ backs })} />
        <Toggle label="Components not on the table" description="Also print one copy of each variant of components with no pieces" checked={options.unplaced} onChange={unplaced => set({ unplaced })} />
        <p className="print-summary" role="status">
          {copies ? `${copies} ${copies === 1 ? 'copy' : 'copies'} on ${fronts.length} ${fronts.length === 1 ? 'page' : 'pages'}${options.backs ? `, plus ${fronts.length} ${fronts.length === 1 ? 'page' : 'pages'} of backs` : ''}.` : 'Nothing to print yet: place some pieces, or include components not on the table.'}
          {shrunk && ' Pieces larger than the page are shrunk to fit.'}
        </p>
        <p className="help-text">In the print dialog, choose <strong>Save as PDF</strong> to get a PDF, and print it at actual size (100%).</p>
        <div className="modal-actions"><button className="button" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={!copies || printing} onClick={() => setPrinting(true)}><Printer size={15} /> Print or save as PDF</button></div>
      </div>
    </Modal>
    {printing && <PrintPages pages={pages} paper={options.paper} components={project.components} cutLines={cutLines} onDone={() => setPrinting(false)} />}
  </>;
}

/** The pages themselves, shown only by the print stylesheet. Opens the print dialog once fonts and pictures are ready. */
function PrintPages({ pages, paper, components, cutLines, onDone }: {
  pages: PrintPage[]; paper: PaperSize; components: Component[]; cutLines: boolean; onDone: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let cancelled = false;
    const finish = () => { if (!cancelled) done.current(); };
    window.addEventListener('afterprint', finish, { once: true });
    void (async () => {
      await document.fonts?.ready;
      const images = [...root.current?.querySelectorAll('img') ?? []];
      await Promise.all(images.map(image => image.complete ? undefined : new Promise(resolve => { image.addEventListener('load', resolve); image.addEventListener('error', resolve); })));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      // The pages stay until the print dialog closes (afterprint) or this dialog does.
      if (!cancelled) window.print();
    })();
    return () => { cancelled = true; window.removeEventListener('afterprint', finish); };
  }, []);
  const size = PAPER_SIZES[paper];
  return createPortal(<div ref={root} className="print-root" data-theme-fixed aria-hidden="true">
    <style>{`@page { size: ${size.width}mm ${size.height}mm; margin: 0; }`}</style>
    {pages.map((page, index) => <section key={index} className={`print-page print-${page.side}`} data-page={index + 1} style={{ width: `${size.width}mm`, height: `${size.height}mm` }}>
      {page.items.map((item, at) => <div key={at} className={`print-item${cutLines && !item.back ? ' cut-line' : ''}`} data-component={item.component.name}
        style={{ left: `${item.x}mm`, top: `${item.y}mm`, width: `${item.width}mm`, height: `${item.height}mm` }}>
        <div style={{ width: item.component.width, height: item.component.height, transformOrigin: 'top left',
          transform: `scale(${item.width / MM_PER_PX / item.component.width})` }}>
          <ComponentView component={item.component} components={components} row={item.row} back={item.back} />
        </div>
      </div>)}
    </section>)}
  </div>, document.body);
}
