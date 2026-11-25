import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { InfoTip } from './ui';
import { SearchSelect } from './SearchSelect';
import { describeFilter, normalizeTags, tagKey, type TagFilter, type TagRule } from './tags';
import './tags.css';

/**
 * A small field that adds a new tag on Enter (or a comma), beside a dropdown of the project's existing tags with a search
 * box to find one.
 */
function TagInput({ label, suggestions, exclude, onAdd, disabled, autoFocus, onCancel }: {
  label: string; suggestions: string[]; exclude: string[]; onAdd: (tag: string) => void; disabled?: boolean; autoFocus?: boolean; onCancel?: () => void;
}) {
  const [value, setValue] = useState('');
  const taken = new Set(exclude.map(tagKey));
  const add = () => {
    const tag = value.replace(/,/g, ' ').trim();
    if (tag && !taken.has(tagKey(tag))) onAdd(tag.slice(0, 60));
    setValue('');
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); }
    else if (event.key === 'Escape') { setValue(''); onCancel?.(); }
  };
  return <>
    <input className="tag-input" aria-label={label} placeholder="Add a tag…" value={value} disabled={disabled} maxLength={60} autoFocus={autoFocus}
      // Leaving the field adds what was typed but keeps it open: closing it on blur would shift the layout under the click that moved focus.
      onChange={event => setValue(event.target.value)} onKeyDown={keyDown} onBlur={() => { if (value.trim()) add(); }} />
    {suggestions.some(tag => !taken.has(tagKey(tag))) && <SearchSelect label={`${label}: existing tags`} hideLabel className="tag-picker" value={undefined} placeholder="Choose…" disabled={disabled}
      options={suggestions.filter(tag => !taken.has(tagKey(tag))).map(tag => ({ value: tag, label: tag }))} onChange={tag => { setValue(''); onAdd(tag); }} />}
  </>;
}

function Chip({ children, onRemove, label, tone, disabled }: { children: ReactNode; onRemove: () => void; label: string; tone?: 'not'; disabled?: boolean }) {
  return <span className={`tag-chip${tone ? ` tag-chip-${tone}` : ''}`}>{children}
    {!disabled && <button type="button" aria-label={label} title={label} onClick={onRemove}><X size={11} /></button>}</span>;
}

/** A component's list of tags, edited as chips. */
export function TagListField({ label, hint, tags, suggestions, onChange, disabled, empty = 'No tags' }: {
  label: string; hint?: string; tags: string[]; suggestions: string[]; onChange: (tags: string[]) => void; disabled?: boolean; empty?: string;
}) {
  return <div className="field tag-field" role="group" aria-label={label}>
    <span>{label}{hint && <InfoTip text={hint} />}</span>
    <div className="tag-chips">
      {tags.map(tag => <Chip key={tag} label={`Remove ${tag}`} disabled={disabled} onRemove={() => onChange(tags.filter(other => other !== tag))}>{tag}</Chip>)}
      {!tags.length && disabled && <span className="tag-empty">{empty}</span>}
      {!disabled && <TagInput label={`Add ${label.toLowerCase()}`} suggestions={suggestions} exclude={tags} onAdd={tag => onChange(normalizeTags([...tags, tag]))} />}
    </div>
  </div>;
}

/**
 * A tag filter as plain rules: each rule lists tags a component must have and tags it must not have, and a component
 * fits when it matches any rule. No brackets or operators to type.
 */
export function TagFilterEditor({ label, filter, suggestions, onChange, disabled, hint, anything = 'Any piece can join.', untagged = 'Pieces without tags always fit.' }: {
  label: string; filter: TagFilter; suggestions: string[]; onChange: (filter: TagFilter) => void; disabled?: boolean; hint?: string; anything?: string; untagged?: string;
}) {
  const [adding, setAdding] = useState<{ rule: number; part: 'has' | 'lacks' }>();
  const rules = filter.anyOf;
  const setRule = (index: number, rule: TagRule | undefined) => onChange({ anyOf: rule ? rules.map((other, n) => n === index ? rule : other) : rules.filter((_, n) => n !== index) });
  const part = (rule: TagRule, index: number, key: 'has' | 'lacks') => {
    const tags = rule[key], open = adding?.rule === index && adding.part === key;
    return <div className={`filter-part filter-${key}`}>
      <span className="filter-part-label">{key === 'has' ? 'Has' : 'But not'}</span>
      <div className="tag-chips">
        {tags.map(tag => <Chip key={tag} tone={key === 'lacks' ? 'not' : undefined} disabled={disabled} label={`Remove ${key === 'has' ? '' : 'not '}${tag} from rule ${index + 1}`}
          onRemove={() => setRule(index, { ...rule, [key]: tags.filter(other => other !== tag) })}>{key === 'lacks' && <span className="visually-hidden">not </span>}{tag}</Chip>)}
        {!tags.length && !open && <span className="tag-empty">{key === 'has' ? 'any tags' : 'nothing excluded'}</span>}
        {!disabled && (open
          ? <TagInput label={`Tag pieces ${key === 'has' ? 'must have' : 'must not have'} for rule ${index + 1}`} suggestions={suggestions} exclude={[...rule.has, ...rule.lacks]} autoFocus
            onAdd={tag => setRule(index, { ...rule, [key]: normalizeTags([...tags, tag]) })} onCancel={() => setAdding(undefined)} />
          : <button type="button" className="tag-add" aria-label={`Add a tag pieces ${key === 'has' ? 'must have' : 'must not have'} to rule ${index + 1}`} onClick={() => setAdding({ rule: index, part: key })}><Plus size={11} /></button>)}
      </div>
    </div>;
  };
  return <div className="field tag-filter" role="group" aria-label={label}>
    <span>{label}{hint && <InfoTip text={hint} />}</span>
    <p className="filter-summary" aria-live="polite">{rules.length ? <>Takes <strong>{describeFilter(filter)}</strong>.</> : anything} {untagged}</p>
    {rules.map((rule, index) => <div key={index}>
      {index > 0 && <div className="filter-or" aria-hidden="true"><span>or</span></div>}
      <div className="filter-rule" role="group" aria-label={`Rule ${index + 1}`}>
        {part(rule, index, 'has')}
        {part(rule, index, 'lacks')}
        {!disabled && <button type="button" className="icon-button filter-remove" aria-label={`Remove rule ${index + 1}`} title="Remove this rule" onClick={() => { setAdding(undefined); setRule(index, undefined); }}><X size={13} /></button>}
      </div>
    </div>)}
    {!disabled && <button type="button" className="text-button filter-add-rule" onClick={() => { onChange({ anyOf: [...rules, { has: [], lacks: [] }] }); setAdding({ rule: rules.length, part: 'has' }); }}>
      <Plus size={12} /> {rules.length ? 'Or pieces with…' : 'Only some pieces…'}</button>}
  </div>;
}
