/*!
 * decks laser pointer plugin (P17-19) — offline, self-authored.
 *
 * WHY self-authored: there is no small, well-maintained standalone laser-pointer
 * reveal plugin to vendor, and a laser pointer is a handful of lines. Writing it
 * ourselves keeps the dependency surface (and the offline-vendoring burden) to a
 * single tiny file with zero external URLs.
 *
 * Behaviour: press `l` to toggle "laser mode". While active, a red dot follows
 * the pointer and the cursor is hidden. The dot is a transient DOM node injected
 * into the reveal element — it is NEVER written to deck.html (present-mode
 * annotations are ephemeral, spec presenting-and-export / byte-stability invariant).
 *
 * Enabled ONLY on the present route (the editor never loads this plugin).
 */
(function () {
  'use strict';

  const RevealLaser = {
    id: 'slidesLaser',
    init: function (reveal) {
      const root = reveal.getRevealElement ? reveal.getRevealElement() : document.body;
      let active = false;

      const dot = document.createElement('div');
      dot.setAttribute('aria-hidden', 'true');
      dot.style.cssText = [
        'position:fixed',
        'width:18px',
        'height:18px',
        'border-radius:50%',
        'background:radial-gradient(circle, rgba(255,0,0,0.95) 0%, rgba(255,0,0,0.55) 60%, rgba(255,0,0,0) 100%)',
        'box-shadow:0 0 12px 4px rgba(255,0,0,0.6)',
        'pointer-events:none',
        'transform:translate(-50%, -50%)',
        'z-index:2147483647',
        'display:none',
      ].join(';');
      document.body.appendChild(dot);

      function onMove(e) {
        dot.style.left = e.clientX + 'px';
        dot.style.top = e.clientY + 'px';
      }

      function setActive(on) {
        active = on;
        dot.style.display = on ? 'block' : 'none';
        root.style.cursor = on ? 'none' : '';
        if (on) {
          document.addEventListener('mousemove', onMove);
        } else {
          document.removeEventListener('mousemove', onMove);
        }
      }

      document.addEventListener('keydown', function (e) {
        // Ignore when typing in a field (speaker notes, etc.).
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.key === 'l' || e.key === 'L') {
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          setActive(!active);
        } else if (e.key === 'Escape' && active) {
          setActive(false);
        }
      });
    },
  };

  if (typeof window !== 'undefined') {
    window.RevealLaser = RevealLaser;
  }
})();
