import { reader } from '../../adapter/ClientAdapter.js';
import { InvItem } from './Inventory.js';

export const Equipment = {
    items(): InvItem[] {
        return reader.equipment().map(s => new InvItem(s));
    },

    contains(name: string): boolean {
        const wanted = name.toLowerCase();
        return reader.equipment().some(i => i.name?.toLowerCase() === wanted);
    }
};
