// Visuele seconden-aftelling (bv. "testmelding komt over 5 s"). Bewust een eigen
// bestand: dit is een UI-timer en geen data-verversing, en hoort dus niet in een
// component met data-fetching (zie docs/DATA-REFRESH.md en de architectuurtest).

/**
 * Telt vanaf `seconds` elke seconde één af en roept `onTick` met de resterende seconden aan,
 * tot er 0 over is: dan volgt `onDone`. Geeft een functie terug om voortijdig te stoppen.
 */
export function startCountdown(seconds: number, onTick: (remaining: number) => void, onDone: () => void): () => void {
  let remaining = seconds;
  onTick(remaining);
  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      onTick(remaining);
      return;
    }
    clearInterval(timer);
    onDone();
  }, 1000);
  return () => clearInterval(timer);
}
