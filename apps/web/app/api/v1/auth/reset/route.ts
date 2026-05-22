import { NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { createTransport } from 'nodemailer';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const token = uuidv4();
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await prisma.passwordReset.create({ data: { userId: user.id, token, expiresAt: expires } });

    // Send email (placeholder – configure SMTP in .env)
    const transporter = createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    });
    const resetLink = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/reset?token=${token}`;
    await transporter.sendMail({
      from: `"ChromaCraft" <${process.env.SMTP_FROM || 'no-reply@chromacraft.ai'}>`,
      to: email,
      subject: 'Password reset request',
      text: `Click the following link to reset your password: ${resetLink}`,
    });
    return NextResponse.json({ message: 'Reset email sent' });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { token, newPassword } = await req.json();
    const reset = await prisma.passwordReset.findFirst({ where: { token, expiresAt: { gt: new Date() } } });
    if (!reset) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });
    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: reset.userId }, data: { passwordHash: hash } });
    await prisma.passwordReset.delete({ where: { id: reset.id } });
    return NextResponse.json({ message: 'Password updated' });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
