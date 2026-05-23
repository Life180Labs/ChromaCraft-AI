import { getServerSession } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import AzureADProvider from 'next-auth/providers/azure-ad';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import prisma from './prisma';
import bcrypt from 'bcrypt';
import { NextRequest } from 'next/server';

export const authOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: 'jwt' as const,
    maxAge: 30 * 24 * 60 * 60,
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({ where: { email: credentials.email } });
        if (!user || !user.passwordHash) return null;
        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid) return null;
        return { id: String(user.id), email: user.email, name: user.name };
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || 'mock-google-client-id',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'mock-google-client-secret',
    }),
    AzureADProvider({
      clientId: process.env.MICROSOFT_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID || 'mock-microsoft-client-id',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET || 'mock-microsoft-client-secret',
      tenantId: process.env.AZURE_AD_TENANT_ID || 'common',
    }),
  ],
  callbacks: {
    async session({ session, token }: any) {
      if (token?.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};

export async function getUserId(req: NextRequest): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    return session.user.id as string;
  }
  return null;
}
