/**
 * Email sending via Resend (operation invites)
 * Set RESEND_API_KEY and optionally RESEND_FROM_EMAIL, APP_URL in env.
 */

import { Resend } from 'resend';

function getResendClient() {
  const key = (process.env.RESEND_API_KEY || '').trim();
  return key ? new Resend(key) : null;
}

/**
 * Send an operation invite email with the invite link.
 * No-op if RESEND_API_KEY is not set (returns { sent: false }).
 */
export async function sendInviteEmail(to, orgName, role, inviteToken) {
  const resend = getResendClient();
  if (!resend) {
    return { sent: false, error: 'Email not configured (RESEND_API_KEY)' };
  }

  const fromEmail = (process.env.RESEND_FROM_EMAIL || 'SapMap <onboarding@resend.dev>').trim();
  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

  const inviteLink = `${appUrl}/invite/${inviteToken}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #333; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h1 style="font-size: 1.25rem; margin-bottom: 16px;">You're invited to join ${escapeHtml(orgName)}</h1>
  <p style="margin-bottom: 16px;">You've been invited to join <strong>${escapeHtml(orgName)}</strong> on SapMap with <strong>${escapeHtml(role)}</strong> access.</p>
  <p style="margin-bottom: 24px;">Click the button below to accept the invite. If you don't have an account yet, you can create one with this email address.</p>
  <p style="margin-bottom: 24px;">
    <a href="${escapeHtml(inviteLink)}" style="display: inline-block; background: #2d5016; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600;">Accept invite</a>
  </p>
  <p style="font-size: 0.875rem; color: #666;">Or copy this link: ${escapeHtml(inviteLink)}</p>
  <p style="font-size: 0.875rem; color: #666; margin-top: 24px;">This invite expires in 7 days. If you didn't expect this email, you can ignore it.</p>
</body>
</html>
`.trim();

  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [to],
      subject: `Join ${orgName} on SapMap`,
      html,
    });

    if (error) {
      let message = typeof error === 'object' && error !== null && 'message' in error
        ? error.message
        : String(error);
      if (/only send testing emails to your own|verify a domain|verify your domain/i.test(message)) {
        message =
          'To send invites to other people, verify a domain in Resend (resend.com/domains) and set RESEND_FROM_EMAIL to an address on that domain (e.g. invites@yourdomain.com). Until then, Resend only allows sending to your own email.';
      }
      return { sent: false, error: message };
    }
    return { sent: true, id: data?.id };
  } catch (err) {
    let message = err?.message || String(err);
    if (/only send testing emails to your own|verify a domain|verify your domain/i.test(message)) {
      message =
        'To send invites to other people, verify a domain in Resend (resend.com/domains) and set RESEND_FROM_EMAIL to an address on that domain (e.g. invites@yourdomain.com). Until then, Resend only allows sending to your own email.';
    }
    return { sent: false, error: message };
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
