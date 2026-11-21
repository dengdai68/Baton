// Task directory filters shared by the list and its filter sheet.
import { createStore } from '@/lib/store';

export const taskFilters = createStore({ status: 'all', workflow: 'all' });
