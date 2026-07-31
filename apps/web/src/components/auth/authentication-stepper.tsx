import type { Dictionary } from '@/lib/i18n/dictionaries';

const steps = [
  'phoneStep',
  'otpStep',
  'pinStep',
  'passkeyStep',
  'completeStep',
] as const;
export function AuthenticationStepper({
  current,
  dictionary,
}: {
  current: number;
  dictionary: Dictionary;
}) {
  return (
    <ol className="stepper" aria-label={dictionary.authenticationProgress}>
      {steps.map((key, index) => (
        <li
          key={key}
          className={
            index === current ? 'current' : index < current ? 'complete' : ''
          }
          aria-current={index === current ? 'step' : undefined}
        >
          <span>{index + 1}</span>
          <small>{dictionary[key]}</small>
        </li>
      ))}
    </ol>
  );
}
