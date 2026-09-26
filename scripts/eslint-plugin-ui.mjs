// ESLint rules that keep every screen on the UI kit (src/ui) and the tokens in src/styles/theme.css.
// Registered as the `ui` plugin in eslint.config.js and run by `pnpm lint`; see
// docs/ui-overhaul-plan.md section 3.7 for the reasoning behind each rule.
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const KIT_DIR = resolve(ROOT, 'src/ui');
const KIT_INDEX = resolve(KIT_DIR, 'index.ts');

/** Files outside src/ui that may still use Radix primitives and the raw menu classes. */
const MENU_BUILDERS = new Set(['src/app/ContextMenu.tsx']);

const MENU_CLASSES = new Set([
  'menuSurface',
  'menuContent',
  'menuItem',
  'menuRadioItem',
  'menuItemDanger',
  'menuSeparator',
  'menuLabel',
  'menuIndicator',
]);

/** Names exported by src/ui/index.ts (components and helpers), read once per lint run. */
const KIT_EXPORTS = (() => {
  const names = new Set();
  const source = readFileSync(KIT_INDEX, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  for (const [, list] of source.matchAll(/export\s*\{([^}]*)\}/g))
    for (const part of list.split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop();
      if (name) names.add(name);
    }
  return names;
})();

const projectPath = (context) => relative(ROOT, context.filename).replaceAll('\\', '/');
const inKit = (context) => projectPath(context).startsWith('src/ui/');

function jsxName(node) {
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') return `${jsxName(node.object)}.${node.property.name}`;
  return '';
}

function attribute(opening, name) {
  return opening.attributes.find((attr) => attr.type === 'JSXAttribute' && attr.name.name === name);
}

/** Literal value of a JSX attribute such as variant="link"; undefined when absent or dynamic. */
function literalAttribute(opening, name) {
  const attr = attribute(opening, name);
  if (!attr) return undefined;
  if (attr.value?.type === 'Literal') return attr.value.value;
  if (attr.value?.type === 'JSXExpressionContainer' && attr.value.expression.type === 'Literal')
    return attr.value.expression.value;
  return null;
}

const BUTTONS = 'Button, IconButton, NavItem (sidebar rows) or StretchedButton (card titles)';
const nativeControls = {
  input: 'Input, Checkbox, FileInput or ColorInput',
  select: 'Select',
  textarea: 'Textarea',
  button: BUTTONS,
};

const noNativeControls = {
  meta: {
    type: 'problem',
    docs: { description: 'Buttons and form controls come from the UI kit so they share one look.' },
    messages: {
      native: '<{{name}}> outside src/ui: use {{replacement}} from src/ui instead.',
      role: `role="button" outside src/ui: use ${BUTTONS} from src/ui instead.`,
    },
    schema: [],
  },
  create(context) {
    if (inKit(context)) return {};
    return {
      JSXOpeningElement(node) {
        const name = jsxName(node.name);
        if (name in nativeControls)
          context.report({ node, messageId: 'native', data: { name, replacement: nativeControls[name] } });
        else if (literalAttribute(node, 'role') === 'button') context.report({ node, messageId: 'role' });
      },
    };
  },
};

const kitImports = {
  meta: {
    type: 'problem',
    docs: { description: 'Use the UI kit only through its public index, and never copy its internals.' },
    messages: {
      deep: 'Import the UI kit from its index (src/ui), not from "{{source}}".',
      menuClass:
        '{{name}} is internal to menus: build menus with <Menu>/<MenuContent>/<MenuItem> from src/ui (right-click menus: src/app/ContextMenu.tsx).',
      alias: '{{name}} is a UI kit export; import it from src/ui instead of "{{source}}".',
      reexport: 'Do not re-export UI kit parts ({{name}}) from another module; import them from src/ui.',
      radix:
        'Radix primitives are wrapped by the UI kit: use Menu, Select, Dialog, Sheet or ConfirmDialog from src/ui.',
    },
    schema: [],
  },
  create(context) {
    if (inKit(context)) return {};
    const file = projectPath(context);
    const here = dirname(context.filename);
    const kitNames = new Set();
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== 'string') return;
        if (source.startsWith('@radix-ui/')) {
          if (!MENU_BUILDERS.has(file)) context.report({ node, messageId: 'radix' });
          return;
        }
        if (!source.startsWith('.')) return;
        const target = resolve(here, source);
        const isKitIndex = target === KIT_DIR || target === KIT_INDEX.replace(/\.ts$/, '');
        if (!isKitIndex && target.startsWith(KIT_DIR + sep)) {
          context.report({ node, messageId: 'deep', data: { source } });
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;
          const name = specifier.imported.name;
          if (isKitIndex) {
            kitNames.add(specifier.local.name);
            if (MENU_CLASSES.has(name) && !MENU_BUILDERS.has(file))
              context.report({ node: specifier, messageId: 'menuClass', data: { name } });
          } else if (KIT_EXPORTS.has(name) && name !== 'cn') {
            context.report({ node: specifier, messageId: 'alias', data: { name, source } });
          }
        }
      },
      ExportNamedDeclaration(node) {
        for (const specifier of node.specifiers ?? []) {
          const name = specifier.local.name;
          if (kitNames.has(name) || (node.source && KIT_EXPORTS.has(name)))
            context.report({ node: specifier, messageId: 'reexport', data: { name } });
        }
      },
      ExportAllDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== 'string' || !source.startsWith('.')) return;
        const target = resolve(here, source);
        if (target === KIT_DIR || target.startsWith(KIT_DIR + sep))
          context.report({ node, messageId: 'reexport', data: { name: `* from "${source}"` } });
      },
    };
  },
};

// Utility families whose values are theme tokens. Arbitrary values ([...]) bypass the tokens.
const TOKEN_ONLY =
  /^-?(?:font|leading|tracking|rounded(?:-[a-z]{1,2})?|shadow|inset-shadow|drop-shadow|z|opacity|blur|backdrop-blur)-\[/;
// Color-capable families may take an arbitrary value only when it is derived from tokens (var(--…)).
// A plain length there is a line width (border-[1.5px]), except for text-, where it is a font size.
const COLOR_CAPABLE =
  /^-?(text|bg|border(?:-[xytrblse])?|outline|ring|inset-ring|ring-offset|fill|stroke|decoration|accent|caret|placeholder|divide)-\[(.+)\]$/;
const LENGTH = /^(?:length:)?\d*\.?\d+(?:px|rem|em)?$/;
// Spacing and sizes take a plain length ([42px], [26rem]) only as a scale step (px-10, max-w-104).
// Values that compute something (calc, min, max, env, var) or use %, vw, dvh … stay allowed.
const SPACING =
  /^-?(?:[pm][xytrblse]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|start|end|(?:min-|max-)?[wh]|size|basis|indent|scroll-[pm][xytrblse]?|translate-[xy])-\[(.+)\]$/;
const PLAIN_LENGTH = /^-?\d*\.?\d+(?:px|rem|em)$/;
// Viewport breakpoints come from theme.css (xs … xl); container queries are not affected.
const ARBITRARY_BREAKPOINT = /^(?:min|max)-\[|^\[@media[^\]]*width/;
const RAW_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/i;
const TOKEN_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'border-color',
  'font-size',
  'font-weight',
  'font-family',
  'line-height',
  'letter-spacing',
  'border-radius',
  'box-shadow',
  'z-index',
]);
const STYLE_PROPERTIES = new Set([
  'color',
  'background',
  'backgroundColor',
  'borderColor',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'lineHeight',
  'letterSpacing',
  'borderRadius',
  'boxShadow',
  'zIndex',
]);

/** Splits a class token into its variants (`md:`, `[&_svg]:`) and the utility itself. */
function parseToken(token) {
  const variants = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token[i];
    if (char === '[' || char === '(') depth++;
    else if (char === ']' || char === ')') depth--;
    else if (char === ':' && depth === 0) {
      variants.push(token.slice(start, i));
      start = i + 1;
    }
  }
  return { variants, utility: token.slice(start).replace(/^!|!$/g, '') };
}

function tokenProblem(token) {
  const { variants, utility } = parseToken(token);
  if (variants.some((variant) => ARBITRARY_BREAKPOINT.test(variant)))
    return `"${token}" uses an arbitrary breakpoint; use xs:, sm:, md:, lg:, xl: or their max- forms`;
  if (TOKEN_ONLY.test(utility)) return `"${token}" uses an arbitrary value; use the theme scale`;
  const spacing = SPACING.exec(utility);
  if (spacing && PLAIN_LENGTH.test(spacing[1]))
    return `"${token}" uses an arbitrary length; use the spacing scale (4px steps, e.g. px-10 = 40px)`;
  const color = COLOR_CAPABLE.exec(utility);
  if (color) {
    const [, family, value] = color;
    if (family === 'text' && LENGTH.test(value)) return `"${token}" sets a font size; use text-xs … text-3xl`;
    if (LENGTH.test(value)) return null;
    if (!value.includes('var(--') || RAW_COLOR.test(value))
      return `"${token}" uses an arbitrary value; use a token class such as text-muted or bg-surface`;
    return null;
  }
  const property = /^\[([a-z-]+):/.exec(utility);
  if (property && TOKEN_PROPERTIES.has(property[1]))
    return `"${token}" sets ${property[1]} directly; use the theme scale`;
  return null;
}

const themeTokens = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Colors, type, radius, shadow, layers, spacing and breakpoints come from theme tokens only.',
    },
    messages: {
      token: '{{problem}} (src/styles/theme.css).',
      important:
        '"{{token}}" force-overrides a style with !important; add a variant to the component instead.',
      style: 'Inline style "{{name}}" bypasses the theme tokens; use a Tailwind token class.',
    },
    schema: [],
  },
  create(context) {
    const kit = inKit(context);
    const check = (node, text) => {
      for (const token of text.split(/\s+/)) {
        if (!token || !/^[!\w[&@*.-]/.test(token) || token.length > 200) continue;
        const problem = tokenProblem(token);
        if (problem) context.report({ node, messageId: 'token', data: { problem } });
        if (!kit && /^[a-z[][\w:[\]&().,/%-]*[\w\])]!$|^![a-z]/.test(token) && !token.includes('!='))
          context.report({ node, messageId: 'important', data: { token } });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === 'string' && node.parent?.type !== 'ImportDeclaration')
          check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
      JSXAttribute(node) {
        if (node.name.name !== 'style' || node.value?.type !== 'JSXExpressionContainer') return;
        const expression = node.value.expression;
        if (expression.type !== 'ObjectExpression') return;
        for (const property of expression.properties) {
          if (property.type !== 'Property') continue;
          const name = property.key.type === 'Identifier' ? property.key.name : property.key.value;
          if (STYLE_PROPERTIES.has(name))
            context.report({ node: property, messageId: 'style', data: { name } });
        }
      },
    };
  },
};

/** JSX elements rendered directly inside `parent`, looking through `{cond && <X/>}` and ternaries. */
function renderedChildren(parent) {
  const out = [];
  const visit = (node) => {
    if (!node) return;
    if (node.type === 'JSXElement') out.push(node);
    else if (node.type === 'JSXFragment') node.children.forEach(visit);
    else if (node.type === 'JSXExpressionContainer') visit(node.expression);
    else if (node.type === 'LogicalExpression') visit(node.right);
    else if (node.type === 'ConditionalExpression') {
      visit(node.consequent);
      visit(node.alternate);
    }
  };
  parent.children.forEach(visit);
  return out;
}

const consistentActions = {
  meta: {
    type: 'problem',
    docs: { description: 'Actions shown side by side use one button family.' },
    messages: {
      mixed:
        'A link-style <Button> next to regular buttons looks like a stray link. Use variant="ghost" (or make every action in the row a link).',
    },
    schema: [],
  },
  create(context) {
    if (inKit(context)) return {};
    return {
      JSXElement(node) {
        const buttons = renderedChildren(node).filter(
          (child) => jsxName(child.openingElement.name) === 'Button',
        );
        const links = buttons.filter(
          (button) => literalAttribute(button.openingElement, 'variant') === 'link',
        );
        if (!links.length || links.length === buttons.length) return;
        for (const link of links) context.report({ node: link.openingElement, messageId: 'mixed' });
      },
    };
  },
};

const requireDisableReason = {
  meta: {
    type: 'problem',
    docs: { description: 'Exceptions to the ui/* rules must say why.' },
    messages: { reason: 'Explain why this ui/* rule does not apply: add "-- <reason>" to the directive.' },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const text = comment.value.trim();
          if (/^eslint-disable/.test(text) && /\bui\//.test(text) && !/\s--\s+\S/.test(text))
            context.report({ loc: comment.loc, messageId: 'reason' });
        }
      },
    };
  },
};

export default {
  meta: { name: 'tebikae-ui' },
  rules: {
    'no-native-controls': noNativeControls,
    'kit-imports': kitImports,
    'theme-tokens': themeTokens,
    'consistent-actions': consistentActions,
    'require-disable-reason': requireDisableReason,
  },
};
