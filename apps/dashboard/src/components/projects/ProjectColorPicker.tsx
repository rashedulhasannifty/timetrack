'use client';

import { useState } from 'react';
import { PROJECT_PALETTE } from '../../lib/project-color';

const PRESETS: readonly string[] = PROJECT_PALETTE;

/**
 * Preset swatches plus a "Custom" swatch that opens the browser's native color picker. Holds the
 * selection in a hidden `name="color"` input so it submits with the surrounding form; the API
 * accepts any #rrggbb. Keyboard-accessible radio-group semantics for the presets.
 *
 * The custom swatch shows a hue wheel until a custom color is chosen, then that color. The last
 * custom value is remembered, so going to a preset and back does not lose it.
 */
export function ProjectColorPicker({ defaultColor }: { defaultColor?: string }) {
  const initial = (defaultColor ?? PROJECT_PALETTE[0]).toLowerCase();
  const [selected, setSelected] = useState<string>(initial);
  const [custom, setCustom] = useState<string>(PRESETS.includes(initial) ? '#8e8e93' : initial);
  const isCustom = !PRESETS.includes(selected);

  return (
    <div role="radiogroup" aria-label="Project color" className="flex items-center gap-1.5">
      <input type="hidden" name="color" value={selected} />
      {PRESETS.map((hex) => (
        <button
          key={hex}
          type="button"
          role="radio"
          aria-checked={selected === hex}
          aria-label={hex}
          onClick={() => setSelected(hex)}
          className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
            selected === hex ? 'ring-accent ring-2 ring-offset-1' : ''
          }`}
          style={{ backgroundColor: hex }}
        />
      ))}
      <label
        title="Custom color"
        className={`relative h-5 w-5 cursor-pointer rounded-full transition-transform hover:scale-110 ${
          isCustom ? 'ring-accent ring-2 ring-offset-1' : ''
        }`}
        style={{
          background: isCustom
            ? selected
            : 'conic-gradient(#ff3b30, #ffcc00, #34c759, #30b0c7, #007aff, #af52de, #ff3b30)',
        }}
      >
        <span className="sr-only">Custom color</span>
        <input
          type="color"
          aria-label="Custom color"
          value={custom}
          // A click re-selects the remembered custom color even if the picker is then closed
          // without a change (which fires no onChange).
          onClick={() => setSelected(custom)}
          onChange={(e) => {
            setCustom(e.target.value);
            setSelected(e.target.value);
          }}
          className="absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0"
        />
      </label>
    </div>
  );
}
