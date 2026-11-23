/** Password rules live here so sign-up can show them without loading the crypto code. */
export const passwordRules = [
  { label: 'At least 8 characters', test: (value: string) => value.length >= 8 },
  { label: 'One uppercase letter', test: (value: string) => /[A-Z]/.test(value) },
  { label: 'One number', test: (value: string) => /[0-9]/.test(value) },
  { label: 'One symbol', test: (value: string) => /[^A-Za-z0-9\s]/.test(value) },
]
