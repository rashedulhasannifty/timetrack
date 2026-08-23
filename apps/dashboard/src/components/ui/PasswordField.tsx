'use client';

import { useId, useState } from 'react';
import { IconEye, IconEyeOff } from './icons';

/**
 * A password input with a reveal toggle.
 *
 * Client component because the toggle is real interaction, but deliberately a small one: the
 * auth pages stay Server Components and only this field hydrates.
 *
 * The value is never lifted into React state — the input stays uncontrolled and the form
 * POSTs natively, exactly as it did before. Toggling only swaps the `type` attribute, so
 * nothing about submission, autofill, or the password manager's behaviour changes.
 */
export function PasswordField({
  name,
  placeholder,
  autoComplete = 'current-password',
  minLength,
  required,
  className,
}: {
  name: string;
  placeholder: string;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
  className: string;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        // Not `type={shown ? 'text' : 'password'}` on a controlled value — see above; this is
        // an uncontrolled input and the attribute swap is the whole mechanism.
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        {...(minLength === undefined ? {} : { minLength })}
        {...(required ? { required: true } : {})}
        placeholder={placeholder}
        // Room on the right so a long password never runs under the button.
        className={`${className} w-full pr-11`}
      />
      <button
        // type="button" is load-bearing: inside a <form> the default is "submit", so a click
        // meant to reveal the password would submit the half-typed form instead.
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-controls={id}
        aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}
        title={shown ? 'Hide password' : 'Show password'}
        // Not focusable by keyboard: tabbing from the password field should reach the submit
        // button, not a decorative toggle. Still reachable by pointer and to screen readers.
        tabIndex={-1}
        className="text-text-secondary hover:text-text absolute top-1/2 right-2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md transition-colors"
      >
        {shown ? <IconEyeOff width={17} height={17} /> : <IconEye width={17} height={17} />}
      </button>
    </div>
  );
}
