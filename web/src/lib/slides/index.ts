/**
 * slides/index.ts — Public surface of the slide-management lane (P6, spec 06).
 *
 * Pure model operations (slides.ts), the canvas reveal driver (reveal-control.ts)
 * and the offline thumbnail builder (thumbnail.ts). The deckStore wraps the model
 * ops as undoable + autosaved commands; the navigator components consume the rest.
 */

export {
  findSlidesContainer,
  topLevelSlides,
  verticalChildren,
  isVerticalStack,
  isSlideHidden,
  buildSlideTree,
  indicesToEid,
  addSlide,
  duplicateSlide,
  deleteSlide,
  moveSlide,
  moveVerticalSlide,
  nestSlide,
  promoteSlide,
  setSlideHidden,
  setSlideAutoslide,
  setSlideFooterHidden,
  parsePresetSection,
  addSlideFromLayout,
  changeSlideLayout,
  type SlideTreeNode,
} from './slides';

export { navigateToSlide, getCurrentIndices, onSlideChanged } from './reveal-control';

export { buildThumbnailSrcdoc, serializeSection } from './thumbnail';
