/**
 * @module ui/staff/index
 * @description
 * **Staff block** (and rhythm line): entry point. Registers the `staff` block
 * type with {@link module:ui/blocks|ui/blocks}. The split into modules is
 * described in {@link module:ui/staff/shared|ui/staff/shared}.
 */

import { registerBlockKind } from '../blocks.js';
import { staffBlockEl, redrawStaff } from './view.js';
import { showStaffPalette } from './palette.js';

export { redrawStaff };

registerBlockKind('staff', { build: staffBlockEl, redraw: redrawStaff, showPalette: showStaffPalette });
