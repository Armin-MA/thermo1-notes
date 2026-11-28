const SKIP_TAGS = new Set(['code', 'pre', 'kbd', 'script', 'style', 'svg', 'math']);

const PAIR_RX =
  /(?<![0-9\u06f0-\u06f9A-Za-z_])((?:[\u06f0-\u06f9]+|(?<![\u0621-\u06cc])ج)([\-–])([\u06f0-\u06f9]+))(?![0-9\u06f0-\u06f9A-Za-z_\-–])/g;

function hasSkipClass(node) {
  const cls = node?.properties?.className;
  if (!cls) return false;
  const list = Array.isArray(cls) ? cls : String(cls).split(/\s+/);
  return list.some((c) => c === 'katex' || c === 'jh-numpair' || c === 'jh-inline-eq');
}

function hasLtrJsxAttr(node) {
  if (!Array.isArray(node?.attributes)) return false;
  return node.attributes.some(
    (attr) => attr && attr.name === 'dir' && attr.value === 'ltr'
  );
}

function shouldSkipElement(node) {
  if (!node) return false;
  if (node.type === 'element') {
    if (SKIP_TAGS.has(node.tagName)) return true;
    if (node.properties?.dir === 'ltr') return true;
    if (hasSkipClass(node)) return true;
  } else if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
    if (SKIP_TAGS.has(node.name)) return true;
    if (hasLtrJsxAttr(node)) return true;
  }
  return false;
}

function splitTextToHastNodes(value) {
  PAIR_RX.lastIndex = 0;
  if (!PAIR_RX.test(value)) return null;
  PAIR_RX.lastIndex = 0;

  const nodes = [];
  let last = 0;
  let match;

  while ((match = PAIR_RX.exec(value)) !== null) {
    if (match.index > last) {
      nodes.push({ type: 'text', value: value.slice(last, match.index) });
    }
    const full = match[1];
    const sep = match[2];
    const sepIdx = full.indexOf(sep);
    const first = full.slice(0, sepIdx);
    const second = full.slice(sepIdx + sep.length);

    nodes.push({
      type: 'element',
      tagName: 'span',
      properties: { className: ['jh-numpair'], dir: 'rtl' },
      children: [
        {
          type: 'element',
          tagName: 'bdi',
          properties: {},
          children: [{ type: 'text', value: first }],
        },
        { type: 'text', value: sep },
        {
          type: 'element',
          tagName: 'bdi',
          properties: {},
          children: [{ type: 'text', value: second }],
        },
      ],
    });
    last = PAIR_RX.lastIndex;
  }

  if (last < value.length) {
    nodes.push({ type: 'text', value: value.slice(last) });
  }
  return nodes;
}

function visitChildren(parent) {
  if (!parent || !Array.isArray(parent.children)) return;

  const nextChildren = [];
  let changed = false;

  for (const child of parent.children) {
    if (child.type === 'text') {
      const replacement = splitTextToHastNodes(child.value);
      if (replacement) {
        nextChildren.push(...replacement);
        changed = true;
      } else {
        nextChildren.push(child);
      }
    } else if (
      child.type === 'element' ||
      child.type === 'mdxJsxFlowElement' ||
      child.type === 'mdxJsxTextElement'
    ) {
      if (!shouldSkipElement(child)) {
        visitChildren(child);
      }
      nextChildren.push(child);
    } else if (Array.isArray(child.children)) {
      visitChildren(child);
      nextChildren.push(child);
    } else {
      nextChildren.push(child);
    }
  }

  if (changed) {
    parent.children = nextChildren;
  }
}

/**
 * Rehype plugin that wraps Persian hyphenated chapter/equation/problem/range pairs
 * so their right-to-left visual order never flips inside parentheses, tables, or headings.
 */
export default function rehypePersianNumpair() {
  return (tree) => {
    visitChildren(tree);
  };
}
