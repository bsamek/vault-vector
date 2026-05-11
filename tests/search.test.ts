import { describe, expect, it } from 'vitest';
import { renderSnippet } from '../src/search';

describe('renderSnippet', () => {
  it('returns content unchanged when shorter than the limit', () => {
    expect(renderSnippet('hello world', 200)).toBe('hello world');
  });

  it('truncates with an ellipsis when over the limit', () => {
    const long = 'a'.repeat(300);
    const out = renderSnippet(long, 200);
    expect(out.length).toBe(200);
    expect(out.endsWith('…')).toBe(true);
  });

  it('collapses whitespace and newlines into single spaces', () => {
    expect(renderSnippet('  hello\n\n  world\n', 200)).toBe('hello world');
  });

  it('uses a default max of 200 chars when not specified', () => {
    const long = 'x'.repeat(500);
    expect(renderSnippet(long).length).toBe(200);
  });
});
