/**
 * Sends the two emails accounts need — an invite, a password reset — through
 * Resend if it's configured, and does nothing otherwise.
 *
 * Nothing here is load-bearing: every caller already has the link it would
 * put in the email, and hands it back in the API response too, so an admin
 * can copy it and send it by whatever means they like. Configuring
 * `RESEND_API_KEY` just makes that automatic.
 */

export interface EmailEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

export function emailConfigured(env: EmailEnv): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

async function send(env: EmailEnv, to: string, subject: string, text: string): Promise<boolean> {
  if (!emailConfigured(env)) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function sendInviteEmail(env: EmailEnv, to: string, link: string, invitedBy: string): Promise<boolean> {
  return send(
    env,
    to,
    "You're invited to T-Card Planner",
    `${invitedBy} has invited you to T-Card Planner.\n\nSet up your account:\n${link}\n\nThis link expires in 7 days.`,
  );
}

export async function sendResetEmail(env: EmailEnv, to: string, link: string): Promise<boolean> {
  return send(
    env,
    to,
    'Reset your T-Card Planner password',
    `Reset your password:\n${link}\n\nThis link expires in 1 hour. If you didn't ask for this, ignore this email.`,
  );
}
