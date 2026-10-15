// Same rules the backend applies (userAuthController.js / authController.js),
// checked here first so the user gets an immediate answer. The backend still
// validates everything itself.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 6;

export function validateEmail(email) {
  const value = String(email || '').trim();
  if (!value) return 'Email is required.';
  if (!EMAIL_RE.test(value)) return 'Enter a valid email address.';
  return '';
}

export function validateLoginPassword(password) {
  return password ? '' : 'Password is required.';
}

export function validateNewPassword(password) {
  if (!password) return 'Password is required.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  return '';
}

export function validateConfirmPassword(password, confirm) {
  if (!confirm) return 'Confirm your password.';
  return password === confirm ? '' : 'Passwords do not match.';
}

export function validateName(name) {
  return String(name || '').trim() ? '' : 'Name is required.';
}
