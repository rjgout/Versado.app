export function dorpPrototypeEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.VERSADO_DORP_PROTOTYPE_ENABLED === "true";
}

export function canAccessDorpPrototype(input: { enabled: boolean; authenticated: boolean; isAdmin: boolean }): boolean {
  return input.enabled && input.authenticated && input.isAdmin;
}
