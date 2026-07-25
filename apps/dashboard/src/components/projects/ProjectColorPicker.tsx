'use client';

import { useState } from 'react';
import { PROJECT_PALETTE } from '../../lib/project-color';

/**
 * 8-swatch palette picker. Holds the selection in a hidden `name="color"` input so it submits
 * with the surrounding form. Keyboard-accessible radio-group semantics.
 */
export function ProjectColorPicker({ defaultColor }: { defaultColor?: string }) {
  const [selected, setSelected] = useState<string>(defaultColor ?? PROJECT_PALETTE[0]);
  return (
    <div role="radiogroup" aria-label="Project color" className="flex items-center gap-1.5">
      <input type="hidden" name="color" value={selected} />
      {PROJECT_PALETTE.map((hex) => (
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
    </div>
  );
}
