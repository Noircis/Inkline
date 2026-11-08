/**
 * @module ui/staff/index
 * @description
 * **Bloc portée** (et ligne rythmique) : point d'entrée. Enregistre le type de
 * bloc `staff` auprès de {@link module:ui/blocks|ui/blocks}. Le découpage en
 * modules est décrit dans {@link module:ui/staff/shared|ui/staff/shared}.
 */

import { registerBlockKind } from '../blocks.js';
import { staffBlockEl, redrawStaff } from './view.js';
import { showStaffPalette } from './palette.js';

export { redrawStaff };

registerBlockKind('staff', { build: staffBlockEl, redraw: redrawStaff, showPalette: showStaffPalette });
