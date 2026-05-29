/**
 * Demo seed script — run this to add test credits to a user
 * Usage: npx tsx src/scripts/seed-demo.ts <user-email>
 *
 * This is for DEMO PURPOSES ONLY. Remove before production.
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function seedDemo() {
  const email = process.argv[2];

  if (!email) {
    console.log('Usage: npx tsx src/scripts/seed-demo.ts your@email.com');
    process.exit(1);
  }

  console.log(`\n🌱 Seeding demo data for: ${email}\n`);

  // Find user
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    console.log(`❌ User not found: ${email}`);
    console.log('   Make sure you have signed up in the app first.');
    console.log('   The app calls /api/v1/auth/sync-user on login.');
    process.exit(1);
  }

  console.log(`✅ Found user: ${user.id}`);

  // Get or create wallet
  const wallet = await prisma.wallet.upsert({
    where: { userId: user.id },
    create: { userId: user.id, balance: 0 },
    update: {},
  });

  // Add 500 demo credits
  const updatedWallet = await prisma.wallet.update({
    where: { userId: user.id },
    data: { balance: { increment: 500 } },
  });

  // Record transaction
  await prisma.transaction.create({
    data: {
      userId: user.id,
      walletId: wallet.id,
      type: 'TOPUP',
      amount: 500,
      status: 'COMPLETED',
      razorpayId: `demo_${Date.now()}`,
      description: 'Demo credits (seed script)',
    },
  });

  console.log(`✅ Added 500 demo credits`);
  console.log(`💳 New balance: ${updatedWallet.balance} credits\n`);
  console.log('You can now demo all features without real payment.');

  await prisma.$disconnect();
}

seedDemo().catch((e) => {
  console.error(e);
  process.exit(1);
});
