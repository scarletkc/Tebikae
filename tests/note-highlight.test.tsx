import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Highlight } from '../src/features/notes/NoteCard';

afterEach(cleanup);

it.each([
  { text: 'İstanbul tea', query: 'tea', matches: ['tea'] },
  { text: 'İ tea İ tea', query: 'tea', matches: ['tea', 'tea'] },
  { text: 'İstanbul tea', query: 'İstanbul tea', matches: ['İstanbul', 'tea'] },
  { text: 'İ🙂 tea', query: '🙂 tea', matches: ['🙂', 'tea'] },
  { text: '你好 TEA tea', query: '  tea  ', matches: ['TEA', 'tea'] },
  { text: 'ΟΣ tea', query: 'ος tea', matches: ['ΟΣ', 'tea'] },
  { text: 'tea teapot', query: 'tea teapot', matches: ['tea', 'teapot'] },
  { text: 'a.b [tea]', query: '. [tea]', matches: ['.', '[tea]'] },
  { text: 'İstanbul tea', query: 'coffee', matches: [] },
  { text: 'İstanbul tea', query: '   ', matches: [] },
])('highlights $query in $text without changing the text', ({ text, query, matches }) => {
  const { container } = render(<Highlight query={query} text={text} />);
  expect(container.textContent).toBe(text);
  expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(matches);
});
