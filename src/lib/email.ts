import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendContactEmail(d: {
  name: string;
  email: string;
  phone?: string | null;
  message: string;
}) {
  const { error } = await resend.emails.send({
    from: process.env.CONTACT_FROM_EMAIL!,
    to: process.env.CONTACT_TO_EMAIL!,
    replyTo: d.email,
    subject: `New contact form message from ${d.name}`,
    text: `Name: ${d.name}\nEmail: ${d.email}\nPhone: ${d.phone || "-"}\n\n${d.message}`,
  });
  if (error) throw new Error(error.message);
}