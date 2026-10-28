import { h } from 'vue'

const paths = {
  FileText: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h8'],
  CreditCard: ['M3 5h18v14H3z', 'M3 10h18'],
  LockKeyhole: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4', 'M12 15v2'],
  Mail: ['M3 5h18v14H3z', 'm3 7 9 6 9-6'],
  UserRound: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
  Check: ['m5 12 4 4L19 6'],
  Clock3: ['M12 8v4l3 2', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z'],
  LogOut: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  Pencil: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z'],
  Plus: ['M12 5v14', 'M5 12h14'],
  Search: ['m21 21-4.3-4.3', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z'],
  Trash2: ['M3 6h18', 'M8 6V4h8v2', 'm19 6-1 14H6L5 6', 'M10 11v5', 'M14 11v5'],
  X: ['m18 6-12 12', 'm6 6 12 12'],
}

function createIcon(name) {
  return {
    name,
    inheritAttrs: false,
    setup(_, { attrs }) {
      return () => h('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: 24,
        height: 24,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        ...attrs,
      }, paths[name].map((d) => h('path', { d, key: d })))
    },
  }
}

export const FileText = createIcon('FileText')
export const CreditCard = createIcon('CreditCard')
export const LockKeyhole = createIcon('LockKeyhole')
export const Mail = createIcon('Mail')
export const UserRound = createIcon('UserRound')
export const Check = createIcon('Check')
export const Clock3 = createIcon('Clock3')
export const LogOut = createIcon('LogOut')
export const Pencil = createIcon('Pencil')
export const Plus = createIcon('Plus')
export const Search = createIcon('Search')
export const Trash2 = createIcon('Trash2')
export const X = createIcon('X')
