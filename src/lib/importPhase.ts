/**
 * Elke fase van "Content opnieuw laden" meldt een fout onder zijn eigen naam,
 * zodat een cursusfout nooit als Bijbelfout (of andersom) bij de beheerder
 * aankomt. Een fout die al een fase draagt (bv. Cursussen binnen het
 * importeren van boeken) behoudt die fase.
 */
export class ImportPhaseError extends Error {
  constructor(public readonly phase: string, cause: unknown) {
    super(`[${phase}] ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "ImportPhaseError";
  }
}

export async function inPhase<T>(phase: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw error instanceof ImportPhaseError ? error : new ImportPhaseError(phase, error);
  }
}
