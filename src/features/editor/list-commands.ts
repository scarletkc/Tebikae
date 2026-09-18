import { liftListItem, wrapInList } from '@milkdown/kit/prose/schema-list';
import type { Command } from '@milkdown/kit/prose/state';

/** Convert the enclosing list in place; requesting the same kind lifts the item out instead. */
export const convertList =
  (ordered: boolean, convert = false): Command =>
  (state, dispatch, view) => {
    const type = state.schema.nodes[ordered ? 'ordered_list' : 'bullet_list']!;
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'ordered_list' || node.type.name === 'bullet_list') {
        if (node.type === type && !convert) {
          liftListItem(state.schema.nodes.list_item!)(state, dispatch, view);
        } else {
          const pos = $from.before(depth);
          const tr = state.tr.setNodeMarkup(pos, type);
          let index = 0;
          node.forEach((child, offset) => {
            if (child.type.name === 'list_item') {
              tr.setNodeMarkup(pos + 1 + offset, undefined, {
                ...child.attrs,
                checked: null,
                listType: ordered ? 'ordered' : 'bullet',
                label: ordered ? `${index + 1}.` : '•',
              });
              index++;
            }
          });
          dispatch?.(tr);
        }
        return true;
      }
    }
    return wrapInList(type)!(state, dispatch, view);
  };
